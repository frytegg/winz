import { decodeErrorResult, isHex, type Hex } from "viem";

import { winzEscrowAbi } from "@winz/shared";

const MAX_CAUSE_DEPTH = 12;
const MAX_DESCRIPTION_LENGTH = 300;

/** What a failed `eth_call` / `eth_estimateGas` says about the transaction. */
export type SimulationVerdict =
  /** The call itself reverts, or the signer cannot pay for it: sending it would be pointless. */
  | { kind: "revert"; reason: string; data?: Hex }
  /** The node could not answer (network, rate limit, internal error): worth another try. */
  | { kind: "transient"; reason: string };

/** What a failed `eth_sendRawTransaction` says about the transaction. */
export type BroadcastVerdict =
  /** The node already has it, or its nonce is already mined: it was broadcast before. */
  | "already-broadcast"
  /** Another transaction with the same nonce and a better fee is in the mempool. */
  | "underpriced"
  | "other";

interface ErrorLink {
  name?: string;
  code?: number;
  data?: unknown;
  message?: string;
  details?: string;
  shortMessage?: string;
}

/** The error and its causes, outermost first. */
function errorChain(error: unknown): ErrorLink[] {
  const links: ErrorLink[] = [];
  let current: unknown = error;
  for (
    let depth = 0;
    depth < MAX_CAUSE_DEPTH && current !== null && current !== undefined;
    depth += 1
  ) {
    if (typeof current === "string") {
      links.push({ message: current });
      break;
    }
    if (typeof current !== "object") break;
    const source = current as Record<string, unknown>;
    links.push({
      ...(typeof source.name === "string" ? { name: source.name } : {}),
      ...(typeof source.code === "number" ? { code: source.code } : {}),
      ...("data" in source ? { data: source.data } : {}),
      ...(typeof source.message === "string" ? { message: source.message } : {}),
      ...(typeof source.details === "string" ? { details: source.details } : {}),
      ...(typeof source.shortMessage === "string" ? { shortMessage: source.shortMessage } : {}),
    });
    current = source.cause;
  }
  return links;
}

/**
 * What the node said, without what viem adds around it. viem's `message` embeds the RPC URL
 * (which carries the provider's API token) and the request body: neither belongs in a log line
 * or in `chain_txs.last_error`.
 */
function nodeMessages(links: readonly ErrorLink[]): string[] {
  const messages: string[] = [];
  for (const link of links) {
    if (link.details !== undefined) messages.push(link.details);
    // A link without `shortMessage` is not a viem error: its message is the node's or Node.js's.
    else if (link.shortMessage === undefined && link.message !== undefined) {
      messages.push(link.message);
    }
  }
  return messages;
}

function revertData(links: readonly ErrorLink[]): Hex | undefined {
  for (const link of links) {
    const candidate =
      typeof link.data === "object" && link.data !== null
        ? (link.data as Record<string, unknown>).data
        : link.data;
    if (typeof candidate === "string" && isHex(candidate) && candidate.length >= 10) {
      return candidate.toLowerCase() as Hex;
    }
  }
  return undefined;
}

/**
 * Name of the `WinzEscrow` custom error carried by revert data. For Solidity's built-in errors:
 * the reason string of `Error(string)`, `Panic(0x..)` for a panic. Unknown data is returned as is.
 */
export function decodeRevertData(data: Hex): string {
  try {
    const decoded = decodeErrorResult({ abi: winzEscrowAbi, data });
    const name: string = decoded.errorName;
    const args: readonly unknown[] = decoded.args ?? [];
    if (name === "Error") return typeof args[0] === "string" && args[0] !== "" ? args[0] : "Error";
    if (name === "Panic") {
      return typeof args[0] === "bigint" ? `Panic(0x${args[0].toString(16)})` : "Panic";
    }
    return name;
  } catch {
    // Not an error of this ABI (another contract's): the raw data is the best reason there is.
    return data;
  }
}

const REVERT_NAMES = new Set(["ExecutionRevertedError", "ContractFunctionRevertedError"]);
const REVERT_PATTERN =
  /execution reverted|vm exception while processing transaction: revert|gas required exceeds allowance/i;
const INSUFFICIENT_FUNDS_PATTERN = /insufficient funds|insufficient balance|exceeds the balance/i;
const ALREADY_BROADCAST_PATTERN =
  /nonce too low|nonce is too low|already known|already imported|already exists|known transaction|already_exists/i;
const UNDERPRICED_PATTERN = /underpriced|fee too low|gas price too low/i;

/** One line saying what went wrong, safe to log and to store. */
export function describeError(error: unknown): string {
  const links = errorChain(error);
  const messages = nodeMessages(links);
  const outer = links[0];
  const text =
    messages[0] ?? outer?.shortMessage ?? outer?.message ?? (error === undefined ? "" : "error");
  const name = outer?.name !== undefined && outer.name !== "Error" ? `${outer.name}: ` : "";
  const line = `${name}${text === "" ? "unknown error" : text}`
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<url>")
    .replace(/\s+/g, " ")
    .trim();
  return line.length > MAX_DESCRIPTION_LENGTH ? `${line.slice(0, MAX_DESCRIPTION_LENGTH)}…` : line;
}

/**
 * Reads the error of a simulation. A revert yields the decoded custom error name, or the raw
 * reason when the data is not an error of `winzEscrowAbi`. A signer that cannot pay for the
 * call is reported as the revert `InsufficientFunds`: the node would refuse the transaction.
 */
export function classifySimulationError(error: unknown): SimulationVerdict {
  const links = errorChain(error);
  const messages = nodeMessages(links);
  const data = revertData(links);
  if (data !== undefined) return { kind: "revert", reason: decodeRevertData(data), data };

  const insufficient =
    links.some((link) => link.name === "InsufficientFundsError") ||
    messages.some((message) => INSUFFICIENT_FUNDS_PATTERN.test(message));
  if (insufficient) return { kind: "revert", reason: "InsufficientFunds" };

  const reverted =
    links.some(
      (link) => link.code === 3 || (link.name !== undefined && REVERT_NAMES.has(link.name)),
    ) || messages.some((message) => REVERT_PATTERN.test(message));
  if (reverted) {
    const raw = messages.find((message) => REVERT_PATTERN.test(message)) ?? "execution reverted";
    // "execution reverted: <reason>" → "<reason>"; a bare "execution reverted" stays as it is.
    const reason = raw.replace(/^.*?execution reverted:?\s*/i, "").trim();
    return { kind: "revert", reason: reason === "" ? "execution reverted" : reason };
  }
  return { kind: "transient", reason: describeError(error) };
}

/** Reads the error of a broadcast. Only the node's own words are matched. */
export function classifyBroadcastError(error: unknown): BroadcastVerdict {
  const messages = nodeMessages(errorChain(error));
  if (messages.some((message) => ALREADY_BROADCAST_PATTERN.test(message))) {
    return "already-broadcast";
  }
  if (messages.some((message) => UNDERPRICED_PATTERN.test(message))) return "underpriced";
  return "other";
}

/** True for the error viem raises while a transaction has no receipt yet. */
export function isReceiptNotFound(error: unknown): boolean {
  return errorChain(error).some((link) => link.name === "TransactionReceiptNotFoundError");
}
