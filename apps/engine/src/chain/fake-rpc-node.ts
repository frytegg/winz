/**
 * Test support: a JSON-RPC node that enforces the limits measured on Arc's public RPC
 * (https://rpc.testnet.arc.io) during the first rehearsal, served over real HTTP so that viem's
 * own HTTP client, error classes and retry code run for real, or called in-process through a
 * viem `custom` transport when a test needs to see the exact order requests leave the client.
 *
 * Measured, and enforced here by default:
 * - `eth_getLogs` over a span of 9 999 blocks is accepted, 10 000 is refused with HTTP 200 and
 *   `{"code":-32012,"message":"requested range too large"}`;
 * - 12 `eth_getLogs` within 1.4 s are accepted, the 13th is refused with HTTP 429 and
 *   `{"code":-32005,"message":"rate limit exceeded"}`, with no `Retry-After`; requests are
 *   accepted again once the window has room.
 * - `eth_blockNumber` was not limited at 20 a second, nor by a burst of 60: other methods are
 *   not counted.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { custom, type CustomTransport, type EIP1193RequestFn } from "viem";

/** `eth_getLogs` accepted within `ARC_LOGS_WINDOW_MS`. */
export const ARC_LOGS_PER_WINDOW = 12;
/** Window of the `eth_getLogs` count, in ms. */
export const ARC_LOGS_WINDOW_MS = 1_400;
/** Smallest span refused by `eth_getLogs`, in blocks (`toBlock - fromBlock + 1`). */
export const ARC_LOGS_REFUSED_SPAN = 10_000n;

export type FakeOutcome = "ok" | "rate-limited" | "too-large" | "failed";

export interface FakeCall {
  method: string;
  params: readonly unknown[];
  /** Epoch ms at which the node handled it. */
  at: number;
  outcome: FakeOutcome;
  /** `toBlock - fromBlock + 1` of an `eth_getLogs`. */
  span?: bigint;
}

export interface FakeNodeOptions {
  /** Answer of `eth_blockNumber`. */
  head: bigint;
  chainId?: number;
  logsPerWindow?: number;
  logsWindowMs?: number;
  refusedSpan?: bigint;
}

interface JsonRpcError {
  code: number;
  message: string;
}

interface FakeAnswer {
  /** HTTP status of the answer. */
  status: number;
  result?: unknown;
  error?: JsonRpcError;
}

/** Raised by the in-process transport, shaped as a JSON-RPC error. */
export class FakeNodeError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "FakeNodeError";
  }
}

function hex(value: bigint | number): string {
  return `0x${value.toString(16)}`;
}

function blockParam(value: unknown, head: bigint): bigint {
  if (typeof value !== "string" || value === "latest" || value === "pending") return head;
  if (value === "earliest") return 0n;
  return BigInt(value);
}

export class FakeRpcNode {
  readonly calls: FakeCall[] = [];
  head: bigint;
  readonly chainId: number;
  logsPerWindow: number;
  readonly logsWindowMs: number;
  refusedSpan: bigint;
  /** The next this-many requests, of any method, are answered as a rate limit. */
  forcedRateLimits = 0;
  /** Methods answered with an internal error (-32603) while listed. */
  readonly failingMethods = new Set<string>();
  /** Start times of the accepted `eth_getLogs`, for the sliding count. */
  private readonly acceptedLogs: number[] = [];
  private server: Server | null = null;

  constructor(options: FakeNodeOptions) {
    this.head = options.head;
    this.chainId = options.chainId ?? 5_042_002;
    this.logsPerWindow = options.logsPerWindow ?? ARC_LOGS_PER_WINDOW;
    this.logsWindowMs = options.logsWindowMs ?? ARC_LOGS_WINDOW_MS;
    this.refusedSpan = options.refusedSpan ?? ARC_LOGS_REFUSED_SPAN;
  }

  /** Calls of `method`, in the order the node handled them. */
  callsOf(method: string): FakeCall[] {
    return this.calls.filter((call) => call.method === method);
  }

