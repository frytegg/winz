import {
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  keccak256,
  parseEventLogs,
  toHex,
  type Address,
  type Chain,
  type Hex,
  type Log,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { ARC_TESTNET_CHAIN_ID, winzEscrowAbi } from "@winz/shared";

import { demoWalletKey } from "../../../engine/src/identity";
import { WaitTimeoutError } from "../support/wait";
import { WEI_PER_MICRO, formatWei } from "./estimate";
import { backoffDelayMs, classifyFailure, describeFailure, sleep } from "./rpc";
import type { BalanceRow, CampaignStage, MoneyMode, RetryPolicy, SweepRecordRow } from "./types";

/**
 * What the rehearsal reads from the chain, and the one thing it writes itself: the sweep of the
 * demo wallets. Everything else on-chain is sent by the engine. Every function takes the runner's
 * client (`meteredClient`), so that each request is counted and goes through the engine's limiter.
 */

/** Arc's USDC: the native coin behind an ERC-20 interface at this address. */
export const ARC_USDC_ADDRESS: Address = "0x3600000000000000000000000000000000000000";

/** Native coin on Arc, an ERC-20 test token elsewhere. */
export function moneyModeOf(chainId: number, token: Address): MoneyMode {
  return chainId === ARC_TESTNET_CHAIN_ID && getAddress(token) === ARC_USDC_ADDRESS
    ? "native-usdc"
    : "erc20";
}

export interface EscrowRoles {
  relayer: Address;
  oracle: Address;
  treasury: Address;
  token: Address;
}

/** The roles the escrow holds, read from the contract. */
export async function readEscrowRoles(client: PublicClient, escrow: Address): Promise<EscrowRoles> {
  const [relayer, oracle, treasury, token] = await Promise.all([
    client.readContract({ address: escrow, abi: winzEscrowAbi, functionName: "relayer" }),
    client.readContract({ address: escrow, abi: winzEscrowAbi, functionName: "oracle" }),
    client.readContract({ address: escrow, abi: winzEscrowAbi, functionName: "treasury" }),
    client.readContract({ address: escrow, abi: winzEscrowAbi, functionName: "usdc" }),
  ]);
  return {
    relayer: getAddress(relayer),
    oracle: getAddress(oracle),
    treasury: getAddress(treasury),
    token: getAddress(token),
  };
}

/**
 * The money an account holds, in 18-decimal units: on Arc its native balance (which is its USDC,
 * gas included), elsewhere its token balance × 10^12.
 */
export async function moneyOf(
  client: PublicClient,
  mode: MoneyMode,
  token: Address,
  account: Address,
): Promise<bigint> {
  if (mode === "native-usdc") return client.getBalance({ address: account });
  const balance = await client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account],
  });
  return balance * WEI_PER_MICRO;
}

export async function allowanceOf(
  client: PublicClient,
  token: Address,
  owner: Address,
  spender: Address,
): Promise<bigint> {
  return client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, spender],
  });
}

export interface Party {
  role: string;
  address: Address;
}

/** How one request of a larger read is made: the runner passes its retry (`read`). */
export type ReadEach = <T>(what: string, body: () => Promise<T>) => Promise<T>;

const readOnce: ReadEach = (_what, body) => body();

/**
 * Each party's money and native balance, at the latest block. A repeated address is read once.
 *
 * Every request goes through `each` on its own, so that a retry repeats the one request a node
 * refused and keeps the balances already read. Retrying the snapshot as a whole instead repeats
 * every request of it (two per party) for one refusal, and the more parties, the less likely an
 * attempt gets through: on the test's node, which refuses a share of the reads, eight attempts at
 * the balances after settlement all failed in a CI run and in one local run of two (18 Nov), and
 * the run then had no invariant to show. A public node that rate-limits does the same.
 */
