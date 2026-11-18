import type { Logger } from "pino";
import { BaseError, createTransport, type EIP1193RequestFn, type Transport } from "viem";

import { summarizeError } from "./error-summary";
import { isRateLimitedError, isRetryableRpcError, retryAfterMs } from "./rpc-errors";

/**
 * The limits one engine process keeps towards its node. The defaults stay under what Arc's
 * public RPC (https://rpc.testnet.arc.io) was measured to accept during the first rehearsal:
 *
 * - `eth_getLogs`: 12 requests within 1.4 s accepted, the 13th refused with HTTP 429 and
 *   `{"code":-32005,"message":"rate limit exceeded"}`, accepted again one second later, no
 *   `Retry-After`;
 * - `eth_blockNumber`: 20 a second for 5 seconds, and a burst of 60 at once, all accepted.
 *
 * The node weighs `eth_getLogs` far more than a plain read, hence a second, lower ceiling for the
 * heavy methods.
 */
export interface RpcLimits {
  /** Most requests started in any one second, every method counted. Default 10 (SPEC 8). */
  maxRequestsPerSecond: number;
  /** Most requests of `heavyMethods` started in any one second. Default 4. */
  maxHeavyRequestsPerSecond: number;
  /** Methods the node weighs heavily. Default `["eth_getLogs"]`. */
  heavyMethods: readonly string[];
  /** First cool-down after a rate-limit answer, doubled at each one in a row. Default 1 000. */
  coolDownMs: number;
  /** Longest cool-down. Default 16 000. */
  maxCoolDownMs: number;
  /** Times a request refused for a rate limit is sent again before its caller gets the error. Default 3. */
  rateLimitRetries: number;
}

export const DEFAULT_RPC_LIMITS: Readonly<RpcLimits> = Object.freeze({
  maxRequestsPerSecond: 10,
  maxHeavyRequestsPerSecond: 4,
  heavyMethods: Object.freeze(["eth_getLogs"]),
  coolDownMs: 1_000,
  maxCoolDownMs: 16_000,
  rateLimitRetries: 3,
});

const WINDOW_MS = 1_000;

/** Raised at construction for limits that cannot work. */
export class RpcLimiterConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcLimiterConfigError";
  }
}

/**
 * The limiter was closed (the engine stopped): the request was never sent. A viem `BaseError`, so
 * that viem's request wrapper passes it to the caller as it is.
 */
export class RpcLimiterClosedError extends BaseError {
  constructor(method: string) {
    super(`${method} was not sent: the RPC limiter is closed.`, { name: "RpcLimiterClosedError" });
  }
}

/** The caller's signal aborted while the request waited for its turn: it was never sent. */
export class RpcRequestAbortedError extends BaseError {
  constructor(method: string) {
    super(`${method} was not sent: the request was aborted while it waited.`, {
      name: "AbortError",
    });
  }
}

/**
 * Whether `error`, or an error of its `cause` chain (viem wraps transport errors), is the limiter
 * releasing a request unsent because it closed.
 */
export function isRpcLimiterClosedError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 12 && typeof current === "object" && current !== null; depth += 1) {
    if (current instanceof RpcLimiterClosedError) return true;
    if ((current as { name?: unknown }).name === "RpcLimiterClosedError") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RpcLimiterConfigError(`${name} must be a positive number`);
  }
  return value;
}

/** `limits` over the defaults, checked. */
export function resolveRpcLimits(limits: Partial<RpcLimits> = {}): RpcLimits {
  const merged: RpcLimits = { ...DEFAULT_RPC_LIMITS, ...limits };
  positive(merged.maxRequestsPerSecond, "maxRequestsPerSecond");
  positive(merged.maxHeavyRequestsPerSecond, "maxHeavyRequestsPerSecond");
  positive(merged.coolDownMs, "coolDownMs");
  positive(merged.maxCoolDownMs, "maxCoolDownMs");
  if (merged.maxCoolDownMs < merged.coolDownMs) {
    throw new RpcLimiterConfigError("maxCoolDownMs must be at least coolDownMs");
  }
  if (!Number.isInteger(merged.rateLimitRetries) || merged.rateLimitRetries < 0) {
    throw new RpcLimiterConfigError("rateLimitRetries must be a non-negative integer");
  }
  return {
    ...merged,
    // Whole requests: a ceiling of 2.5 a second lets 2 start in any second.
    maxRequestsPerSecond: Math.max(1, Math.floor(merged.maxRequestsPerSecond)),
    maxHeavyRequestsPerSecond: Math.max(1, Math.floor(merged.maxHeavyRequestsPerSecond)),
    heavyMethods: [...merged.heavyMethods],
  };
}

