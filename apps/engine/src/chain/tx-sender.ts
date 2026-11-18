import type { Logger } from "pino";
import { keccak256, type Address, type Hex, type LocalAccount } from "viem";

import type { Db } from "../db";
import { systemClock } from "./clock";
import {
  classifyBroadcastError,
  classifySimulationError,
  describeError,
  isReceiptNotFound,
} from "./decode-error";
import {
  ChainIdMismatchError,
  ConcurrentTxUpdateError,
  CorruptSenderStateError,
  SignerHistoryMismatchError,
  TxNotFoundError,
  TxSenderConfigError,
  TxSenderError,
  TxSenderStoppedError,
  TxWaitTimeoutError,
} from "./errors";
import { decodeEscrowLogs, readChainEvents } from "./events";
import { addGasMargin, backoffDelayMs, bumpFees, computeFees, type Fees } from "./fees";
import { normalizeTxRequest } from "./request";
import { isRateLimitedError } from "./rpc-errors";
import { isRpcLimiterClosedError } from "./rpc-limiter";
import { resolveTxSenderSettings, type TxSenderSettings } from "./settings";
import { ChainTxStore, readSenderState, type SigningKey } from "./store";
import { isIndependentTxKind } from "./tx-kinds";
import {
  SIGNER_NAMES,
  type CallRequest,
  type ChainClient,
  type ChainTx,
  type Clock,
  type EnqueueResult,
  type FeeSuggestion,
  type SenderState,
  type SignedAttempt,
  type SignerAccounts,
  type SignerName,
  type TxOutcome,
  type TxReceipt,
  type TxRequest,
  type TxSenderConfig,
} from "./types";

export interface TxSenderDeps {
  db: Db;
  /** A viem public client (see `createArcClients`), or anything with the same few methods. */
  client: ChainClient;
  /** One local account per signer. The sender only ever asks them to sign. */
  accounts: SignerAccounts;
  logger: Logger;
  config: TxSenderConfig;
  /** Defaults to the system clock. */
  clock?: Clock;
}

type LifecycleState = "idle" | "running" | "stopping" | "stopped";

/** Consecutive refused broadcasts after which the row and the error log say so. */
const BROADCAST_FAILURES_BEFORE_ALERT = 5;

/** Block times kept in memory: several receipts of one burst share their block's. */
const BLOCK_TIME_CACHE_SIZE = 64;

/**
 * A signed transaction of the signer that is not final yet (`sent`), and what the sender knows
 * of it in this run. Kept in nonce order: index 0 is the earliest unmined one.
 */
interface InFlight {
  tx: ChainTx;
  nonce: bigint;
  state: SenderState;
  /** Its kind may travel with others (`isIndependentTxKind`); otherwise it is a barrier. */
  independent: boolean;
  /** Its stored bytes must (again) reach a node. */
  needsBroadcast: boolean;
  broadcastFailures: number;
  rateLimitedBroadcasts: number;
  nextBroadcastAt: number;
  /**
   * When the replacement timer (`replaceAfterMs`) started: the time a node took its latest
   * attempt, as the one-at-a-time sender measured it. A re-broadcast of the same bytes after the
   * pending-count check does not restart it, so a node whose count never shows the transaction
   * cannot hold off the fee bump and the stuck alert for ever.
   *
   * A transaction cannot be mined before the one before it, so the time it spent behind it does
   * not count in full: when it becomes the earliest (the one before it was recorded mined,
   * reverted or failed), the timer is moved so that at least `resendCheckMs` remain before it can
   * be replaced (`becameEarliest`); with `resendCheckMs >= replaceAfterMs` it simply restarts.
   * One that waited behind a stalled earliest is then not fee-bumped the moment it becomes the
   * earliest, when it would be mined in the next block; under a real fee spike the window
   * recovers one transaction per `resendCheckMs`, not one per `replaceAfterMs`.
   */
  replaceTimerFrom: number;
  /** The next broadcast a node takes restarts the replacement timer (a new attempt, a restart). */
  restartsReplaceTimer: boolean;
  /** Set when the pending-count check found it lost; cleared by the broadcast that follows. */
  lostResend: boolean;
  /** Last time the node's pending count was asked about it. */
  lastLostCheckAt: number;
  /** Set when its nonce is mined but none of its attempts has a receipt. */
  consumedSince: number | null;
  reportedStuck: boolean;
}

interface Worker {
  /** Next nonce to assign, or `null` when it must be derived again from the chain and the table. */
  nextNonce: bigint | null;
  /** Set by `enqueue` so that a wake-up sent while the worker was reading is not lost. */
  dirty: boolean;
  wake: (() => void) | null;
  loop: Promise<void> | null;
  /** Rate-limit answers in a row while preparing: they set the pause, not the give-up count. */
  rateLimitedPrepares: number;
  /** The signer's `sent` transactions, lowest nonce first. */
  inFlight: InFlight[];
  /** No queued row is prepared before this time (a preparation that failed while others fly). */
  prepareNotBefore: number;
  lastReceiptPollAt: number;
  /** Node errors in a row while following the transactions in flight. */
  rpcFailures: number;
  /**
   * Interval of the pending-count check: `resendCheckMs`, doubled up to `replaceAfterMs` while
   * every transaction it sent again came back "already known" (the count, not the pool, was
   * wrong), back to `resendCheckMs` once one was really lost or the count shows everything.
   */
  lostCheckMs: number;
  /** Answers to the re-broadcasts of the last pending-count check. */
  lostResends: { known: number; taken: number };
}

function isTerminal(tx: ChainTx): boolean {
  return tx.status === "mined" || tx.status === "reverted" || tx.status === "failed";
}

function latestAttempt(tx: ChainTx, state: SenderState): SignedAttempt {
  const attempt = state.attempts[state.attempts.length - 1];
  if (!attempt) throw new CorruptSenderStateError(tx.id, "no signed attempt");
  return attempt;
}

/** What preparing the oldest queued row led to. */
interface PrepareResult {
  /** The next queued row may be prepared at once. */
  next: boolean;
  /** Something was broadcast. */
  broadcast: boolean;
}

