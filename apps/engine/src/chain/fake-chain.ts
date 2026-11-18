/**
 * Test support: an in-process chain with a mempool, behind the `ChainClient` interface the
 * transaction sender uses. It decodes and recovers the signed transactions it is given, keeps
 * them per sender and nonce like a node's pool (replacement needs both fees 10 % higher, a
 * known hash is "already known", a used nonce "nonce too low"), mines blocks on demand or on an
 * interval taking each sender's consecutive nonces, and records every request. It misbehaves on
 * request: refused broadcasts, forgotten transactions, a nonce taken by a foreign transaction, a
 * cap on pending transactions per account, a fee spike that mines nothing below a fee. Test code
 * only.
 *
 * Call data drives execution: byte 0 is the outcome (`FAKE_OK`, `FAKE_SIMULATION_REVERT`,
 * `FAKE_CHAIN_REVERT`), byte 1 says whether the transaction is a barrier, bytes 2..5 are an id
 * whose executions are counted.
 */
import {
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  type Address,
  type Hex,
} from "viem";

import type { CallRequest, ChainClient, FeeSuggestion, TxReceipt } from "./types";

export const FAKE_OK = 0x01;
/** Reverts in simulation (and would on-chain). */
export const FAKE_SIMULATION_REVERT = 0x02;
/** Passes simulation, reverts once mined. */
export const FAKE_CHAIN_REVERT = 0x03;
/** Revert reason the fake chain gives. */
export const FAKE_REVERT_REASON = "FakeRevert";

const GWEI = 1_000_000_000n;

export interface FakeCallData {
  outcome: number;
  barrier: boolean;
  id: number;
}

/** Call data for the fake chain. */
export function fakeCallData(input: FakeCallData): Hex {
  const byte = (value: number): string => value.toString(16).padStart(2, "0");
  return `0x${byte(input.outcome)}${byte(input.barrier ? 1 : 0)}${input.id.toString(16).padStart(8, "0")}`;
}

export function readFakeCallData(data: Hex | undefined): FakeCallData | null {
  if (data === undefined || data.length !== 2 + 12) return null;
  return {
    outcome: Number.parseInt(data.slice(2, 4), 16),
    barrier: data.slice(4, 6) === "01",
    id: Number.parseInt(data.slice(6), 16),
  };
}

/** What a node says when it refuses a request; shaped like the errors the classifiers read. */
export class FakeChainError extends Error {
  constructor(
    message: string,
    readonly code: number = -32000,
  ) {
    super(message);
    this.name = "FakeChainError";
  }
}

/** viem's error name for a receipt that does not exist yet (`isReceiptNotFound`). */
class FakeReceiptNotFoundError extends Error {
  constructor(hash: Hex) {
    super(`Transaction receipt with hash "${hash}" could not be found.`);
    this.name = "TransactionReceiptNotFoundError";
  }
}

export function fakeRateLimit(): FakeChainError {
  return new FakeChainError("rate limit exceeded", -32005);
}

export function fakeTransient(): FakeChainError {
  return new FakeChainError("upstream connect error", -32603);
}

function fakeRevert(): FakeChainError {
  return new FakeChainError(`execution reverted: ${FAKE_REVERT_REASON}`, 3);
}

export interface PoolTx {
  hash: Hex;
  from: Address;
  nonce: bigint;
  data: Hex;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  call: FakeCallData | null;
  /** Wall time the pool first took this hash. */
  acceptedAt: number;
}

export interface MinedTx {
  hash: Hex;
  from: Address;
  nonce: bigint;
  blockNumber: bigint;
  status: "success" | "reverted";
  call: FakeCallData | null;
  /** Wall time of the block. */
  minedAt: number;
  foreign: boolean;
}

export interface FakeRequest {
  method: keyof ChainClient;
  at: number;
}