export interface RpcLimiterStats {
  /** Requests let through, retries included. */
  started: number;
  /** Rate-limit answers reported, including those of requests already in flight. */
  rateLimited: number;
  /** Cool-downs started (one warning each). */
  coolDowns: number;
}

interface Waiter {
  /** Order of the logical request: a retry keeps the place of its first try. */
  seq: number;
  heavy: boolean;
  method: string;
  resolve: (startedAt: number) => void;
  reject: (error: Error) => void;
  /** Detaches the abort listener. */
  detach: () => void;
}

/**
 * One limiter per engine process, in front of every request its public client makes (see
 * `createArcClients`). Requests start in the order they arrived, at most `maxRequestsPerSecond`
 * in any second and at most `maxHeavyRequestsPerSecond` of the heavy methods. When the node
 * answers "rate limited", a cool-down starts during which no request starts at all; the refused
 * request then goes first, before any request that arrived after it.
 *
 * It only ever delays: no request is dropped, merged or reordered against an earlier one, so a
 * signer's transactions reach the node in the order they were sent, and a retried
 * `eth_sendRawTransaction` sends the same signed bytes (the transport resends the request it
 * was given). A timer is held only while a request waits; `close()` releases every waiting
 * request with `RpcLimiterClosedError` and leaves no timer.
 */
export class RpcLimiter {
  readonly limits: RpcLimits;
  readonly stats: RpcLimiterStats = { started: 0, rateLimited: 0, coolDowns: 0 };
  private readonly heavy: ReadonlySet<string>;
  private readonly logger: Logger | undefined;
  private readonly queue: Waiter[] = [];
  /** Start times within the last second, oldest first. */
  private readonly starts: number[] = [];
  private readonly heavyStarts: number[] = [];
  private readonly sleepers = new Set<() => void>();
  private nextSeq = 0;
  private coolDownUntil = 0;
  private coolDownsInARow = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private closedFlag = false;

  constructor(options: { limits?: Partial<RpcLimits>; logger?: Logger } = {}) {
    this.limits = resolveRpcLimits(options.limits);
    this.heavy = new Set(this.limits.heavyMethods);
    this.logger = options.logger;
  }

  /** Requests waiting for their turn. */
  get waiting(): number {
    return this.queue.length;
  }

  /** True while a cool-down holds every request back. */
  get coolingDown(): boolean {
    return Date.now() < this.coolDownUntil;
  }

  get closed(): boolean {
    return this.closedFlag;
  }

  isHeavy(method: string): boolean {
    return this.heavy.has(method);
  }

  /** A place in the queue for a new logical request; its retries keep it. */
  ticket(): number {
    const seq = this.nextSeq;
    this.nextSeq += 1;
    return seq;
  }

  /**
   * Resolves with the start time once `method` may be sent: its turn has come, the ceilings
   * allow it and no cool-down runs. Rejects with `RpcLimiterClosedError` once the limiter is
   * closed and with `RpcRequestAbortedError` when `signal` aborts first.
   */
  acquire(method: string, seq: number, signal?: AbortSignal): Promise<number> {
    if (this.closedFlag) return Promise.reject(new RpcLimiterClosedError(method));
    if (signal?.aborted === true) return Promise.reject(new RpcRequestAbortedError(method));
    return new Promise<number>((resolve, reject) => {
      const waiter: Waiter = {
        seq,
        heavy: this.isHeavy(method),
        method,
        resolve,
        reject,
        detach: () => undefined,
      };
      if (signal) {
        const onAbort = (): void => {
          const index = this.queue.indexOf(waiter);
          if (index < 0) return;
          this.queue.splice(index, 1);
          waiter.detach();
          reject(new RpcRequestAbortedError(method));
          this.pump();
        };
        signal.addEventListener("abort", onAbort, { once: true });
        waiter.detach = () => signal.removeEventListener("abort", onAbort);
      }
      // Ordered by first arrival: a retry goes before every request that came after it.
      let index = this.queue.length;
      while (index > 0 && (this.queue[index - 1]?.seq ?? -1) > seq) index -= 1;
      this.queue.splice(index, 0, waiter);
      this.pump();
    });
  }