export async function snapshot(
  client: PublicClient,
  mode: MoneyMode,
  token: Address,
  parties: readonly Party[],
  each: ReadEach = readOnce,
): Promise<BalanceRow[]> {
  const rows: BalanceRow[] = [];
  for (const party of parties) {
    const [moneyWei, nativeWei] = await Promise.all([
      each(`the money of ${party.role}`, () => moneyOf(client, mode, token, party.address)),
      each(`the native balance of ${party.role}`, () =>
        client.getBalance({ address: party.address }),
      ),
    ]);
    rows.push({ role: party.role, address: party.address, moneyWei, nativeWei });
  }
  return rows;
}

export interface OnchainCampaignState {
  merchant: Address;
  hedgeBudget: bigint;
  hedgeReserved: bigint;
  hedgeSpent: bigint;
  lockedRefunds: bigint;
  merchantDue: bigint;
  salesClose: bigint;
  status: number;
  released: boolean;
}

export async function readCampaign(
  client: PublicClient,
  escrow: Address,
  id: bigint,
): Promise<OnchainCampaignState> {
  const campaign = await client.readContract({
    address: escrow,
    abi: winzEscrowAbi,
    functionName: "getCampaign",
    args: [id],
  });
  return {
    merchant: getAddress(campaign.merchant),
    hedgeBudget: campaign.hedgeBudget,
    hedgeReserved: campaign.hedgeReserved,
    hedgeSpent: campaign.hedgeSpent,
    lockedRefunds: campaign.lockedRefunds,
    merchantDue: campaign.merchantDue,
    salesClose: campaign.salesClose,
    status: campaign.status,
    released: campaign.released,
  };
}

/** The stage of a campaign, from the escrow's state and the latest block's timestamp. */
export function stageOf(state: OnchainCampaignState, blockTimestamp: bigint): CampaignStage {
  if (state.released) return "released";
  if (state.status === 2) return "settled yes";
  if (state.status === 3) return "settled no";
  if (state.status === 4) return "void";
  if (state.salesClose <= blockTimestamp) return "sales closed";
  return state.status === 1 ? "paused" : "selling";
}

/**
 * What the escrow holds for the campaign, micro-USDC: the unspent budget until it is released,
 * the refunds still locked and the merchant's due not yet paid.
 */
export function escrowHolds(state: OnchainCampaignState): bigint {
  const unspent = state.released ? 0n : state.hedgeBudget - state.hedgeSpent;
  return unspent + state.lockedRefunds + state.merchantDue;
}

// ---------------------------------------------------------------------------------------------
// Events of one campaign: the escrow's logs read in bounded spans, never in a tight loop
// ---------------------------------------------------------------------------------------------

export interface CampaignEvents {
  created: { budget: bigint; block: bigint }[];
  purchased: {
    ticketId: bigint;
    buyer: Address;
    qty: number;
    paid: bigint;
    refundable: bigint;
    maxHedgeCost: bigint;
    block: bigint;
  }[];
  charged: { ticketId: bigint; amount: bigint; block: bigint; hash: Hex }[];
  settled: { outcome: number; merchantDue: bigint; block: bigint; hash: Hex }[];
  refunded: { ticketId: bigint; buyer: Address; amount: bigint; block: bigint; hash: Hex }[];
  refundFailed: { ticketId: bigint; block: bigint }[];
  merchantPaid: { amount: bigint; block: bigint }[];
  released: { block: bigint }[];
}

/**
 * Blocks per `eth_getLogs`. Arc's public RPC refuses spans of 10 000 blocks and, under load, of
 * 2 000; 1 000 are accepted.
 */
export const LOG_SPAN_BLOCKS = 1_000n;

function blockOf(log: { blockNumber: bigint | null }): bigint {
  return log.blockNumber ?? 0n;
}

function hashOf(log: { transactionHash: Hex | null }): Hex {
  return log.transactionHash ?? "0x";
}

export function emptyCampaignEvents(): CampaignEvents {
  return {
    created: [],
    purchased: [],
    charged: [],
    settled: [],
    refunded: [],
    refundFailed: [],
    merchantPaid: [],
    released: [],
  };
}

