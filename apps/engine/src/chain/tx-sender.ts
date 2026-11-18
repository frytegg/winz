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

interface Worker {
  /** Next nonce to assign, or `null` when it must be derived again from the chain and the table. */
  nextNonce: bigint | null;
  /** Set by `enqueue` so that a wake-up sent while the worker was reading is not lost. */
  dirty: boolean;
  wake: (() => void) | null;
  loop: Promise<void> | null;
  /** Rate-limit answers in a row while preparing: they set the pause, not the give-up count. */
  rateLimitedPrepares: number;
}

function isTerminal(tx: ChainTx): boolean {
  return tx.status === "mined" || tx.status === "reverted" || tx.status === "failed";
}

function latestAttempt(tx: ChainTx, state: SenderState): SignedAttempt {
  const attempt = state.attempts[state.attempts.length - 1];
  if (!attempt) throw new CorruptSenderStateError(tx.id, "no signed attempt");
  return attempt;
}

/**
 * The single on-chain transaction sender of the engine (SPEC section 7). Callers describe a
 * call; the sender owns nonces, fees, broadcast and receipts, with one strictly serial queue
 * per signer key, so two writers can never use the same nonce.
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
    this.workers = {
      relayer: { nextNonce: null, dirty: false, wake: null, loop: null, rateLimitedPrepares: 0 },
      oracle: { nextNonce: null, dirty: false, wake: null, loop: null, rateLimitedPrepares: 0 },
    };
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
   * from their stored bytes first. Rejects if the node is unreachable or on another chain, and
   * with `SignerHistoryMismatchError` while a role has a `sent` row of another key or chain.
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
      worker.loop = this.runWorker(signer);
    }
    this.log.info(
      {
        chainId,
        relayer: this.accounts.relayer.address,
        oracle: this.accounts.oracle.address,
        escrow: this.settings.escrowAddress,
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
   * Stops the workers. A transaction being signed is stored and broadcast once before its
   * worker returns; every row is left `queued`, `sent` or final, never in between. `sent` rows
   * resume at the next `start()`.
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

  /** Waits for an `enqueue`, a stop, or the idle poll that catches rows written by someone else. */
  private async idle(worker: Worker): Promise<void> {
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    this.stopController.signal.addEventListener("abort", abort, { once: true });
    worker.wake = abort;
    try {
      if (worker.dirty || this.stopping) return;
      await this.clock.sleep(this.settings.idlePollMs, controller.signal);
    } finally {
      worker.wake = null;
      this.stopController.signal.removeEventListener("abort", abort);
    }
  }

  /** One signer, one transaction at a time: the unfinished one first, then the oldest queued. */
  private async runWorker(signer: SignerName): Promise<void> {
    const worker = this.workers[signer];
    const log = this.log.child({ signer });
    let failures = 0;
    while (!this.stopping) {
      try {
        worker.dirty = false;
        const sent = await this.store.oldestSent(this.keys[signer]);
        if (sent) {
          await this.driveSent(signer, sent, readSenderState(sent), log);
        } else {
          const queued = await this.store.oldestQueued(signer);
          if (queued) await this.processQueued(signer, queued, log);
          else await this.idle(worker);
        }
        failures = 0;
      } catch (error: unknown) {
        // Database errors and rows that changed under us end here. Nothing is assumed about the
        // row: the next pass reads it again, and the nonce is derived again.
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
   * `queued` row: simulate, estimate, sign, store, then broadcast. A call that reverts is
   * `failed` here, before any nonce is assigned.
   */
  private async processQueued(signer: SignerName, tx: ChainTx, log: Logger): Promise<void> {
    const account = this.accounts[signer];
    const request: CallRequest = {
      account: account.address,
      to: tx.to,
      data: tx.data,
      value: tx.value,
    };

    let gas: bigint;
    let suggestion: FeeSuggestion;
    try {
      await this.client.call(request);
      gas = addGasMargin(await this.client.estimateGas(request), this.settings.gasMarginPercent);
      suggestion = await this.client.estimateFeesPerGas();
    } catch (error: unknown) {
      const verdict = classifySimulationError(error);
      if (verdict.kind === "revert") {
        if (await this.store.markQueuedFailed(tx.id, verdict.reason)) {
          log.warn(
            { id: tx.id, kind: tx.kind, error: verdict.reason },
            "transaction would revert, not sent",
          );
          this.notify(tx.id);
        }
        return;
      }
      const preparing = this.workers[signer];
      if (isRpcLimiterClosedError(error)) {
        // The engine is stopping and its RPC limiter released the request without sending it:
        // nothing about this transaction or the node. The row is left exactly as it was (no
        // attempt counted, no error recorded, never given up for it); the next start prepares it.
        log.warn(
          { id: tx.id, kind: tx.kind, error: verdict.reason },
          "node request not sent, the RPC limiter is closed; the transaction is left as it was",
        );
        await this.pause(this.backoff(1));
        return;
      }
      if (isRateLimitedError(error)) {
        // The node refuses this client for now, not this transaction: the row is left exactly as
        // it was (no attempt counted, no error recorded, never given up for it), and asked again
        // after a pause that grows while the refusals last.
        preparing.rateLimitedPrepares += 1;
        log.warn(
          {
            id: tx.id,
            kind: tx.kind,
            inARow: preparing.rateLimitedPrepares,
            error: verdict.reason,
          },
          "node rate limited the preparation of a transaction, retrying after a pause",
        );
        await this.pause(this.backoff(preparing.rateLimitedPrepares));
        return;
      }
      preparing.rateLimitedPrepares = 0;
      const failure = await this.store.recordPrepareFailure(tx.id, verdict.reason);
      // The row changed under us (another sender?): the next pass reads it again.
      if (!failure) return;
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
        return;
      }
      log.warn(
        { id: tx.id, kind: tx.kind, attempts, error: verdict.reason },
        "node error while preparing a transaction, retrying",
      );
      await this.pause(this.backoff(attempts));
      return;
    }

    const worker = this.workers[signer];
    worker.rateLimitedPrepares = 0;
    // Stopping before anything is signed leaves the row exactly as it was.
    if (this.stopping) return;

    const nonce = await this.nextNonce(signer);
    const fees = computeFees(suggestion, this.settings.feePolicy);
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
    log.info(
      {
        id: tx.id,
        kind: tx.kind,
        nonce: nonce.toString(),
        txHash: attempt.hash,
        gas: gas.toString(),
        maxFeePerGas: attempt.maxFeePerGas,
        maxPriorityFeePerGas: attempt.maxPriorityFeePerGas,
      },
      "transaction signed and stored",
    );

    await this.driveSent(
      signer,
      {
        ...tx,
        status: "sent",
        nonce,
        signerAddress: this.keys[signer].address,
        chainId: this.keys[signer].chainId,
        txHash: attempt.hash,
      },
      state,
      log,
    );
  }

  /**
   * Sends the stored bytes. True when the node has the transaction, including when it says it
   * already had it or that its nonce is already mined: both mean an earlier broadcast worked.
   */
  private async broadcast(
    tx: ChainTx,
    attempt: SignedAttempt,
    log: Logger,
  ): Promise<{ accepted: true } | { accepted: false; error: string; rateLimited: boolean }> {
    try {
      await this.client.sendRawTransaction({ serializedTransaction: attempt.raw });
      return { accepted: true };
    } catch (error: unknown) {
      const verdict = classifyBroadcastError(error);
      if (verdict === "already-broadcast") {
        log.debug({ id: tx.id, txHash: attempt.hash }, "transaction was already broadcast");
        return { accepted: true };
      }
      if (verdict === "underpriced") {
        // The mempool holds another attempt for this nonce with a fee at least as good. This
        // one will not get in; the receipts of all attempts are still watched.
        log.warn({ id: tx.id, txHash: attempt.hash }, "replacement refused as underpriced");
        return { accepted: true };
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
   * `sent` row: broadcast (again), then watch for the receipt, replacing the transaction with a
   * higher fee when it stays pending. Returns when the row is final or the sender stops.
   */
  private async driveSent(
    signer: SignerName,
    tx: ChainTx,
    initial: SenderState,
    log: Logger,
  ): Promise<void> {
    if (tx.nonce === null) throw new CorruptSenderStateError(tx.id, "sent without a nonce");
    const nonce = tx.nonce;
    const address = this.accounts[signer].address;
    let state = initial;
    let needsBroadcast = true;
    let broadcastFailures = 0;
    let rateLimitedBroadcasts = 0;
    let nextBroadcastAt = 0;
    let lastBroadcastAt = this.nowMs();
    let rpcFailures = 0;
    let consumedSince: number | null = null;
    let reportedStuck = false;
    let firstPass = true;

    for (;;) {
      // The first pass always runs: a transaction that was just stored is broadcast once even
      // if the sender is stopping, and a stored one is never left without a try.
      if (!firstPass && this.stopping) return;
      firstPass = false;
      try {
        if (needsBroadcast && this.nowMs() >= nextBroadcastAt) {
          const result = await this.broadcast(tx, latestAttempt(tx, state), log);
          if (result.accepted) {
            needsBroadcast = false;
            broadcastFailures = 0;
            rateLimitedBroadcasts = 0;
            lastBroadcastAt = this.nowMs();
          } else if (result.rateLimited) {
            // The node refuses this client for now: not a refusal of the transaction, so it does
            // not count towards the alert. The same stored bytes go out again after a pause.
            rateLimitedBroadcasts += 1;
            nextBroadcastAt = this.nowMs() + this.backoff(rateLimitedBroadcasts);
            if (rateLimitedBroadcasts === BROADCAST_FAILURES_BEFORE_ALERT && !this.stopping) {
              // Once per stretch of refusals, where an operator looks; the row is not touched
              // (no `last_error`): the transaction itself is not refused.
              log.error(
                {
                  id: tx.id,
                  nonce: nonce.toString(),
                  rateLimited: rateLimitedBroadcasts,
                  err: result.error,
                },
                "broadcast still rate limited by the node, the signer's queue waits behind it",
              );
            }
          } else {
            broadcastFailures += 1;
            nextBroadcastAt = this.nowMs() + this.backoff(broadcastFailures);
            if (broadcastFailures === BROADCAST_FAILURES_BEFORE_ALERT && !this.stopping) {
              // The signed transaction holds the signer's next nonce: nothing else of that
              // signer can go out until a node takes it. Say so where an operator looks.
              const reason = `broadcast refused ${broadcastFailures.toString()} times: ${result.error}`;
              log.error(
                { id: tx.id, nonce: nonce.toString(), err: result.error },
                "transaction cannot be broadcast, the signer's queue is blocked behind it",
              );
              await this.store.recordSentError(tx.id, reason);
            }
          }
          if (this.stopping) return;
        }

        // Looked up even when the broadcast failed: the transaction may be mined all the same.
        const receipt = await this.findReceipt(state);
        if (receipt) {
          await this.finalize(signer, tx, receipt, log);
          return;
        }
        rpcFailures = 0;

        const now = this.nowMs();
        if (consumedSince !== null) {
          if (now - consumedSince >= this.settings.replaceAfterMs) {
            await this.failConsumed(signer, tx, state, nonce, log);
            return;
          }
        } else if (!needsBroadcast && now - lastBroadcastAt >= this.settings.replaceAfterMs) {
          const mined = await this.client.getTransactionCount({ address, blockTag: "latest" });
          if (BigInt(mined) > nonce) {
            // The nonce is used. If it was by one of our attempts its receipt shows up within
            // the grace period; otherwise another transaction took it.
            consumedSince = now;
            log.warn(
              { id: tx.id, nonce: nonce.toString() },
              "nonce is mined but no receipt of this transaction was found yet",
            );
          } else {
            const bumped =
              state.attempts.length - 1 < this.settings.maxFeeBumps
                ? await this.bump(signer, tx, state, nonce, log)
                : undefined;
            if (bumped) {
              state = bumped;
            } else if (!reportedStuck) {
              reportedStuck = true;
              const reason = `still pending after ${(state.attempts.length - 1).toString()} fee bump(s)`;
              log.error(
                { id: tx.id, nonce: nonce.toString(), txHash: latestAttempt(tx, state).hash },
                `transaction ${reason}, the signer's queue is blocked behind it`,
              );
              await this.store.recordSentError(tx.id, reason);
            }
            // The replacement, or the latest attempt again in case the mempool dropped it.
            needsBroadcast = true;
            nextBroadcastAt = 0;
            continue;
          }
        }
      } catch (error: unknown) {
        if (error instanceof TxSenderError) throw error;
        rpcFailures += 1;
        log.warn(
          { id: tx.id, err: describeError(error), failures: rpcFailures },
          "error while following a sent transaction, retrying",
        );
        await this.pause(this.backoff(rpcFailures));
        continue;
      }
      await this.pause(this.settings.receiptPollMs);
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
    try {
      const block = await this.client.getBlock({ blockNumber });
      return new Date(Number(block.timestamp) * 1000);
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