  count(method: string, outcome: FakeOutcome): number {
    return this.calls.filter((call) => call.method === method && call.outcome === outcome).length;
  }

  /** Answers one request. Synchronous: the order of `calls` is the order of arrival. */
  handle(method: string, params: readonly unknown[] = []): FakeAnswer {
    const at = Date.now();
    const record = (outcome: FakeOutcome, span?: bigint): void => {
      this.calls.push({ method, params, at, outcome, ...(span !== undefined ? { span } : {}) });
    };
    if (this.forcedRateLimits > 0) {
      this.forcedRateLimits -= 1;
      record("rate-limited");
      return { status: 429, error: { code: -32005, message: "rate limit exceeded" } };
    }
    if (this.failingMethods.has(method)) {
      record("failed");
      return { status: 200, error: { code: -32603, message: "internal error" } };
    }
    switch (method) {
      case "eth_chainId":
        record("ok");
        return { status: 200, result: hex(this.chainId) };
      case "eth_blockNumber":
        record("ok");
        return { status: 200, result: hex(this.head) };
      case "eth_call":
        record("ok");
        return { status: 200, result: `0x${42n.toString(16).padStart(64, "0")}` };
      case "eth_estimateGas":
        record("ok");
        return { status: 200, result: hex(21_000n) };
      case "eth_getBalance":
        record("ok");
        return { status: 200, result: "0x0" };
      case "eth_sendRawTransaction":
        record("ok");
        return { status: 200, result: `0x${"ab".repeat(32)}` };
      case "eth_getLogs":
        return this.getLogs(params, at, record);
      default:
        record("failed");
        return { status: 200, error: { code: -32601, message: `method ${method} not found` } };
    }
  }

  private getLogs(
    params: readonly unknown[],
    at: number,
    record: (outcome: FakeOutcome, span?: bigint) => void,
  ): FakeAnswer {
    const filter = (params[0] ?? {}) as { fromBlock?: unknown; toBlock?: unknown };
    const from = blockParam(filter.fromBlock, this.head);
    const to = blockParam(filter.toBlock, this.head);
    const span = to - from + 1n;
    while ((this.acceptedLogs[0] ?? Number.POSITIVE_INFINITY) <= at - this.logsWindowMs) {
      this.acceptedLogs.shift();
    }
    if (this.acceptedLogs.length >= this.logsPerWindow) {
      record("rate-limited", span);
      return { status: 429, error: { code: -32005, message: "rate limit exceeded" } };
    }
    if (span >= this.refusedSpan) {
      record("too-large", span);
      return { status: 200, error: { code: -32012, message: "requested range too large" } };
    }
    this.acceptedLogs.push(at);
    record("ok", span);
    return { status: 200, result: [] };
  }

  /** Serves the node over HTTP on a free local port; resolves with its URL. */
  async listen(): Promise<string> {
    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        let body: { id?: unknown; method?: unknown; params?: unknown };
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as typeof body;
        } catch {
          response.writeHead(400, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700 } }));
          return;
        }
        const answer = this.handle(
          String(body.method),
          Array.isArray(body.params) ? (body.params as unknown[]) : [],
        );
        response.writeHead(answer.status, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id ?? null,
            ...(answer.error ? { error: answer.error } : { result: answer.result }),
          }),
        );
      });
    });
    this.server = server;
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${port.toString()}`;
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /** The node in-process, as a viem transport: errors carry the node's code and message. */
  transport(): CustomTransport {
    const request = async ({
      method,
      params,
    }: {
      method: string;
      params?: unknown;
    }): Promise<unknown> => {
      await Promise.resolve();
      const answer = this.handle(method, Array.isArray(params) ? (params as unknown[]) : []);
      if (answer.error) throw new FakeNodeError(answer.error.code, answer.error.message);
      return answer.result;
    };
    return custom({ request: request as unknown as EIP1193RequestFn });
  }
}