/**
 * The single on-chain transaction sender of the engine (SPEC section 7). Callers describe a
 * call; the sender owns nonces, fees, broadcast and receipts, with one queue per signer key, so
 * two writers can never use the same nonce.
 *
 * Per signer, up to `maxInFlight` transactions are broadcast and not mined at the same time,
 * with consecutive nonces given in the outbox's order (oldest first), exactly the order a strictly
 * serial sender would have used. Only the kinds declared in `tx-kinds.ts` travel together; any
 * other kind is a barrier: it is prepared once nothing of its signer is in flight, and nothing
 * queued after it is signed until it is mined. A transaction is given nonce n + 1 only once the
 * transaction with nonce n was taken by a node, so a refused broadcast never leaves a gap that
 * later nonces would hang behind. Receipts are recorded in nonce order, and only the earliest
 * unmined transaction is looked up and watched (re-broadcast, fee bump, the stuck alert):
 * transactions of one key are mined in nonce order.
 *
 * The table `chain_txs` is the outbox. A row goes `queued` → `sent` → `mined` | `reverted`,
 * or `queued` → `failed`. The signed transaction is stored in the row before it is broadcast:
 * whatever the moment of a crash, the next `start()` re-broadcasts that same transaction (same
 * hash) instead of signing another one.
 *
 * Nonces belong to a key on a chain: each signed row records `signer_address` and `chain_id`,
 * the next nonce is derived from that key's own history on that chain, and the unique index is
 * `(signer_address, chain_id, nonce)`. The role (`signer`) only names the queue a request goes
 * to. A key can therefore be rotated, or the engine pointed at another chain, on the same
 * database: the new key starts from its own count. The one thing that cannot carry over is an
 * unfinished (`sent`) transaction of the previous key or chain, and `start()` refuses while one
 * exists. The relayer and the oracle must be two different keys (checked at construction):
 * two queues on one key would race for its nonces.
 *
 * Run one sender per database. A second one is held back by the row guards and the unique
 * `(signer_address, chain_id, nonce)` index, but it is not a supported way to scale.
 */
export class TxSender {
  private readonly store: ChainTxStore;
  private readonly db: Db;
  private readonly client: ChainClient;
  private readonly accounts: SignerAccounts;
  private readonly log: Logger;
  private readonly clock: Clock;
  private readonly settings: TxSenderSettings;
  private readonly workers: Record<SignerName, Worker>;
  /** Each role's key, lowercase, on the configured chain. */
  private readonly keys: Record<SignerName, SigningKey>;
  private readonly waiters = new Map<string, Set<() => void>>();
  /** The node's latest fee suggestion and when it was read: one read serves a burst. */
  private feeCache: { suggestion: FeeSuggestion; at: number } | null = null;
  private readonly blockTimes = new Map<bigint, Date>();
  private state: LifecycleState = "idle";
  private stopController = new AbortController();
  private stopPromise: Promise<void> | null = null;

  constructor(deps: TxSenderDeps) {
    this.db = deps.db;
    this.store = new ChainTxStore(deps.db);
    this.client = deps.client;
    this.accounts = deps.accounts;
    this.log = deps.logger;
    this.clock = deps.clock ?? systemClock;
    this.settings = resolveTxSenderSettings(deps.config);
    const keyOf = (signer: SignerName): SigningKey => ({
      signer,
      address: deps.accounts[signer].address.toLowerCase() as Address,
      chainId: this.settings.chainId,
    });
    this.keys = { relayer: keyOf("relayer"), oracle: keyOf("oracle") };
    const addresses = SIGNER_NAMES.map((signer) => this.keys[signer].address);
    if (new Set(addresses).size !== addresses.length) {
      // Two queues on one key would race for the same nonces: each worker caches its next
      // nonce, so both would sign with it and one would hit the unique index or be replaced in
      // the mempool. One key, one role.
      throw new TxSenderConfigError("The relayer and the oracle must be two different keys");
    }
    this.workers = { relayer: this.newWorker(), oracle: this.newWorker() };
  }

  private newWorker(): Worker {
    return {
      nextNonce: null,
      dirty: false,
      wake: null,
      loop: null,
      rateLimitedPrepares: 0,
      inFlight: [],
      prepareNotBefore: 0,
      lastReceiptPollAt: 0,
      rpcFailures: 0,
      lostCheckMs: this.settings.resendCheckMs,
      lostResends: { known: 0, taken: 0 },
    };
  }

  /**
   * `maxInFlight = 1`: the one-at-a-time sender, request for request. Preparation reads the
   * simulation, the gas estimate and a fresh fee suggestion one after the other, and there is no
   * pending-count check (with nothing after the earliest, the fee bump re-broadcasts it).
   */
  private get serial(): boolean {
    return this.settings.maxInFlight === 1;
  }

  // -------------------------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------------------------

  /**
   * Queues a transaction. Safe to repeat: the same idempotency key returns the first row and
   * never creates a second transaction, even if the second request differs.
   */
  async enqueue(request: TxRequest): Promise<EnqueueResult> {
    const input = normalizeTxRequest(request);
    const { tx, created } = await this.store.insertQueued(input);
    if (created) {
      this.log.debug({ id: tx.id, signer: tx.signer, kind: tx.kind }, "transaction queued");
      this.wakeWorker(tx.signer);
    } else if (
      tx.signer !== input.signer ||
      tx.to !== input.to ||
      tx.data !== input.data ||
      tx.value !== input.value
    ) {
      this.log.warn(
        { id: tx.id, idempotencyKey: tx.idempotencyKey, signer: tx.signer, kind: tx.kind },
        "idempotency key reused with a different transaction, the first one stands",
      );
    }
    return { id: tx.id, created };
  }

  /**
   * Resolves once the transaction is final. Rejects with `TxWaitTimeoutError` after `timeoutMs`
   * (the transaction is not cancelled) and with `TxSenderStoppedError` if the sender stops first.
   */
  async waitFor(id: string, options: { timeoutMs: number }): Promise<TxOutcome> {
    const deadline = this.nowMs() + options.timeoutMs;
    for (;;) {
      const controller = new AbortController();
      const release = this.addWaiter(id, () => controller.abort());
      try {
        const tx = await this.store.get(id);
        if (!tx) throw new TxNotFoundError(id);
        if (isTerminal(tx)) return await this.outcomeOf(tx);
        // While stopping, the workers may still finish this transaction: only a full stop ends
        // the wait, and it wakes every waiter so that this check runs again.
        if (this.state === "stopped") throw new TxSenderStoppedError(id, tx.status);
        const remaining = deadline - this.nowMs();
        if (remaining <= 0) throw new TxWaitTimeoutError(id, options.timeoutMs, tx.status);
        await this.clock.sleep(Math.min(remaining, this.settings.waitPollMs), controller.signal);
      } finally {
        release();
      }
    }
  }

  /** `enqueue` then `waitFor`: the outcome carries the escrow events of the transaction. */
  async sendAndWait(request: TxRequest, options: { timeoutMs?: number } = {}): Promise<TxOutcome> {
    const { id } = await this.enqueue(request);
    return this.waitFor(id, { timeoutMs: options.timeoutMs ?? this.settings.defaultWaitTimeoutMs });
  }

