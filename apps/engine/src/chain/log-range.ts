import type { EIP1193RequestFn, Transport } from "viem";

/**
 * An `eth_getLogs` request always names the block it reads up to.
 *
 * Measured on the public RPC of Arc testnet (18 Nov 2026): a filter with a `fromBlock` and no
 * `toBlock` is answered once and then served again as it was, for as long as the same request
 * keeps coming. Asked every three seconds for 21 seconds, it answered 14 logs each time while the
 * same filter with `toBlock: "latest"` went from 14 to 152. A caller polling "everything since
 * block N" therefore never sees what happened after its first question: the rehearsal runner
 * waited ten minutes for four hedge charges that had been mined within six seconds.
 *
 * JSON-RPC defines a missing `toBlock` as "latest", so writing it changes nothing for a node that
 * behaves, and it is what makes this one answer afresh. Every client built by `createArcClients`
 * goes through here, so no caller has to remember it.
 */

type RequestArgs = { method: string; params?: unknown };
type RequestOptions = { signal?: AbortSignal } | undefined;
type LooseRequest = (args: RequestArgs, options?: RequestOptions) => Promise<unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The request with `toBlock: "latest"` written into an `eth_getLogs` filter that has none. Any
 * other request, a filter that names its `toBlock`, and a filter by `blockHash` (which has no
 * range) come back as they are. Pure: the arguments are never changed in place.
 */
export function withExplicitToBlock(args: RequestArgs): RequestArgs {
  if (args.method !== "eth_getLogs" || !Array.isArray(args.params)) return args;
  const [filter, ...rest] = args.params as unknown[];
  if (!isRecord(filter)) return args;
  if (filter.blockHash !== undefined && filter.blockHash !== null) return args;
  if (filter.toBlock !== undefined && filter.toBlock !== null) return args;
  return { ...args, params: [{ ...filter, toBlock: "latest" }, ...rest] };
}

/**
 * `inner`, with every `eth_getLogs` it sends given an explicit `toBlock`. The transport keeps its
 * configuration (name, retries, timeout) and its value: only the request is rewritten.
 */
export function explicitLogRange<T extends Transport>(inner: T): T {
  const wrapped: Transport = (parameters) => {
    const transport = inner(parameters);
    const send = transport.request as unknown as LooseRequest;
    const request: LooseRequest = (args, options) => send(withExplicitToBlock(args), options);
    return { ...transport, request: request as unknown as EIP1193RequestFn };
  };
  return wrapped as T;
}