export interface FakeChainOptions {
  chainId: number;
  /** Pending transactions one account may have in the pool; more are refused. Default: no cap. */
  maxPendingPerAccount?: number;
  /** Transactions per account per block. Default: no limit. */
  maxPerBlock?: number;
}

export class FakeChain implements ChainClient {
  readonly chainId: number;
  readonly requests: FakeRequest[] = [];
  readonly mined: MinedTx[] = [];
  /** Problems the chain saw that a correct sender never causes (a barrier with company...). */
  readonly violations: string[] = [];
  /** Executions per call-data id (mined, successful or reverted). */
  readonly executions = new Map<number, number>();
  maxPendingPerAccount: number;
  maxPerBlock: number;
  /**
   * A fee spike: a transaction whose `maxFeePerGas` is below this is not mined (the base fee is
   * above what it offers), nor is anything after it from its sender. 0 (default): no spike.
   */
  minMaxFeePerGasToMine = 0n;
  /**
   * Asked for every broadcast before the pool looks at it: an error refuses it. Gets the decoded
   * transaction (its sender and nonce).
   */
  refuseBroadcast: ((tx: PoolTx) => Error | undefined) | undefined;
  /** Asked for every request: an error refuses it (a rate limit, an outage). */
  refuseRequest: ((method: keyof ChainClient) => Error | undefined) | undefined;
  /** Accepted broadcasts (new transactions, not "already known"), in order. */
  readonly accepted: PoolTx[] = [];
  private readonly nonces = new Map<string, bigint>();
  private readonly pool = new Map<string, Map<bigint, PoolTx>>();
  private readonly receipts = new Map<Hex, TxReceipt>();
  private readonly blockTimes = new Map<bigint, number>();
  private readonly foreign = new Map<string, Hex>();
  private head = 0n;
  private timer: ReturnType<typeof setInterval> | null = null;
  private fees: FeeSuggestion = { maxFeePerGas: 25n * GWEI, maxPriorityFeePerGas: 1n * GWEI };

  constructor(options: FakeChainOptions) {
    this.chainId = options.chainId;
    this.maxPendingPerAccount = options.maxPendingPerAccount ?? Number.POSITIVE_INFINITY;
    this.maxPerBlock = options.maxPerBlock ?? Number.POSITIVE_INFINITY;
    this.blockTimes.set(0n, Date.now());
  }

  // -------------------------------------------------------------------------------------------
  // Control
  // -------------------------------------------------------------------------------------------

  /** Mines a block every `intervalMs` until `stopMining`. */
  startMining(intervalMs: number): void {
    this.stopMining();
    this.timer = setInterval(() => this.mine(), intervalMs);
  }