  /**
   * The node answered "rate limited". Starts a cool-down unless one is already running (the
   * answer then belongs to a request sent before it, and changes nothing): `coolDownMs`,
   * doubled for each cool-down in a row, at most `maxCoolDownMs`, and never shorter than the
   * node's `Retry-After`. Logs one warning per cool-down.
   */
  reportRateLimit(method: string, error: unknown): void {
    this.stats.rateLimited += 1;
    const now = Date.now();
    if (now < this.coolDownUntil || this.closedFlag) return;
    this.coolDownsInARow += 1;
    const exponent = Math.min(this.coolDownsInARow - 1, 30);
    const doubled = Math.min(this.limits.maxCoolDownMs, this.limits.coolDownMs * 2 ** exponent);
    const asked = retryAfterMs(error, now);
    const coolDownMs =
      asked === undefined ? doubled : Math.min(this.limits.maxCoolDownMs, Math.max(doubled, asked));
    this.coolDownUntil = now + coolDownMs;
    this.stats.coolDowns += 1;
    try {
      this.logger?.warn(
        {
          method,
          coolDownMs,
          inARow: this.coolDownsInARow,
          waiting: this.queue.length,
          error: summarizeError(error),
        },
        "node is rate limiting this client, every request waits",
      );
    } catch {
      // A failing logger must not stop the requests.
    }
    this.pump();
  }

  /** A request that started at `startedAt` succeeded: after a cool-down, the next one starts short again. */
  reportSuccess(startedAt: number): void {
    if (startedAt >= this.coolDownUntil) this.coolDownsInARow = 0;
  }