  /**
   * Starts one worker per signer. Transactions left `sent` by a previous run are re-broadcast
   * from their stored bytes first, in nonce order. Rejects if the node is unreachable or on
   * another chain, and with `SignerHistoryMismatchError` while a role has a `sent` row of another
   * key or chain.
   */
  async start(): Promise<void> {
    if (this.state === "running") return;
    if (this.state === "stopping") await this.stopPromise;
    let chainId: number;
    try {
      chainId = await this.client.getChainId();
    } catch (error: unknown) {
      throw new TxSenderError(`The node could not be reached: ${describeError(error)}`, {
        cause: error,
      });
    }
    if (chainId !== this.settings.chainId) {
      throw new ChainIdMismatchError(this.settings.chainId, chainId);
    }
    for (const signer of SIGNER_NAMES) await this.checkSignerHistory(signer);
    // A concurrent start() may have won while the node was answering.
    if (!this.stopping) return;
    this.stopController = new AbortController();
    this.state = "running";
    for (const signer of SIGNER_NAMES) {
      const worker = this.workers[signer];
      worker.nextNonce = null;
      worker.inFlight = [];
      worker.prepareNotBefore = 0;
      worker.lastReceiptPollAt = 0;
      worker.rpcFailures = 0;
      worker.rateLimitedPrepares = 0;
      worker.lostCheckMs = this.settings.resendCheckMs;
      worker.lostResends = { known: 0, taken: 0 };
      worker.loop = this.runWorker(signer);
    }
    this.log.info(
      {
        chainId,
        relayer: this.accounts.relayer.address,
        oracle: this.accounts.oracle.address,
        escrow: this.settings.escrowAddress,
        maxInFlight: this.settings.maxInFlight,
      },
      "transaction sender started",
    );
  }

  /**
   * Refuses to start while a signer role has a `sent` row signed by another key or for another
   * chain: the workers drive only the rows of their own key and chain, so that transaction would
   * stay unfinished for good, and its outcome (mined or not) would never be recorded. Finished
   * rows of other keys or chains are no obstacle: nonces are scoped by key and chain.
   */
  private async checkSignerHistory(signer: SignerName): Promise<void> {
    const key = this.keys[signer];
    const foreign = await this.store.foreignSent(key);
    if (!foreign) return;
    throw new SignerHistoryMismatchError(
      signer,
      foreign.id,
      {
        // A `sent` row always has them (check `chain_txs_nonce_has_signer`).
        address: foreign.signerAddress ?? "unknown",
        chainId: foreign.chainId ?? 0,
        nonce: foreign.nonce ?? -1n,
        status: foreign.status,
      },
      { address: key.address, chainId: key.chainId },
    );
  }

  /**
   * Stops the workers. Nothing new is signed once stopping; a transaction being signed is stored
   * and broadcast once before its worker returns; every row is left `queued`, `sent` or final,
   * never in between. `sent` rows resume at the next `start()`.
   */
  async stop(): Promise<void> {
    if (this.state === "idle" || this.state === "stopped") return;
    if (this.state === "running") {
      this.state = "stopping";
      this.stopController.abort();
      const loops = SIGNER_NAMES.map((signer) => this.workers[signer].loop);
      this.stopPromise = Promise.allSettled(loops).then(() => {
        this.state = "stopped";
        for (const signer of SIGNER_NAMES) this.workers[signer].loop = null;
        this.notifyAll();
        this.log.info("transaction sender stopped");
      });
    }
    await this.stopPromise;
  }

  // -------------------------------------------------------------------------------------------
  // Worker
  // -------------------------------------------------------------------------------------------

  private get stopping(): boolean {
    return this.state !== "running";
  }

  private nowMs(): number {
    return this.clock.now().getTime();
  }

  private backoff(attempt: number): number {
    return backoffDelayMs(attempt, this.settings.retryBaseMs, this.settings.retryMaxMs);
  }

  /** Sleeps, or returns at once when the sender stops. */
  private pause(ms: number): Promise<void> {
    return this.clock.sleep(ms, this.stopController.signal);
  }

  private wakeWorker(signer: SignerName): void {
    const worker = this.workers[signer];
    worker.dirty = true;
    worker.wake?.();
  }

  /** Waits `ms`, or less for an `enqueue` or a stop. */
  private async idle(worker: Worker, ms: number): Promise<void> {
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    this.stopController.signal.addEventListener("abort", abort, { once: true });
    worker.wake = abort;
    try {
      if (worker.dirty || this.stopping) return;
      await this.clock.sleep(ms, controller.signal);
    } finally {
      worker.wake = null;
      this.stopController.signal.removeEventListener("abort", abort);
    }
  }

  /**
   * One loop per signer. Each pass: read the signer's `sent` rows, broadcast those a node must
   * (again) take, sign and broadcast queued rows while the window allows, then look up the
   * earliest unmined receipt. Between passes it sleeps `receiptPollMs` while something is in
   * flight, `idlePollMs` otherwise, and wakes at once for a new row.
   */
  private async runWorker(signer: SignerName): Promise<void> {
    const worker = this.workers[signer];
    const log = this.log.child({ signer });
    let failures = 0;
    while (!this.stopping) {
      try {
        worker.dirty = false;
        await this.syncInFlight(signer);
        let broadcast = await this.broadcastPending(signer, log);
        let progress = false;
        if (!this.stopping) {
          const filled = await this.fill(signer, log);
          broadcast = broadcast || filled.broadcast;
          progress = filled.processed > 0;
        }
        if (this.stopping) break;
        progress = (await this.followEarliest(signer, log, broadcast)) > 0 || progress;
        failures = 0;
        if (this.stopping) break;
        // A pass that finished or prepared something is followed at once by the next one, which
        // may have more to do; otherwise the worker sleeps.
        if (!progress) await this.rest(worker);
      } catch (error: unknown) {
        // Database errors and rows that changed under us end here. Nothing is assumed about the
        // rows: the next pass reads them again, and the nonce is derived again.
        failures += 1;
        worker.nextNonce = null;
        if (isRpcLimiterClosedError(error)) {
          // The engine is stopping and its RPC limiter released the request unsent.
          log.warn(
            { err: describeError(error), failures },
            "node request not sent, the RPC limiter is closed; the transaction is left as it was",
          );
        } else if (isRateLimitedError(error)) {
          // Nothing was signed with the nonce being read: the row is as it was.
          log.warn(
            { err: describeError(error), failures },
            "node rate limited the transaction worker, retrying after a pause",
          );
        } else {
          log.error(
            { err: describeError(error), failures },
            "transaction worker failed, retrying after a pause",
          );
        }
        await this.pause(this.backoff(failures));
      }
    }
  }

