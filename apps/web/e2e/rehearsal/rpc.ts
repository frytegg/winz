import {
  ContractFunctionRevertedError,
  ExecutionRevertedError,
  HttpRequestError,
  InternalRpcError,
  LimitExceededRpcError,
  ResourceUnavailableRpcError,
  RpcRequestError,
  SocketClosedError,
  TimeoutError,
  WebSocketRequestError,
  createPublicClient,
  custom,
  type PublicClient,
} from "viem";

import { classifyRpcRefusal, isRpcLimiterClosedError } from "../../../engine/src/chain";
import { ApiCallError } from "../support/api";
import { WaitTimeoutError } from "../support/wait";
import {
  InjectedFailureError,
  RehearsalAbortedError,
  type NodeFault,
  type RetryPolicy,
  type RpcRecord,
  type StepRecord,
} from "./types";

/**
 * How the runner reads a node, a route or the database that may fail for a moment: which failures
 * waiting can cure (`classifyFailure`), the bounded retry of a read made outside a wait
 * (`withRetry`), and the client the runner reads the chain with (`meteredClient`), which counts
 * every request it makes and goes through the client of `createArcClients`, so that the engine's
 * request limiter covers the runner too.
 */

/** `transient`: asking again later can succeed. `permanent`: it cannot; the step fails at once. */
export type FailureKind = "transient" | "permanent";

/** HTTP statuses that say "not now": a timeout, too early, a rate limit, a server-side failure. */
const TRANSIENT_HTTP_STATUSES: ReadonlySet<number> = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Node.js, undici and postgres.js codes of a connection that failed or dropped. */
const TRANSIENT_CONNECTION_CODES: ReadonlySet<string> = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  // postgres.js: the server closed the connection, or it could not be opened in time.
  "CONNECTION_CLOSED",
  "CONNECTION_DESTROYED",
  "CONNECT_TIMEOUT",
]);

/**
 * Postgres SQLSTATEs that pass: the server shutting down or starting, too many connections, a
 * serialization failure or a deadlock (class 08, connection exceptions, is matched by prefix).
 */
const TRANSIENT_SQLSTATES: ReadonlySet<string> = new Set([
  "57P01",
  "57P02",
  "57P03",
  "53300",
  "40001",
  "40P01",
]);

const MAX_CAUSE_DEPTH = 12;

function causes(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current !== undefined && current !== null;) {
    chain.push(current);
    if (typeof current !== "object") break;
    current = (current as { cause?: unknown }).cause;
    depth += 1;
  }
  return chain;
}

function transientLink(link: unknown): FailureKind | null {
  if (link instanceof HttpRequestError) {
    // No status: the request never got an answer (refused, reset, DNS).
    return link.status === undefined || TRANSIENT_HTTP_STATUSES.has(link.status)
      ? "transient"
      : "permanent";
  }
  if (
    link instanceof TimeoutError ||
    link instanceof SocketClosedError ||
    link instanceof WebSocketRequestError ||
    link instanceof LimitExceededRpcError ||
    link instanceof InternalRpcError ||
    link instanceof ResourceUnavailableRpcError
  ) {
    return "transient";
  }
  if (link instanceof RpcRequestError && link.status !== undefined) {
    return TRANSIENT_HTTP_STATUSES.has(link.status) ? "transient" : null;
  }
  if (typeof link === "object" && link !== null) {
    const code = (link as { code?: unknown }).code;
    if (typeof code === "string") {
      if (TRANSIENT_CONNECTION_CODES.has(code)) return "transient";
      if (/^08[0-9A-Z]{3}$/.test(code) || TRANSIENT_SQLSTATES.has(code)) return "transient";
    }
  }
  return null;
}

/**
 * Whether waiting can cure `error`. Transient: a rate limit (whatever the node calls it: see the
 * engine's `classifyRpcRefusal`), a timeout, an HTTP 408/425/429/5xx, a request that got no
 * answer, a dropped or refused connection (the node or Postgres), a Postgres shutdown, a
 * serialization failure or a deadlock, a route answering 408/425/429/5xx. Permanent: everything
 * else, and in particular a revert, a range the node refuses whatever the wait, a route's
 * refusal (any other 4xx: the product said no), an injected failure, an abort, the limiter
 * closed, a wait that already timed out, a read that already exhausted its retries, and any
 * error this function does not recognise (a bug must fail loudly, not be retried for minutes).
 */