  /**
   * Sleeps `ms` (the delay before a retry). Resolves early when `signal` aborts; rejects with
   * `RpcLimiterClosedError` when the limiter closes. Its timer never outlives it.
   */
  delay(ms: number, method: string, signal?: AbortSignal): Promise<void> {
    if (this.closedFlag) return Promise.reject(new RpcLimiterClosedError(method));
    return new Promise<void>((resolve, reject) => {
      const finish = (closed: boolean): void => {
        clearTimeout(timer);
        this.sleepers.delete(onClose);
        signal?.removeEventListener("abort", onAbort);
        if (closed) reject(new RpcLimiterClosedError(method));
        else resolve();
      };
      const onClose = (): void => finish(true);
      const onAbort = (): void => finish(false);
      const timer = setTimeout(() => finish(false), Math.max(0, ms));
      this.sleepers.add(onClose);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  /**
   * Closes the limiter in `ms` unless it is closed before. For a shutdown: viem does not pass the
   * caller's abort signal down to the transport for most actions (`getLogs`, `estimateGas`…), so
   * a request held by a long cool-down would keep its loop, and the engine's stop, waiting.
   * Requests already sent are not touched. The timer does not keep the process alive and is
   * cleared by `close()`. A later call replaces an earlier one.
   */
  closeAfter(ms: number): void {
    if (this.closedFlag) return;
    if (this.closeTimer !== null) clearTimeout(this.closeTimer);
    const timer = setTimeout(
      () => {
        this.closeTimer = null;
        this.close();
      },
      Math.max(0, ms),
    );
    timer.unref();
    this.closeTimer = timer;
  }

  /**
   * Stops for good: every waiting request is rejected with `RpcLimiterClosedError`, the timer is
   * cleared, and later requests are refused the same way. Requests already sent are not touched.
   */
  close(): void {
    if (this.closedFlag) return;
    this.closedFlag = true;
    this.clearTimer();
    if (this.closeTimer !== null) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
    for (const waiter of this.queue.splice(0)) {
      waiter.detach();
      waiter.reject(new RpcLimiterClosedError(waiter.method));
    }
    for (const wake of [...this.sleepers]) wake();
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private prune(now: number): void {
    const since = now - WINDOW_MS;
    while ((this.starts[0] ?? Number.POSITIVE_INFINITY) <= since) this.starts.shift();
    while ((this.heavyStarts[0] ?? Number.POSITIVE_INFINITY) <= since) this.heavyStarts.shift();
  }

  /** Earliest time a request of this weight may start. */
  private earliestStart(heavy: boolean, now: number): number {
    let at = Math.max(now, this.coolDownUntil);
    const all = this.limits.maxRequestsPerSecond;
    if (this.starts.length >= all) {
      at = Math.max(at, (this.starts[this.starts.length - all] ?? now) + WINDOW_MS);
    }
    const heavyMax = this.limits.maxHeavyRequestsPerSecond;
    if (heavy && this.heavyStarts.length >= heavyMax) {
      at = Math.max(at, (this.heavyStarts[this.heavyStarts.length - heavyMax] ?? now) + WINDOW_MS);
    }
    return at;
  }

  /** Lets through every request whose turn has come, then sleeps until the next one may start. */
  private pump(): void {
    this.clearTimer();
    if (this.closedFlag) return;
    for (;;) {
      const head = this.queue[0];
      if (!head) return;
      const now = Date.now();
      this.prune(now);
      const at = this.earliestStart(head.heavy, now);
      if (at > now) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.pump();
        }, at - now);
        return;
      }
      this.queue.shift();
      this.starts.push(now);
      if (head.heavy) this.heavyStarts.push(now);
      this.stats.started += 1;
      head.detach();
      head.resolve(now);
    }
  }
}

export interface RateLimitedTransportOptions {
  limiter: RpcLimiter;
  /**
   * Times a request that failed for another reason than a rate limit (network, timeout, HTTP 5xx,
   * internal error) is sent again, as viem's own retry does. Default 2.
   */
  retryCount?: number;
  /** First delay of those retries, doubled each time (viem's rule). Default 150. */
  retryDelayMs?: number;
}

type RequestArgs = { method: string; params?: unknown };
type RequestOptions = { signal?: AbortSignal } | undefined;
type LooseRequest = (args: RequestArgs, options?: RequestOptions) => Promise<unknown>;

/**
 * A transport that sends every request of `inner` through `limiter`. Give it an `inner` built
 * without retries of its own (a `fallback` with `retryCount: 0`): retries happen here, each one
 * waiting for its turn like any request. A rate-limit answer starts a cool-down and the request
 * is sent again, up to `limits.rateLimitRetries` times; other failures viem would retry are sent
 * again up to `retryCount` times after 150 ms, 300 ms… The error given to the caller is the
 * node's last one, unchanged.
 */
export function rateLimitedTransport(
  inner: Transport,
  options: RateLimitedTransportOptions,
): Transport<"rateLimited"> {
  const { limiter } = options;
  const retryCount = options.retryCount ?? 2;
  const retryDelayMs = options.retryDelayMs ?? 150;
  return (parameters) => {
    const innerTransport = inner({ ...parameters, retryCount: 0 });
    const send = innerTransport.request as unknown as LooseRequest;
    const request: LooseRequest = async (args, requestOptions) => {
      const signal = requestOptions?.signal;
      const seq = limiter.ticket();
      let rateLimitRetries = 0;
      let otherRetries = 0;
      for (;;) {
        const startedAt = await limiter.acquire(args.method, seq, signal);
        try {
          const result = await send(args, requestOptions);
          limiter.reportSuccess(startedAt);
          return result;
        } catch (error: unknown) {
          if (signal?.aborted === true) throw error;
          if (isRateLimitedError(error)) {
            limiter.reportRateLimit(args.method, error);
            if (rateLimitRetries < limiter.limits.rateLimitRetries && !limiter.closed) {
              rateLimitRetries += 1;
              continue;
            }
            throw error;
          }
          if (otherRetries < retryCount && isRetryableRpcError(error)) {
            await limiter.delay(retryDelayMs * 2 ** otherRetries, args.method, signal);
            otherRetries += 1;
            continue;
          }
          throw error;
        }
      }
    };
    return createTransport(
      {
        key: "rateLimited",
        name: `Rate-limited ${innerTransport.config.name}`,
        type: "rateLimited",
        request: request as unknown as EIP1193RequestFn,
        retryCount: 0,
        timeout: innerTransport.config.timeout,
        methods: innerTransport.config.methods,
      },
      innerTransport.value,
    );
  };
}