  /** Sleeps until the next pass. */
  private async rest(worker: Worker): Promise<void> {
    if (worker.inFlight.length > 0) {
      await this.idle(worker, this.settings.receiptPollMs);
      return;
    }
    const waitToPrepare = worker.prepareNotBefore - this.nowMs();
    await this.idle(
      worker,
      waitToPrepare > 0
        ? Math.min(waitToPrepare, this.settings.idlePollMs)
        : this.settings.idlePollMs,
    );
  }

  /** Builds the in-flight list from the signer's `sent` rows, keeping what this run knows. */
  private async syncInFlight(signer: SignerName): Promise<void> {
    const worker = this.workers[signer];
    const rows = await this.store.sentRows(this.keys[signer]);
    const known = new Map(worker.inFlight.map((entry) => [entry.tx.id, entry]));
    const previousEarliest = worker.inFlight[0];
    const next: InFlight[] = [];
    for (const row of rows) {
      const existing = known.get(row.id);
      if (existing && existing.tx.txHash === row.txHash) {
        next.push(existing);
        continue;
      }
      // A row this run did not sign (a restart) or that changed: its stored bytes go out again.
      next.push(this.track(row, readSenderState(row)));
    }
    worker.inFlight = next;
    // The earliest was finished outside this worker's own lookups: the next one now leads.
    const earliest = next[0];
    if (
      earliest &&
      previousEarliest &&
      earliest !== previousEarliest &&
      known.has(earliest.tx.id)
    ) {
      this.becameEarliest(earliest);
    }
  }

  private track(tx: ChainTx, state: SenderState): InFlight {
    if (tx.nonce === null) throw new CorruptSenderStateError(tx.id, "sent without a nonce");
    const now = this.nowMs();
    return {
      tx,
      nonce: tx.nonce,
      state,
      independent: isIndependentTxKind(tx.kind),
      needsBroadcast: true,
      broadcastFailures: 0,
      rateLimitedBroadcasts: 0,
      nextBroadcastAt: 0,
      replaceTimerFrom: now,
      restartsReplaceTimer: true,
      lostResend: false,
      lastLostCheckAt: now,
      consumedSince: null,
      reportedStuck: false,
    };
  }

  /**
   * Broadcasts, in nonce order, the transactions a node must (again) take, stopping at the first
   * one that is refused or not due yet: a later nonce never goes out ahead of an earlier one.
   * True when a broadcast was tried.
   */
  private async broadcastPending(signer: SignerName, log: Logger): Promise<boolean> {
    const worker = this.workers[signer];
    let tried = false;
    for (const entry of worker.inFlight) {
      if (!entry.needsBroadcast) continue;
      if (this.nowMs() < entry.nextBroadcastAt) break;
      tried = true;
      if (!(await this.broadcastTracked(worker, entry, log))) break;
      if (this.stopping) break;
    }
    return tried;
  }

  /**
   * Signs and broadcasts queued rows, oldest first, while the window allows: up to `maxInFlight`
   * independent transactions, or one barrier alone. Stops at a row that cannot be prepared now,
   * at a broadcast a node refused, or at a barrier. Says whether something was broadcast and how
   * many rows were prepared (signed, failed or retried).
   */
  private async fill(
    signer: SignerName,
    log: Logger,
  ): Promise<{ broadcast: boolean; processed: number }> {
    const worker = this.workers[signer];
    const done = { broadcast: false, processed: 0 };
    for (;;) {
      if (this.stopping) return done;
      // n + 1 is signed only once n was taken by a node.
      if (worker.inFlight.some((entry) => entry.needsBroadcast)) return done;
      if (worker.inFlight.some((entry) => !entry.independent)) return done;
      if (worker.inFlight.length >= this.settings.maxInFlight) return done;
      if (this.nowMs() < worker.prepareNotBefore) return done;
      const queued = await this.store.oldestQueued(signer);
      if (!queued) return done;
      // A barrier waits until nothing of its signer is in flight, and holds back what follows.
      if (!isIndependentTxKind(queued.kind) && worker.inFlight.length > 0) return done;
      const result = await this.processQueued(signer, queued, log);
      done.broadcast = done.broadcast || result.broadcast;
      // A preparation held back while others fly is no progress: the worker sleeps meanwhile.
      if (this.nowMs() >= worker.prepareNotBefore) done.processed += 1;
      if (!result.next) return done;
    }
  }

  /**
   * Next nonce = max(what the chain counts for the key, pending included; highest nonce stored
   * for that key on this chain + 1). Another key's nonces, whatever their role, play no part.
   */
  private async nextNonce(signer: SignerName): Promise<bigint> {
    const worker = this.workers[signer];
    if (worker.nextNonce !== null) return worker.nextNonce;
    const [onChain, stored] = await Promise.all([
      this.client.getTransactionCount({
        address: this.accounts[signer].address,
        blockTag: "pending",
      }),
      this.store.maxNonce(this.keys[signer]),
    ]);
    const fromChain = BigInt(onChain);
    const fromStore = stored === null ? 0n : stored + 1n;
    worker.nextNonce = fromChain > fromStore ? fromChain : fromStore;
    return worker.nextNonce;
  }

  /**
   * The node's fee suggestion, read again only when the last one is `feeSuggestionMaxAgeMs` old;
   * always read when transactions go one at a time, as they used to be.
   */
  private async feeSuggestion(): Promise<FeeSuggestion> {
    const cached = this.feeCache;
    if (cached && !this.serial && this.nowMs() - cached.at < this.settings.feeSuggestionMaxAgeMs) {
      return cached.suggestion;
    }
    const suggestion = await this.client.estimateFeesPerGas();
    this.feeCache = { suggestion, at: this.nowMs() };
    return suggestion;
  }

  private async sign(
    account: LocalAccount,
    tx: ChainTx,
    params: { nonce: bigint; gas: bigint; fees: Fees },
  ): Promise<SignedAttempt> {
    const raw = await account.signTransaction({
      type: "eip1559",
      chainId: this.settings.chainId,
      to: tx.to,
      data: tx.data,
      value: tx.value,
      nonce: Number(params.nonce),
      gas: params.gas,
      maxFeePerGas: params.fees.maxFeePerGas,
      maxPriorityFeePerGas: params.fees.maxPriorityFeePerGas,
    });
    return {
      hash: keccak256(raw),
      raw,
      maxFeePerGas: params.fees.maxFeePerGas.toString(),
      maxPriorityFeePerGas: params.fees.maxPriorityFeePerGas.toString(),
      signedAt: this.clock.now().toISOString(),
    };
  }