export function classifyFailure(error: unknown): FailureKind {
  if (
    error instanceof RehearsalAbortedError ||
    error instanceof InjectedFailureError ||
    error instanceof WaitTimeoutError ||
    error instanceof ReadFailedError
  ) {
    return "permanent";
  }
  if (error instanceof ApiCallError) {
    return TRANSIENT_HTTP_STATUSES.has(error.status) ? "transient" : "permanent";
  }
  if (isRpcLimiterClosedError(error)) return "permanent";
  const chain = causes(error);
  if (
    chain.some(
      (link) =>
        link instanceof ContractFunctionRevertedError || link instanceof ExecutionRevertedError,
    )
  ) {
    return "permanent";
  }
  if (chain.some((link) => (link as { name?: unknown } | null)?.name === "AbortError")) {
    return "permanent";
  }
  const refusal = classifyRpcRefusal(error);
  if (refusal === "rate-limited") return "transient";
  if (refusal === "too-large") return "permanent";
  for (const link of chain) {
    const kind = transientLink(link);
    if (kind !== null) return kind;
  }
  return "permanent";
}

/** True when the failure is a rate limit (for the counts of the receipt). */
export function isRateLimit(error: unknown): boolean {
  if (error instanceof ApiCallError) return error.status === 429;
  return classifyRpcRefusal(error) === "rate-limited";
}

/**
 * One line naming a failure: viem's short message (its full message quotes the request and the
 * RPC URL, whose path can be an access token) or the first line of the message. The caller still
 * redacts it.
 */
export function describeFailure(error: unknown): string {
  if (error instanceof Error) {
    const short = (error as Error & { shortMessage?: unknown }).shortMessage;
    const text = typeof short === "string" ? short : error.message;
    const first = text.split("\n")[0]?.trim() ?? "";
    return first === "" ? error.name : first;
  }
  return String(error);
}

/** A read that failed on every try. Names what could not be read and the last error. */
export class ReadFailedError extends Error {
  constructor(
    public readonly what: string,
    public readonly attempts: number,
    public readonly lastError: unknown,
  ) {
    super(
      `${what} could not be read (${attempts.toString()} attempts; last error: ${describeFailure(lastError)})`,
      { cause: lastError },
    );
    this.name = "ReadFailedError";
  }
}

/** Six tries over about half a minute: longer than any cool-down of the engine's limiter. */
export const DEFAULT_READ_RETRY: RetryPolicy = {
  attempts: 6,
  baseDelayMs: 1_000,
  maxDelayMs: 16_000,
};

export function retryPolicy(input: Partial<RetryPolicy> | undefined): RetryPolicy {
  const policy = { ...DEFAULT_READ_RETRY, ...input };
  return {
    attempts: Math.max(1, Math.floor(policy.attempts)),
    baseDelayMs: Math.max(0, policy.baseDelayMs),
    maxDelayMs: Math.max(0, policy.maxDelayMs),
  };
}

/** The delay before retry `retry` (1 for the first): base × 2^(retry − 1), at most `maxDelayMs`. */
export function backoffDelayMs(policy: RetryPolicy, retry: number): number {
  const exponent = Math.min(Math.max(retry - 1, 0), 30);
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** exponent);
}

/** Sleeps `ms`; rejects with `RehearsalAbortedError` when `signal` aborts first. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolveSleep, reject) => {
    if (signal?.aborted === true) {
      reject(new RehearsalAbortedError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolveSleep();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(new RehearsalAbortedError());
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Runs `read` until it succeeds, at most `policy.attempts` times, waiting `backoffDelayMs` between
 * tries. A permanent failure is thrown at once, as it is; transient failures on every try end in
 * `ReadFailedError` naming `what` and the last error.
 */