/** The spans `[from, to]` of at most `span` blocks that cover `fromBlock` to `toBlock`. Pure. */
export function logSpans(
  fromBlock: bigint,
  toBlock: bigint,
  span: bigint = LOG_SPAN_BLOCKS,
): { fromBlock: bigint; toBlock: bigint }[] {
  const spans: { fromBlock: bigint; toBlock: bigint }[] = [];
  for (let from = fromBlock; from <= toBlock; from += span) {
    const to = from + span - 1n < toBlock ? from + span - 1n : toBlock;
    spans.push({ fromBlock: from, toBlock: to });
  }
  return spans;
}

/** Adds the campaign `id`'s events among `logs` (any escrow logs, decoded or not) to `into`. */
export function addCampaignEvents(into: CampaignEvents, logs: readonly Log[], id: bigint): void {
  for (const log of parseEventLogs({ abi: winzEscrowAbi, logs: [...logs], strict: true })) {
    switch (log.eventName) {
      case "CampaignCreated":
        if (log.args.id === id) into.created.push({ budget: log.args.budget, block: blockOf(log) });
        break;
      case "TicketPurchased":
        if (log.args.id === id) {
          into.purchased.push({
            ticketId: log.args.ticketId,
            buyer: getAddress(log.args.buyer),
            qty: Number(log.args.qty),
            paid: log.args.paid,
            refundable: log.args.refundable,
            maxHedgeCost: log.args.maxHedgeCost,
            block: blockOf(log),
          });
          into.purchased.sort((a, b) =>
            a.ticketId < b.ticketId ? -1 : a.ticketId > b.ticketId ? 1 : 0,
          );
        }
        break;
      case "HedgeCharged":
        if (log.args.id === id) {
          into.charged.push({
            ticketId: log.args.ticketId,
            amount: log.args.amount,
            block: blockOf(log),
            hash: hashOf(log),
          });
        }
        break;
      case "CampaignSettled":
        if (log.args.id === id) {
          into.settled.push({
            outcome: Number(log.args.outcome),
            merchantDue: log.args.merchantDue,
            block: blockOf(log),
            hash: hashOf(log),
          });
        }
        break;
      case "TicketRefunded":
        if (log.args.id === id) {
          into.refunded.push({
            ticketId: log.args.ticketId,
            buyer: getAddress(log.args.buyer),
            amount: log.args.amount,
            block: blockOf(log),
            hash: hashOf(log),
          });
        }
        break;
      case "RefundFailed":
        if (log.args.id === id) {
          into.refundFailed.push({ ticketId: log.args.ticketId, block: blockOf(log) });
        }
        break;
      case "MerchantPaid":
        if (log.args.id === id)
          into.merchantPaid.push({ amount: log.args.amount, block: blockOf(log) });
        break;
      case "CampaignReleased":
        if (log.args.id === id) into.released.push({ block: blockOf(log) });
        break;
      default:
        break;
    }
  }
}

/**
 * Follows the escrow's logs of one campaign: each `catchUp` reads the blocks mined since the
 * previous one, in spans of `LOG_SPAN_BLOCKS`, with one `eth_getLogs` per span (every event of
 * the escrow at once, filtered here) and nothing when no block was mined. A span that fails is
 * read again by the next `catchUp`, from the same block.
 */
export class CampaignLogFollower {
  private readonly collected = emptyCampaignEvents();
  private next: bigint;

  constructor(
    private readonly client: PublicClient,
    private readonly escrow: Address,
    private readonly id: bigint,
    fromBlock: bigint,
  ) {
    this.next = fromBlock;
  }

  /** The first block not read yet. */
  get nextBlock(): bigint {
    return this.next;
  }

  /** Reads up to the head; returns the head it read to. */
  async catchUp(): Promise<bigint> {
    // Uncached: the client otherwise answers the same block number for a while.
    const head = await this.client.getBlockNumber({ cacheTime: 0 });
    for (const span of logSpans(this.next, head)) {
      const logs = await this.client.getLogs({ address: this.escrow, ...span });
      addCampaignEvents(this.collected, logs, this.id);
      this.next = span.toBlock + 1n;
    }
    return head;
  }