  /**
   * Waits `ms` before the next preparation: a plain pause when nothing is in flight (what a
   * strictly serial sender does), otherwise a time before which no queued row is prepared, so
   * that the transactions in flight are still followed meanwhile.
   */
  private async holdPreparation(worker: Worker, ms: number): Promise<void> {
    if (worker.inFlight.length === 0) {
      await this.pause(ms);
      return;
    }
    worker.prepareNotBefore = this.nowMs() + ms;
  }

  /**
   * The simulation, the gas estimate and the fee suggestion of a queued row: asked together, the
   * simulation's error being the one read when several fail; one after the other, stopping at the
   * first error, when transactions go one at a time.
   */
  private async prepareReads(
    request: CallRequest,
  ): Promise<{ ok: true; estimate: bigint; fee: FeeSuggestion } | { ok: false; error: unknown }> {
    if (this.serial) {
      try {
        await this.client.call(request);
        const estimate = await this.client.estimateGas(request);
        const fee = await this.feeSuggestion();
        return { ok: true, estimate, fee };
      } catch (error: unknown) {
        return { ok: false, error };
      }
    }
    const [simulation, estimate, fee] = await Promise.allSettled([
      this.client.call(request),
      this.client.estimateGas(request),
      this.feeSuggestion(),
    ]);
    if (simulation.status === "rejected") return { ok: false, error: simulation.reason };
    if (estimate.status === "rejected") return { ok: false, error: estimate.reason };
    if (fee.status === "rejected") return { ok: false, error: fee.reason };
    return { ok: true, estimate: estimate.value, fee: fee.value };
  }

  /**
   * `queued` row: simulate, estimate, sign, store, then broadcast. A call that reverts is
   * `failed` here, before any nonce is assigned.
   */
  private async processQueued(
    signer: SignerName,
    tx: ChainTx,
    log: Logger,
  ): Promise<PrepareResult> {
    const worker = this.workers[signer];
    const account = this.accounts[signer];
    const request: CallRequest = {
      account: account.address,
      to: tx.to,
      data: tx.data,
      value: tx.value,
    };

    const reads = await this.prepareReads(request);
    if (!reads.ok) return this.prepareFailed(signer, tx, reads.error, log);

    worker.rateLimitedPrepares = 0;
    // Stopping before anything is signed leaves the row exactly as it was.
    if (this.stopping) return { next: false, broadcast: false };

    const gas = addGasMargin(reads.estimate, this.settings.gasMarginPercent);
    const nonce = await this.nextNonce(signer);
    const fees = computeFees(reads.fee, this.settings.feePolicy);
    const attempt = await this.sign(account, tx, { nonce, gas, fees });
    const state: SenderState = { gas: gas.toString(), attempts: [attempt] };

    // The signed bytes reach the database before they reach the network. If this write is lost
    // or its answer is, the nonce is derived again and the row is read again.
    const stored = await this.store.markSent({
      id: tx.id,
      nonce,
      signerAddress: this.keys[signer].address,
      chainId: this.keys[signer].chainId,
      txHash: attempt.hash,
      state,
      sentAt: this.clock.now(),
    });
    if (!stored) throw new ConcurrentTxUpdateError(tx.id, "store signed transaction");
    worker.nextNonce = nonce + 1n;
    const entry = this.track(
      {
        ...tx,
        status: "sent",
        nonce,
        signerAddress: this.keys[signer].address,
        chainId: this.keys[signer].chainId,
        txHash: attempt.hash,
      },
      state,
    );
    worker.inFlight.push(entry);
    log.info(
      {
        id: tx.id,
        kind: tx.kind,
        nonce: nonce.toString(),
        txHash: attempt.hash,
        gas: gas.toString(),
        maxFeePerGas: attempt.maxFeePerGas,
        maxPriorityFeePerGas: attempt.maxPriorityFeePerGas,
        inFlight: worker.inFlight.length,
      },
      "transaction signed and stored",
    );

    // Broadcast once even if the sender is stopping: a stored transaction is never left untried.
    const accepted = await this.broadcastTracked(worker, entry, log);
    return { next: accepted && !this.stopping, broadcast: true };
  }

  /** What a failed preparation means for the row; the row is never signed here. */
  private async prepareFailed(
    signer: SignerName,
    tx: ChainTx,
    error: unknown,
    log: Logger,
  ): Promise<PrepareResult> {
    const worker = this.workers[signer];
    const verdict = classifySimulationError(error);
    if (verdict.kind === "revert") {
      if (await this.store.markQueuedFailed(tx.id, verdict.reason)) {
        log.warn(
          { id: tx.id, kind: tx.kind, error: verdict.reason },
          "transaction would revert, not sent",
        );
        this.notify(tx.id);
      }
      // The next row takes the nonce this one did not use.
      return { next: true, broadcast: false };
    }
    if (isRpcLimiterClosedError(error)) {
      // The engine is stopping and its RPC limiter released the request without sending it:
      // nothing about this transaction or the node. The row is left exactly as it was (no
      // attempt counted, no error recorded, never given up for it); the next start prepares it.
      log.warn(
        { id: tx.id, kind: tx.kind, error: verdict.reason },
        "node request not sent, the RPC limiter is closed; the transaction is left as it was",
      );
      await this.holdPreparation(worker, this.backoff(1));
      return { next: false, broadcast: false };
    }
    if (isRateLimitedError(error)) {
      // The node refuses this client for now, not this transaction: the row is left exactly as
      // it was (no attempt counted, no error recorded, never given up for it), and asked again
      // after a pause that grows while the refusals last.
      worker.rateLimitedPrepares += 1;
      log.warn(
        {
          id: tx.id,
          kind: tx.kind,
          inARow: worker.rateLimitedPrepares,
          error: verdict.reason,
        },
        "node rate limited the preparation of a transaction, retrying after a pause",
      );
      await this.holdPreparation(worker, this.backoff(worker.rateLimitedPrepares));
      return { next: false, broadcast: false };
    }
    worker.rateLimitedPrepares = 0;
    const failure = await this.store.recordPrepareFailure(tx.id, verdict.reason);
    // The row changed under us (another sender?): the next pass reads it again.
    if (!failure) return { next: false, broadcast: false };
    const { attempts, ageMs } = failure;
    if (attempts >= this.settings.maxPrepareAttempts && ageMs >= this.settings.maxPrepareMs) {
      const reason = `NodeUnavailable: ${verdict.reason}`;
      if (await this.store.markQueuedFailed(tx.id, reason)) {
        log.error(
          { id: tx.id, kind: tx.kind, attempts, ageMs, error: verdict.reason },
          "transaction could not be prepared, given up before any nonce was used",
        );
        this.notify(tx.id);
      }
      return { next: false, broadcast: false };
    }
    log.warn(
      { id: tx.id, kind: tx.kind, attempts, error: verdict.reason },
      "node error while preparing a transaction, retrying",
    );
    await this.holdPreparation(worker, this.backoff(attempts));
    return { next: false, broadcast: false };
  }