export async function withRetry<T>(
  what: string,
  read: () => Promise<T>,
  options: { policy: RetryPolicy; signal?: AbortSignal; onRetry?: (error: unknown) => void },
): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= options.policy.attempts; attempt += 1) {
    if (attempt > 1) {
      options.onRetry?.(lastError);
      await sleep(backoffDelayMs(options.policy, attempt - 1), options.signal);
    }
    try {
      return await read();
    } catch (error: unknown) {
      if (classifyFailure(error) === "permanent") throw error;
      lastError = error;
    }
  }
  throw new ReadFailedError(what, options.policy.attempts, lastError);
}

// ---------------------------------------------------------------------------------------------
// The runner's client: every request counted, and the test's faulty node
// ---------------------------------------------------------------------------------------------

export interface NodeRequest {
  atMs: number;
  method: string;
  step: string | null;
  ok: boolean;
  rateLimited: boolean;
}

/** Every request the runner's client made, and the retries of the runner's reads. */
export class RpcMeter {
  readonly requests: NodeRequest[] = [];
  retried = 0;

  record(request: NodeRequest): void {
    this.requests.push(request);
  }

  noteRetry(): void {
    this.retried += 1;
  }

  /** The counts of the receipt, with the requests of each step of `steps`. */
  summary(
    steps: readonly StepRecord[],
    limiter: { started: number; rateLimited: number; coolDowns: number } | null,
  ): RpcRecord {
    const refused = this.requests.filter((request) => !request.ok);
    const perStep = new Map<string, { requests: number; durationMs: number }>();
    for (const step of steps) {
      const entry = perStep.get(step.step) ?? { requests: 0, durationMs: 0 };
      entry.durationMs += step.durationMs ?? 0;
      perStep.set(step.step, entry);
    }
    for (const request of this.requests) {
      const name = request.step ?? "outside a step";
      const entry = perStep.get(name) ?? { requests: 0, durationMs: 0 };
      entry.requests += 1;
      perStep.set(name, entry);
    }
    return {
      requests: this.requests.length,
      refused: refused.length,
      rateLimited: refused.filter((request) => request.rateLimited).length,
      retried: this.retried,
      perStep: [...perStep.entries()].map(([step, entry]) => ({ step, ...entry })),
      limiter: limiter === null ? null : { ...limiter },
    };
  }
}

type LooseRequest = (args: { method: string; params?: unknown }) => Promise<unknown>;

/**
 * The runner's client: each request goes to `base` (the client of `createArcClients`, behind the
 * engine's limiter), is counted in `meter` with the step it belongs to, and, in tests, may be
 * answered by `fault` instead. No retry of its own: the runner decides what to try again.
 */
export function meteredClient(
  base: PublicClient,
  options: { meter: RpcMeter; step: () => string | null; fault?: NodeFault },
): PublicClient {
  const send = base.request as unknown as LooseRequest;
  const transport = custom(
    {
      async request({ method, params }: { method: string; params?: unknown }): Promise<unknown> {
        const atMs = Date.now();
        const step = options.step();
        const injected = options.fault?.({ method, step, atMs }) ?? null;
        if (injected !== null) {
          options.meter.record({
            atMs,
            method,
            step,
            ok: false,
            rateLimited: isRateLimit(injected),
          });
          throw injected;
        }
        try {
          const result = await send({ method, params });
          options.meter.record({ atMs, method, step, ok: true, rateLimited: false });
          return result;
        } catch (error: unknown) {
          options.meter.record({ atMs, method, step, ok: false, rateLimited: isRateLimit(error) });
          throw error;
        }
      },
    },
    { retryCount: 0 },
  );
  return createPublicClient({
    ...(base.chain === undefined ? {} : { chain: base.chain }),
    transport,
    pollingInterval: base.pollingInterval,
  });
}

/** What Arc's public RPC answered on the first rehearsal: HTTP 429, code -32005. For tests. */
export function rateLimitAnswer(method: string): LimitExceededRpcError {
  return new LimitExceededRpcError(
    new RpcRequestError({
      body: { method },
      error: { code: -32005, message: "rate limit exceeded" },
      status: 429,
      url: "http://rate-limited-node.invalid",
    }),
  );
}