  stopMining(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  get blockNumber(): bigint {
    return this.head;
  }

  setFees(fees: FeeSuggestion): void {
    this.fees = fees;
  }

  /** The node forgets a pending transaction. True if it had it. */
  drop(hash: Hex): boolean {
    for (const byNonce of this.pool.values()) {
      for (const [nonce, tx] of byNonce) {
        if (tx.hash === hash) {
          byNonce.delete(nonce);
          return true;
        }
      }
    }
    return false;
  }

  /** Pending transactions of an account, lowest nonce first. */
  pending(address: Address): PoolTx[] {
    const byNonce = this.pool.get(address.toLowerCase()) ?? new Map<bigint, PoolTx>();
    return [...byNonce.values()].sort((a, b) => (a.nonce < b.nonce ? -1 : 1));
  }

  /** Mined nonces of an account. */
  minedCount(address: Address): bigint {
    return this.nonces.get(address.toLowerCase()) ?? 0n;
  }

  /**
   * Another holder of the key sends a transaction with `nonce`: it is mined in the next block in
   * place of whatever the pool holds for that nonce.
   */
  consumeNonce(address: Address, nonce: bigint): void {
    this.foreign.set(
      `${address.toLowerCase()}:${nonce.toString()}`,
      keccak256(`0x${nonce.toString(16).padStart(2, "0")}ff`),
    );
  }

  /** Mines one block: each account's consecutive nonces from its count, up to `maxPerBlock`. */
  mine(): bigint {
    this.head += 1n;
    const now = Date.now();
    this.blockTimes.set(this.head, now);
    const accounts = new Set([
      ...this.pool.keys(),
      ...[...this.foreign.keys()].map((key) => key.split(":")[0] ?? ""),
    ]);
    for (const account of accounts) {
      if (account === "") continue;
      const byNonce = this.pool.get(account) ?? new Map<bigint, PoolTx>();
      let next = this.nonces.get(account) ?? 0n;
      for (let count = 0; count < this.maxPerBlock; count += 1) {
        const foreignHash = this.foreign.get(`${account}:${next.toString()}`);
        if (foreignHash !== undefined) {
          this.foreign.delete(`${account}:${next.toString()}`);
          byNonce.delete(next);
          this.record({
            hash: foreignHash,
            from: account as Address,
            nonce: next,
            blockNumber: this.head,
            status: "success",
            call: null,
            minedAt: now,
            foreign: true,
          });
          next += 1n;
          continue;
        }
        const tx = byNonce.get(next);
        if (!tx || tx.maxFeePerGas < this.minMaxFeePerGasToMine) break;
        byNonce.delete(next);
        const reverted =
          tx.call?.outcome === FAKE_CHAIN_REVERT || tx.call?.outcome === FAKE_SIMULATION_REVERT;
        if (tx.call !== null) {
          this.executions.set(tx.call.id, (this.executions.get(tx.call.id) ?? 0) + 1);
        }
        this.record({
          hash: tx.hash,
          from: tx.from,
          nonce: tx.nonce,
          blockNumber: this.head,
          status: reverted ? "reverted" : "success",
          call: tx.call,
          minedAt: now,
          foreign: false,
        });
        next += 1n;
      }
      this.nonces.set(account, next);
      // Whatever is left below the count can never be mined any more.
      for (const nonce of [...byNonce.keys()]) if (nonce < next) byNonce.delete(nonce);
    }
    return this.head;
  }

  private record(tx: MinedTx): void {
    this.mined.push(tx);
    this.receipts.set(tx.hash, {
      status: tx.status,
      transactionHash: tx.hash,
      blockNumber: tx.blockNumber,
      logs: [],
    });
  }

  /** Requests of a method, or all, made since `since` (epoch ms). */
  count(method?: keyof ChainClient, since = 0): number {
    return this.requests.filter(
      (request) => request.at >= since && (method === undefined || request.method === method),
    ).length;
  }

  private ask(method: keyof ChainClient): void {
    this.requests.push({ method, at: Date.now() });
    const refusal = this.refuseRequest?.(method);
    if (refusal) throw refusal;
  }

  // -------------------------------------------------------------------------------------------
  // ChainClient
  // -------------------------------------------------------------------------------------------

  async getChainId(): Promise<number> {
    await Promise.resolve();
    this.ask("getChainId");
    return this.chainId;
  }

  async call(request: CallRequest & { blockNumber?: bigint }): Promise<unknown> {
    await Promise.resolve();
    this.ask("call");
    const call = readFakeCallData(request.data);
    if (call?.outcome === FAKE_SIMULATION_REVERT) throw fakeRevert();
    // Replayed on its block, a call that reverted once mined reverts again.
    if (call?.outcome === FAKE_CHAIN_REVERT && request.blockNumber !== undefined) {
      throw fakeRevert();
    }
    return "0x";
  }

  async estimateGas(request: CallRequest): Promise<bigint> {
    await Promise.resolve();
    this.ask("estimateGas");
    if (readFakeCallData(request.data)?.outcome === FAKE_SIMULATION_REVERT) throw fakeRevert();
    return 60_000n;
  }

  async estimateFeesPerGas(): Promise<FeeSuggestion> {
    await Promise.resolve();
    this.ask("estimateFeesPerGas");
    return this.fees;
  }

  async getTransactionCount(request: {
    address: Address;
    blockTag: "latest" | "pending";
  }): Promise<number> {
    await Promise.resolve();
    this.ask("getTransactionCount");
    const account = request.address.toLowerCase();
    let count = this.nonces.get(account) ?? 0n;
    if (request.blockTag === "pending") {
      const byNonce = this.pool.get(account);
      while (byNonce?.has(count) === true) count += 1n;
    }
    return Number(count);
  }

  async sendRawTransaction(request: { serializedTransaction: Hex }): Promise<Hex> {
    this.ask("sendRawTransaction");
    const raw = request.serializedTransaction;
    const parsed = parseTransaction(raw);
    const from = (
      await recoverTransactionAddress({ serializedTransaction: raw as never })
    ).toLowerCase() as Address;
    if (parsed.chainId !== this.chainId) throw new FakeChainError("invalid chain id");
    const tx: PoolTx = {
      hash: keccak256(raw),
      from,
      nonce: BigInt(parsed.nonce ?? 0),
      data: parsed.data ?? "0x",
      maxFeePerGas: parsed.maxFeePerGas ?? 0n,
      maxPriorityFeePerGas: parsed.maxPriorityFeePerGas ?? 0n,
      call: readFakeCallData(parsed.data),
      acceptedAt: Date.now(),
    };
    const refusal = this.refuseBroadcast?.(tx);
    if (refusal) throw refusal;
    if (tx.nonce < (this.nonces.get(from) ?? 0n)) throw new FakeChainError("nonce too low");
    const byNonce = this.pool.get(from) ?? new Map<bigint, PoolTx>();
    this.pool.set(from, byNonce);
    const existing = byNonce.get(tx.nonce);
    if (existing?.hash === tx.hash) throw new FakeChainError("already known");
    if (existing) {
      const enough =
        tx.maxFeePerGas * 100n >= existing.maxFeePerGas * 110n &&
        tx.maxPriorityFeePerGas * 100n >= existing.maxPriorityFeePerGas * 110n;
      if (!enough) throw new FakeChainError("replacement transaction underpriced");
    } else if (byNonce.size >= this.maxPendingPerAccount) {
      throw new FakeChainError("txpool is full: too many pending transactions for this account");
    }
    this.checkBarrier(tx, byNonce);
    byNonce.set(tx.nonce, tx);
    this.accepted.push(tx);
    return tx.hash;
  }

  /** A barrier must never share the pool with another transaction of its sender. */
  private checkBarrier(tx: PoolTx, byNonce: Map<bigint, PoolTx>): void {
    for (const other of byNonce.values()) {
      if (other.nonce === tx.nonce) continue;
      if (tx.call?.barrier === true || other.call?.barrier === true) {
        this.violations.push(
          `barrier in flight with another transaction: nonce ${tx.nonce.toString()} (${tx.call?.barrier === true ? "barrier" : "independent"}) beside nonce ${other.nonce.toString()} (${other.call?.barrier === true ? "barrier" : "independent"}) of ${tx.from}`,
        );
      }
    }
  }

  async getTransactionReceipt(request: { hash: Hex }): Promise<TxReceipt> {
    await Promise.resolve();
    this.ask("getTransactionReceipt");
    const receipt = this.receipts.get(request.hash);
    if (!receipt) throw new FakeReceiptNotFoundError(request.hash);
    return receipt;
  }

  async getBlock(request: { blockNumber: bigint }): Promise<{ timestamp: bigint }> {
    await Promise.resolve();
    this.ask("getBlock");
    const at = this.blockTimes.get(request.blockNumber);
    if (at === undefined)
      throw new FakeChainError(`block ${request.blockNumber.toString()} not found`);
    return { timestamp: BigInt(Math.floor(at / 1000)) };
  }
}