  /**
   * Sends the stored bytes. Accepted when the node has the transaction, including when it says it
   * already had it or that its nonce is already mined: both mean an earlier broadcast worked
   * (`known`: the node had it, or something for its nonce, before this broadcast).
   */
  private async broadcast(
    tx: ChainTx,
    attempt: SignedAttempt,
    log: Logger,
  ): Promise<
    { accepted: true; known: boolean } | { accepted: false; error: string; rateLimited: boolean }
  > {
    try {
      await this.client.sendRawTransaction({ serializedTransaction: attempt.raw });
      return { accepted: true, known: false };
    } catch (error: unknown) {
      const verdict = classifyBroadcastError(error);
      if (verdict === "already-broadcast") {
        log.debug({ id: tx.id, txHash: attempt.hash }, "transaction was already broadcast");
        return { accepted: true, known: true };
      }
      if (verdict === "underpriced") {
        // The mempool holds another attempt for this nonce with a fee at least as good. This
        // one will not get in; the receipts of all attempts are still watched.
        log.warn({ id: tx.id, txHash: attempt.hash }, "replacement refused as underpriced");
        return { accepted: true, known: true };
      }
      const description = describeError(error);
      if (isRateLimitedError(error)) {
        log.warn(
          { id: tx.id, txHash: attempt.hash, err: description },
          "broadcast rate limited by the node, the same signed transaction is sent again",
        );
        return { accepted: false, error: description, rateLimited: true };
      }
      log.warn({ id: tx.id, txHash: attempt.hash, err: description }, "broadcast failed, retrying");
      return { accepted: false, error: description, rateLimited: false };
    }
  }

  /** Broadcasts one transaction in flight and keeps its counters. True when a node took it. */
  private async broadcastTracked(worker: Worker, entry: InFlight, log: Logger): Promise<boolean> {
    const { tx, nonce } = entry;
    const result = await this.broadcast(tx, latestAttempt(tx, entry.state), log);
    if (result.accepted) {
      const now = this.nowMs();
      entry.needsBroadcast = false;
      entry.broadcastFailures = 0;
      entry.rateLimitedBroadcasts = 0;
      // Asking the pending count right after a node took it would tell nothing. An "already
      // known" answer is no such news: the check keeps its pace, so a stuck earliest re-sent
      // every replaceAfterMs cannot hold it off for good.
      if (!result.known) entry.lastLostCheckAt = now;
      if (entry.restartsReplaceTimer) {
        entry.restartsReplaceTimer = false;
        entry.replaceTimerFrom = now;
      }
      if (entry.lostResend) {
        entry.lostResend = false;
        if (result.known) worker.lostResends.known += 1;
        else worker.lostResends.taken += 1;
      }
      return true;
    }
    if (result.rateLimited) {
      // The node refuses this client for now: not a refusal of the transaction, so it does not
      // count towards the alert. The same stored bytes go out again after a pause.
      entry.rateLimitedBroadcasts += 1;
      entry.nextBroadcastAt = this.nowMs() + this.backoff(entry.rateLimitedBroadcasts);
      if (entry.rateLimitedBroadcasts === BROADCAST_FAILURES_BEFORE_ALERT && !this.stopping) {
        // Once per stretch of refusals, where an operator looks; the row is not touched (no
        // `last_error`): the transaction itself is not refused.
        log.error(
          {
            id: tx.id,
            nonce: nonce.toString(),
            rateLimited: entry.rateLimitedBroadcasts,
            err: result.error,
          },
          "broadcast still rate limited by the node, the signer's queue waits behind it",
        );
      }
      return false;
    }
    entry.broadcastFailures += 1;
    entry.nextBroadcastAt = this.nowMs() + this.backoff(entry.broadcastFailures);
    if (entry.broadcastFailures === BROADCAST_FAILURES_BEFORE_ALERT && !this.stopping) {
      // The signed transaction holds a nonce that the later ones need first: nothing else of that
      // signer is signed until a node takes it. Say so where an operator looks.
      const reason = `broadcast refused ${entry.broadcastFailures.toString()} times: ${result.error}`;
      log.error(
        { id: tx.id, nonce: nonce.toString(), err: result.error },
        "transaction cannot be broadcast, the signer's queue is blocked behind it",
      );
      await this.store.recordSentError(tx.id, reason);
    }
    return false;
  }

  /** Receipt of whichever attempt was mined, the latest first. */
  private async findReceipt(state: SenderState): Promise<TxReceipt | undefined> {
    for (let index = state.attempts.length - 1; index >= 0; index -= 1) {
      const attempt = state.attempts[index];
      if (!attempt) continue;
      try {
        const receipt = (await this.client.getTransactionReceipt({ hash: attempt.hash })) as
          TxReceipt | null | undefined;
        if (receipt) return receipt;
      } catch (error: unknown) {
        if (!isReceiptNotFound(error)) throw error;
      }
    }
    return undefined;
  }

  /**
   * Looks up the receipt of the earliest unmined transaction, and of the next ones while they
   * are found: transactions of one key are mined in nonce order, so the earliest without a
   * receipt is the only one worth asking about, and receipts are recorded in nonce order. Then
   * watches that earliest one. Runs every `receiptPollMs`, or at once after a broadcast.
   */
  private async followEarliest(
    signer: SignerName,
    log: Logger,
    afterBroadcast: boolean,
  ): Promise<number> {
    const worker = this.workers[signer];
    let finished = 0;
    if (worker.inFlight.length === 0) return finished;
    if (!afterBroadcast && this.nowMs() - worker.lastReceiptPollAt < this.settings.receiptPollMs) {
      return finished;
    }
    worker.lastReceiptPollAt = this.nowMs();
    try {
      for (;;) {
        if (this.stopping) return finished;
        const head = worker.inFlight[0];
        if (!head) return finished;
        // Looked up even when its broadcast failed: the transaction may be mined all the same.
        const receipt = await this.findReceipt(head.state);
        if (receipt) {
          await this.finalize(signer, head.tx, receipt, log);
          this.shiftEarliest(worker, head);
          finished += 1;
          continue;
        }
        worker.rpcFailures = 0;
        const action = await this.watchEarliest(signer, head, log);
        if (action === "failed") {
          this.shiftEarliest(worker, head);
          finished += 1;
          continue;
        }
        if (action === "broadcast") await this.broadcastPending(signer, log);
        return finished;
      }
    } catch (error: unknown) {
      if (error instanceof TxSenderError) throw error;
      worker.rpcFailures += 1;
      log.warn(
        {
          id: worker.inFlight[0]?.tx.id,
          err: describeError(error),
          failures: worker.rpcFailures,
        },
        "error while following a sent transaction, retrying",
      );
      await this.pause(this.backoff(worker.rpcFailures));
      return finished;
    }
  }