  events(): CampaignEvents {
    return {
      created: [...this.collected.created],
      purchased: [...this.collected.purchased],
      charged: [...this.collected.charged],
      settled: [...this.collected.settled],
      refunded: [...this.collected.refunded],
      refundFailed: [...this.collected.refundFailed],
      merchantPaid: [...this.collected.merchantPaid],
      released: [...this.collected.released],
    };
  }

  /** Distinct tickets charged so far. */
  chargedTickets(): number {
    return new Set(this.collected.charged.map((charge) => charge.ticketId)).size;
  }
}

/** Every escrow event of the campaign `id` since `fromBlock`, read in bounded spans. */
export async function campaignEvents(
  client: PublicClient,
  escrow: Address,
  id: bigint,
  fromBlock: bigint,
): Promise<CampaignEvents> {
  const follower = new CampaignLogFollower(client, escrow, id, fromBlock);
  await follower.catchUp();
  return follower.events();
}

// ---------------------------------------------------------------------------------------------
// When each block was first seen: the wall clock of the refund timing
// ---------------------------------------------------------------------------------------------

/**
 * The wall-clock instant at which the runner first saw the head reach each block, from one
 * `eth_blockNumber` every `intervalMs`. Block timestamps are whole seconds and the outbox's
 * mined_at is the block time, so this is the only wall clock there is; it is late by at most the
 * interval and one round trip (about one block on Arc).
 */
export class BlockClock {
  /** Heads seen, in order, with the instant each was first seen. */
  readonly seen: { block: bigint; atMs: number }[] = [];
  private stopped = false;
  private wake: (() => void) | null = null;
  private loop: Promise<void> | null = null;

  constructor(
    private readonly client: PublicClient,
    private readonly intervalMs: number,
  ) {}

  /** Records a head seen at `atMs` (ignored when it is not newer). */
  note(block: bigint, atMs: number): void {
    const last = this.seen[this.seen.length - 1];
    if (last === undefined || block > last.block) this.seen.push({ block, atMs });
  }

  /** The instant the head was first seen at `block` or later, or null when it never was. */
  firstSeenAtMs(block: bigint): number | null {
    return this.seen.find((entry) => entry.block >= block)?.atMs ?? null;
  }

  start(): void {
    if (this.loop !== null) return;
    this.loop = (async (): Promise<void> => {
      while (!this.stopped) {
        await this.tick();
        await new Promise<void>((resolveTick) => {
          const timer = setTimeout(resolveTick, this.intervalMs);
          this.wake = () => {
            clearTimeout(timer);
            resolveTick();
          };
        });
        this.wake = null;
      }
    })();
  }

  async tick(): Promise<void> {
    try {
      const block = await this.client.getBlockNumber({ cacheTime: 0 });
      this.note(block, Date.now());
    } catch {
      // A missed tick costs precision, not correctness: the next one sees the head.
    }
  }

  /** Stops polling, then reads the head once more. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.wake?.();
    await this.loop;
    await this.tick();
  }
}

// ---------------------------------------------------------------------------------------------
// The sweep: every demo wallet back to the treasury, through the runner's client
// ---------------------------------------------------------------------------------------------

export interface SweepInput {
  /** The runner's client: the sweep's reads and broadcasts go through the engine's limiter. */
  client: PublicClient;
  chain: Chain;
  mode: MoneyMode;
  token: Address;
  seed: Hex;
  wallets: readonly { label: string; email: string }[];
  destination: Address;
  /** A local chain: the token sweep may give each wallet its gas with `anvil_setBalance`. */
  local: boolean;
  policy: RetryPolicy;
  out: (line: string) => void;
  /** Called before each retry of a wallet, for the counts of the receipt. */
  onRetry?: () => void;
  /** Longest wait for one transfer to be mined. Default 120 000 ms. */
  minedTimeoutMs?: number;
}

/** A sweep transfer was mined and reverted: the wallet still holds its money. */
export class SweepRevertedError extends Error {
  constructor(public readonly hash: Hex) {
    super(`transfer ${hash} reverted`);
    this.name = "SweepRevertedError";
  }
}

/** Gas a token transfer is given; the wallet is topped up with twice its cost. */
const TOKEN_TRANSFER_GAS = 80_000n;
/** Gas of a plain native transfer to an account without code. */
const NATIVE_TRANSFER_GAS = 21_000n;

type LooseRequest = (args: { method: string; params?: unknown }) => Promise<unknown>;

/** Polls the receipt of `hash` until it is mined; transient read failures are waited out. */
async function waitMined(
  client: PublicClient,
  hash: Hex,
  timeoutMs: number,
): Promise<TransactionReceipt> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  for (;;) {
    try {
      return await client.getTransactionReceipt({ hash });
    } catch (error: unknown) {
      if (!(error instanceof TransactionReceiptNotFoundError)) {
        if (classifyFailure(error) === "permanent") throw error;
        lastError = error;
      }
    }
    if (Date.now() >= deadline) {
      throw new WaitTimeoutError(
        `timed out after ${timeoutMs.toString()} ms waiting for ${hash} to be mined` +
          (lastError === null ? "" : `; last error: ${describeFailure(lastError)}`),
      );
    }
    await sleep(500);
  }
}

/** What the node knows of a transaction: mined (with its receipt), pending, or nothing. */
type Lookup =
  { kind: "mined"; receipt: TransactionReceipt } | { kind: "pending" } | { kind: "unknown" };

async function lookUp(client: PublicClient, hash: Hex): Promise<Lookup> {
  try {
    return { kind: "mined", receipt: await client.getTransactionReceipt({ hash }) };
  } catch (error: unknown) {
    if (!(error instanceof TransactionReceiptNotFoundError)) throw error;
  }
  try {
    await client.getTransaction({ hash });
    return { kind: "pending" };
  } catch (error: unknown) {
    if (error instanceof TransactionNotFoundError) return { kind: "unknown" };
    throw error;
  }
}

/**
 * What a node answers to a broadcast of bytes it already holds (pending, or mined: the nonce is
 * then used). For the same signed bytes, that is a success: the transfer is the node's already.
 */
const ALREADY_KNOWN = /already known|already imported|known transaction|nonce too low/i;