  /** Drops the earliest once it is final; the next one becomes the earliest. */
  private shiftEarliest(worker: Worker, head: InFlight): void {
    if (worker.inFlight[0] !== head) return;
    worker.inFlight.shift();
    const next = worker.inFlight[0];
    if (next) this.becameEarliest(next);
  }

  /**
   * `entry` is now the earliest unmined transaction of its signer. It could not be mined before
   * the one before it, so the time it waited behind it does not count in full: at least
   * `resendCheckMs` (or the whole `replaceAfterMs`, when that is shorter) remain before it can be
   * replaced. See `InFlight.replaceTimerFrom`.
   */
  private becameEarliest(entry: InFlight): void {
    const left = Math.min(this.settings.resendCheckMs, this.settings.replaceAfterMs);
    const from = this.nowMs() - this.settings.replaceAfterMs + left;
    if (from > entry.replaceTimerFrom) entry.replaceTimerFrom = from;
  }

  /**
   * The earliest unmined transaction has no receipt yet. After `replaceAfterMs` from the time a
   * node took its latest attempt, as the one-at-a-time sender does (that time moved so that at
   * least `resendCheckMs` remain once it became the earliest: `becameEarliest`): fails it when
   * another transaction took its nonce, otherwise replaces it with a higher fee and the same nonce (the
   * later ones are never signed again), at most `maxFeeBumps` times, then says the queue is
   * blocked. With more than one in flight, every `lostCheckMs` meanwhile, asks the node's pending
   * count: what the node lost is broadcast again from its stored bytes, which does not restart
   * the replacement timer.
   */
  private async watchEarliest(
    signer: SignerName,
    head: InFlight,
    log: Logger,
  ): Promise<"none" | "broadcast" | "failed"> {
    const worker = this.workers[signer];
    const address = this.accounts[signer].address;
    const { nonce } = head;
    const now = this.nowMs();
    if (head.consumedSince !== null) {
      if (now - head.consumedSince < this.settings.replaceAfterMs) return "none";
      await this.failConsumed(signer, head.tx, head.state, nonce, log);
      return "failed";
    }
    if (head.needsBroadcast) return "none";
    if (now - head.replaceTimerFrom >= this.settings.replaceAfterMs) {
      const mined = await this.client.getTransactionCount({ address, blockTag: "latest" });
      if (BigInt(mined) > nonce) {
        // The nonce is used. If it was by one of our attempts its receipt shows up within the
        // grace period; otherwise another transaction took it.
        head.consumedSince = now;
        log.warn(
          { id: head.tx.id, nonce: nonce.toString() },
          "nonce is mined but no receipt of this transaction was found yet",
        );
        return "none";
      }
      const bumped =
        head.state.attempts.length - 1 < this.settings.maxFeeBumps
          ? await this.bump(signer, head.tx, head.state, nonce, log)
          : undefined;
      if (bumped) {
        head.state = bumped;
        head.tx = { ...head.tx, txHash: latestAttempt(head.tx, bumped).hash };
      } else if (!head.reportedStuck) {
        head.reportedStuck = true;
        const reason = `still pending after ${(head.state.attempts.length - 1).toString()} fee bump(s)`;
        log.error(
          {
            id: head.tx.id,
            nonce: nonce.toString(),
            txHash: latestAttempt(head.tx, head.state).hash,
            inFlight: worker.inFlight.length,
          },
          `transaction ${reason}, the signer's queue is blocked behind it`,
        );
        await this.store.recordSentError(head.tx.id, reason);
      }
      // The replacement, or the latest attempt again in case the mempool dropped it. Once a node
      // takes it, the timer starts again.
      head.needsBroadcast = true;
      head.restartsReplaceTimer = true;
      head.nextBroadcastAt = 0;
      return "broadcast";
    }
    if (!this.serial && now - head.lastLostCheckAt >= worker.lostCheckMs) {
      head.lastLostCheckAt = now;
      this.adjustLostCheck(worker);
      const pending = BigInt(
        await this.client.getTransactionCount({ address, blockTag: "pending" }),
      );
      const lost = worker.inFlight.filter(
        (entry) => entry.nonce >= pending && !entry.needsBroadcast,
      );
      if (lost.length === 0) {
        // The count shows everything in flight: it can be trusted again.
        worker.lostCheckMs = this.settings.resendCheckMs;
        return "none";
      }
      log.warn(
        {
          pendingCount: pending.toString(),
          ids: lost.map((entry) => entry.tx.id),
          nonces: lost.map((entry) => entry.nonce.toString()),
        },
        "the node no longer knows transactions of this signer, broadcast again from their stored bytes",
      );
      for (const entry of lost) {
        entry.needsBroadcast = true;
        entry.lostResend = true;
        entry.nextBroadcastAt = 0;
      }
      return "broadcast";
    }
    return "none";
  }

  /**
   * Reads the answers to the previous check's re-broadcasts. All "already known": the node had
   * them and its pending count was wrong (a node that answers `pending` as `latest`, a
   * load-balanced RPC), so the check slows down, doubling up to once per `replaceAfterMs`, and
   * stops re-sending the whole window every `resendCheckMs`. One really lost and taken again:
   * back to `resendCheckMs`.
   */
  private adjustLostCheck(worker: Worker): void {
    const { known, taken } = worker.lostResends;
    worker.lostResends = { known: 0, taken: 0 };
    if (taken > 0) {
      worker.lostCheckMs = this.settings.resendCheckMs;
    } else if (known > 0) {
      const ceiling = Math.max(this.settings.resendCheckMs, this.settings.replaceAfterMs);
      worker.lostCheckMs = Math.min(worker.lostCheckMs * 2, ceiling);
    }
  }