function alreadyKnown(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 12 && typeof current === "object" && current !== null; depth += 1) {
    const fields = current as { message?: unknown; shortMessage?: unknown; details?: unknown };
    for (const text of [fields.message, fields.shortMessage, fields.details]) {
      if (typeof text === "string" && ALREADY_KNOWN.test(text)) return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** A transfer the sweep signed, recorded by its hash before it is broadcast. */
interface SignedTransfer {
  hash: Hex;
  /** The signed bytes: a re-broadcast sends exactly these, never a new signature. */
  raw: Hex;
  sentWei: bigint;
}

interface WalletSweep {
  row: SweepRecordRow;
  /** A transfer signed by an earlier attempt or this one whose outcome is not known yet. */
  pending: SignedTransfer | null;
}

/**
 * Broadcasts `state.pending`. When the broadcast fails, the node is asked about the transfer's
 * hash before anything is decided: a node that holds it (pending or mined), or answers that it
 * already does, has it, and it is waited for. A node that does not know it after a refusal
 * (a permanent failure) never took it: `pending` is cleared. After a transient failure the
 * transfer stays pending, and the next attempt looks it up again.
 */
async function broadcast(client: PublicClient, state: WalletSweep): Promise<void> {
  const transfer = state.pending;
  if (transfer === null) throw new Error("no transfer to broadcast");
  try {
    await (client.request as unknown as LooseRequest)({
      method: "eth_sendRawTransaction",
      params: [transfer.raw],
    });
    return;
  } catch (error: unknown) {
    if (alreadyKnown(error)) return;
    let found: Lookup;
    try {
      found = await lookUp(client, transfer.hash);
    } catch {
      // The node cannot be asked now: the transfer stays pending and is looked up again.
      throw error;
    }
    if (found.kind !== "unknown") return;
    if (classifyFailure(error) === "permanent") state.pending = null;
    throw error;
  }
}

/** Signs, without sending, the transfer of the wallet's whole money; null when it holds none. */
async function signTransfer(
  input: SweepInput,
  key: Hex,
  address: Address,
): Promise<SignedTransfer | null> {
  const { client } = input;
  const account = privateKeyToAccount(key);
  if (input.mode === "native-usdc") {
    const [balance, fees] = await Promise.all([
      client.getBalance({ address }),
      client.estimateFeesPerGas(),
    ]);
    const price = fees.maxFeePerGas;
    const gasWei = NATIVE_TRANSFER_GAS * price;
    if (balance <= gasWei) return null;
    const value = balance - gasWei;
    const nonce = await client.getTransactionCount({ address, blockTag: "pending" });
    const raw = await account.signTransaction({
      type: "eip1559",
      chainId: input.chain.id,
      nonce,
      to: input.destination,
      value,
      gas: NATIVE_TRANSFER_GAS,
      // One fixed price (max fee = priority fee): the wallet ends at exactly zero.
      maxFeePerGas: price,
      maxPriorityFeePerGas: price,
    });
    return { hash: keccak256(raw), raw, sentWei: value };
  }
  const balance = await client.readContract({
    address: input.token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  });
  if (balance === 0n) return null;
  if (!input.local) throw new Error("a token sweep with gas top-ups is for local chains only");
  const fees = await client.estimateFeesPerGas();
  const topUp = TOKEN_TRANSFER_GAS * fees.maxFeePerGas * 2n;
  const native = await client.getBalance({ address });
  if (native < topUp) {
    // Local chains only: no role key sends anything, so the engine's nonces are untouched.
    await (client.request as unknown as LooseRequest)({
      method: "anvil_setBalance",
      params: [address, toHex(topUp)],
    });
  }
  const nonce = await client.getTransactionCount({ address, blockTag: "pending" });
  const raw = await account.signTransaction({
    type: "eip1559",
    chainId: input.chain.id,
    nonce,
    to: input.token,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [input.destination, balance],
    }),
    gas: TOKEN_TRANSFER_GAS,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  });
  return { hash: keccak256(raw), raw, sentWei: balance * WEI_PER_MICRO };
}

/** The row of a transfer mined: swept with its hash, or failed (and thrown) when it reverted. */
function settleRow(
  row: SweepRecordRow,
  transfer: SignedTransfer,
  receipt: TransactionReceipt,
): void {
  row.txHash = transfer.hash;
  row.gasWei = receipt.gasUsed * receipt.effectiveGasPrice;
  if (receipt.status !== "success") {
    // The wallet still holds its money: reported failed, with the transfer it caused.
    throw new SweepRevertedError(transfer.hash);
  }
  row.status = "swept";
  row.sentWei = transfer.sentWei;
}

async function sweepOnce(input: SweepInput, key: Hex, state: WalletSweep): Promise<void> {
  const { client } = input;
  const row = state.row;
  const timeoutMs = input.minedTimeoutMs ?? 120_000;
  if (state.pending !== null) {
    // An earlier attempt signed a transfer whose answer is not known: find out what became of
    // it before anything else. A node that does not know it is sent the same bytes again.
    const found = await lookUp(client, state.pending.hash);
    if (found.kind === "unknown") {
      try {
        await broadcast(client, state);
      } catch (error: unknown) {
        // Refused (`pending` cleared): none of it reached the node, a new one is signed below.
        if (state.pending !== null) throw error;
      }
    }
    const transfer = state.pending;
    if (transfer !== null) {
      const receipt =
        found.kind === "mined" ? found.receipt : await waitMined(client, transfer.hash, timeoutMs);
      state.pending = null;
      settleRow(row, transfer, receipt);
      return;
    }
  }

  const transfer = await signTransfer(input, key, row.address);
  if (transfer === null) {
    row.status = "empty";
    return;
  }
  // Recorded before the broadcast: an answer lost on the way back cannot lose the transfer.
  state.pending = transfer;
  await broadcast(client, state);
  const receipt = await waitMined(client, transfer.hash, timeoutMs);
  state.pending = null;
  settleRow(row, transfer, receipt);
}