  /** Signs the same call with the same nonce and higher fees, and stores it before broadcast. */
  private async bump(
    signer: SignerName,
    tx: ChainTx,
    state: SenderState,
    nonce: bigint,
    log: Logger,
  ): Promise<SenderState | undefined> {
    const previous = latestAttempt(tx, state);
    const suggestion = await this.client.estimateFeesPerGas();
    this.feeCache = { suggestion, at: this.nowMs() };
    const fees = bumpFees(
      {
        maxFeePerGas: BigInt(previous.maxFeePerGas),
        maxPriorityFeePerGas: BigInt(previous.maxPriorityFeePerGas),
      },
      suggestion,
      this.settings.feePolicy,
      this.settings.feeBumpPercent,
    );
    if (!fees) return undefined;
    const attempt = await this.sign(this.accounts[signer], tx, {
      nonce,
      gas: BigInt(state.gas),
      fees,
    });
    const next: SenderState = { gas: state.gas, attempts: [...state.attempts, attempt] };
    const stored = await this.store.replaceAttempt({
      id: tx.id,
      previousHash: previous.hash,
      txHash: attempt.hash,
      state: next,
    });
    if (!stored) throw new ConcurrentTxUpdateError(tx.id, "store replacement");
    log.warn(
      {
        id: tx.id,
        nonce: nonce.toString(),
        previousTxHash: previous.hash,
        txHash: attempt.hash,
        maxFeePerGas: attempt.maxFeePerGas,
        bump: next.attempts.length - 1,
      },
      "transaction not mined in time, replaced with a higher fee",
    );
    return next;
  }

  /** The nonce was mined by a transaction that is none of our attempts: ours can never be. */
  private async failConsumed(
    signer: SignerName,
    tx: ChainTx,
    state: SenderState,
    nonce: bigint,
    log: Logger,
  ): Promise<void> {
    const reason = `NonceConsumedElsewhere: nonce ${nonce.toString()} was used by a transaction this sender did not sign`;
    const failed = await this.store.markSentFailed(tx.id, latestAttempt(tx, state).hash, reason);
    this.workers[signer].nextNonce = null;
    if (!failed) throw new ConcurrentTxUpdateError(tx.id, "fail consumed nonce");
    log.error(
      { id: tx.id, kind: tx.kind, nonce: nonce.toString() },
      "the signer key was used outside this sender: transaction failed, it was never mined",
    );
    this.notify(tx.id);
  }

  private async blockTime(blockNumber: bigint, log: Logger): Promise<Date | null> {
    const cached = this.blockTimes.get(blockNumber);
    if (cached) return cached;
    try {
      const block = await this.client.getBlock({ blockNumber });
      const time = new Date(Number(block.timestamp) * 1000);
      this.blockTimes.set(blockNumber, time);
      if (this.blockTimes.size > BLOCK_TIME_CACHE_SIZE) {
        const oldest = this.blockTimes.keys().next();
        if (!oldest.done) this.blockTimes.delete(oldest.value);
      }
      return time;
    } catch (error: unknown) {
      // A rate limit says nothing about the block: the receipt is looked up again after a pause
      // rather than recorded without its time.
      if (isRateLimitedError(error)) throw error;
      log.warn(
        { blockNumber: blockNumber.toString(), err: describeError(error) },
        "block time could not be read, the transaction is recorded without it",
      );
      return null;
    }
  }

  /** Best effort: replays a reverted call on the block that mined it to name the error. */
  private async revertReason(
    signer: SignerName,
    tx: ChainTx,
    blockNumber: bigint,
  ): Promise<string> {
    try {
      await this.client.call({
        account: this.accounts[signer].address,
        to: tx.to,
        data: tx.data,
        value: tx.value,
        blockNumber,
      });
    } catch (error: unknown) {
      const verdict = classifySimulationError(error);
      if (verdict.kind === "revert") return verdict.reason;
      // Asked again after a pause, rather than recorded as a bare "execution reverted".
      if (isRateLimitedError(error)) throw error;
    }
    return "execution reverted";
  }

  /** Records the receipt and the escrow events it carries, in one database transaction. */
  private async finalize(
    signer: SignerName,
    tx: ChainTx,
    receipt: TxReceipt,
    log: Logger,
  ): Promise<void> {
    const success = receipt.status === "success";
    const blockTime = await this.blockTime(receipt.blockNumber, log);
    const { events, undecodable } = success
      ? decodeEscrowLogs(receipt.logs, this.settings.escrowAddress)
      : { events: [], undecodable: [] };
    if (undecodable.length > 0) {
      log.warn(
        { id: tx.id, txHash: receipt.transactionHash, count: undecodable.length },
        "escrow logs that winzEscrowAbi cannot decode were skipped",
      );
    }
    const error = success ? null : await this.revertReason(signer, tx, receipt.blockNumber);
    const txHash = receipt.transactionHash.toLowerCase() as Hex;
    await this.store.finalize({
      id: tx.id,
      status: success ? "mined" : "reverted",
      txHash,
      blockNumber: receipt.blockNumber,
      minedAt: blockTime ?? this.clock.now(),
      blockTime,
      error,
      events,
    });
    const fields = {
      id: tx.id,
      kind: tx.kind,
      nonce: tx.nonce?.toString(),
      txHash,
      blockNumber: receipt.blockNumber.toString(),
      events: events.map((event) => event.name),
    };
    if (success) log.info(fields, "transaction mined");
    else log.warn({ ...fields, error }, "transaction reverted on-chain");
    this.notify(tx.id);
  }

  // -------------------------------------------------------------------------------------------
  // Waiters
  // -------------------------------------------------------------------------------------------

  private addWaiter(id: string, wake: () => void): () => void {
    let waiting = this.waiters.get(id);
    if (!waiting) {
      waiting = new Set();
      this.waiters.set(id, waiting);
    }
    waiting.add(wake);
    return (): void => {
      waiting.delete(wake);
      if (waiting.size === 0 && this.waiters.get(id) === waiting) this.waiters.delete(id);
    };
  }

  private notify(id: string): void {
    for (const wake of this.waiters.get(id) ?? []) wake();
  }

  private notifyAll(): void {
    for (const waiting of this.waiters.values()) for (const wake of waiting) wake();
  }

  private async outcomeOf(tx: ChainTx): Promise<TxOutcome> {
    const outcome: TxOutcome = { id: tx.id, status: tx.status as TxOutcome["status"], events: [] };
    if (tx.txHash !== null) outcome.txHash = tx.txHash;
    if (tx.blockNumber !== null) outcome.blockNumber = tx.blockNumber;
    if (tx.lastError !== null) outcome.error = tx.lastError;
    if (tx.status === "mined" && tx.txHash !== null) {
      outcome.events = await readChainEvents(this.db, tx.txHash);
    }
    return outcome;
  }
}