/**
 * Sends each demo wallet's money to `destination`: on Arc its whole native balance minus the gas
 * of the transfer (as the engine's `sweepDemoWallets`), on a local chain its whole token balance
 * after `anvil_setBalance` gave it the gas. Every request goes through the runner's client. Each
 * transfer is signed here and recorded by its hash before `eth_sendRawTransaction`: when the
 * broadcast fails, or its answer is lost after the node took it, the hash is looked up (mined,
 * pending, or unknown to the node) before anything else, a transfer the node holds is waited for
 * and never signed again, and one it does not know is sent again as the same bytes. A wallet that
 * fails for a moment is tried again (`policy`, doubling delays); a wallet still failing is
 * reported `failed`, with the hash of any transfer it signed, and the others are still swept.
 */
export async function sweepWallets(input: SweepInput): Promise<SweepRecordRow[]> {
  const results: SweepRecordRow[] = [];
  for (const wallet of input.wallets) {
    const key = demoWalletKey(input.seed, wallet.email);
    const address = privateKeyToAccount(key).address;
    const state: WalletSweep = {
      row: {
        wallet: wallet.label,
        address,
        status: "empty",
        sentWei: 0n,
        gasWei: 0n,
        txHash: null,
      },
      pending: null,
    };
    results.push(state.row);
    if (address === input.destination) continue;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= input.policy.attempts; attempt += 1) {
      if (attempt > 1) {
        input.onRetry?.();
        await sleep(backoffDelayMs(input.policy, attempt - 1));
      }
      try {
        await sweepOnce(input, key, state);
        lastError = null;
        break;
      } catch (error: unknown) {
        lastError = error;
        if (classifyFailure(error) === "permanent" && state.pending === null) break;
      }
    }
    const row = state.row;
    if (lastError !== null) {
      row.status = "failed";
      if (state.pending !== null) row.txHash = state.pending.hash;
      input.out(
        `sweep ${wallet.label} ${address}: failed (${describeFailure(lastError)})` +
          (state.pending === null
            ? ""
            : `; transfer ${state.pending.hash} signed, not seen mined (the node may still hold it)`),
      );
    } else if (row.status === "swept") {
      input.out(
        `sweep ${wallet.label} ${address}: ${formatWei(row.sentWei, 18)} USDC sent back (tx ${String(row.txHash)})`,
      );
    } else {
      input.out(`sweep ${wallet.label} ${address}: empty`);
    }
  }
  return results;
}

/**
 * What the sweep left in the demo wallets, one sentence each, from the balances read after it
 * (`after`; null when they could not be read): a wallet that still holds money, and a wallet
 * whose sweep failed unless its balance was read at zero (its transfer was mined after all, or
 * there was nothing to bring back). Pure.
 */
export function walletsLeftBehind(
  sweep: readonly SweepRecordRow[],
  after: readonly BalanceRow[] | null,
  wallets: readonly { label: string; address: Address }[],
): string[] {
  const lines: string[] = [];
  for (const wallet of wallets) {
    const balance = after?.find((row) => row.address === wallet.address);
    const failed = sweep.some((row) => row.address === wallet.address && row.status === "failed");
    if (balance === undefined) {
      if (failed) {
        lines.push(
          `${wallet.label} ${wallet.address} was not swept, and its balance after the sweep could not be read`,
        );
      }
    } else if (balance.moneyWei > 0n) {
      lines.push(
        failed
          ? `${wallet.label} ${wallet.address} was not swept: it still holds ${formatWei(balance.moneyWei, 18)} USDC`
          : `${wallet.label} ${wallet.address} still holds ${formatWei(balance.moneyWei, 18)} USDC after the sweep`,
      );
    }
  }
  return lines;
}
