import type { Logger } from "pino";
import {
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  type Hex,
  type LocalAccount,
  type TransactionSerialized,
} from "viem";

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
import { resolveTxSenderSettings, type TxSenderSettings } from "./settings";
import { ChainTxStore, readSenderState, readSignedAttempts } from "./store";
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
 * Run one sender per database. A second one is held back by the row guards and the unique
 * `(signer, nonce)` index, but it is not a supported way to scale.
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
    const addresses = SIGNER_NAMES.map((signer) => deps.accounts[signer].address.toLowerCase());
    if (new Set(addresses).size !== addresses.length) {
      // Two queues on one key would hand out the same nonces.
      throw new TxSenderConfigError("The relayer and the oracle must be two different keys");
    }
    this.workers = {
      relayer: { nextNonce: null, dirty: false, wake: null, loop: null },
      oracle: { nextNonce: null, dirty: false, wake: null, loop: null },
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
   * from their stored bytes first. Rejects if the node is unreachable or on another chain.
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
   * Refuses to start when the rows of a signer role were signed by another key or for another
   * chain and the configured key cannot go on from them. Nonces are stored per role only
   * (`chain_txs` has no address or chain column), so after a key rotation or a chain switch the
   * stored nonces would either be driven forever (a `sent` row of the old key) or leave the new
   * key a nonce gap that is never mined. The key and chain of a row are read back from its
   * signed bytes. A new key already past every stored nonce is accepted: its nonces come from
   * the chain and collide with nothing.
   */
  private async checkSignerHistory(signer: SignerName): Promise<void> {
    const address = this.accounts[signer].address.toLowerCase();
    const chainId = this.settings.chainId;
    let pendingCount: bigint | null = null;
    for (const tx of await this.store.rowsToCheckAgainstSigner(signer)) {
      if (tx.nonce === null) continue;
      let signedBy: string;
      let signedFor: number | undefined;
      try {
        const [attempt] = readSignedAttempts(tx).attempts;
        if (!attempt) throw new CorruptSenderStateError(tx.id, "no signed attempt");
        const serializedTransaction = attempt.raw as TransactionSerialized;
        signedBy = (await recoverTransactionAddress({ serializedTransaction })).toLowerCase();
        signedFor = parseTransaction(serializedTransaction).chainId;
      } catch (error: unknown) {
        // A row whose signed bytes are unusable blocks only its own signer: its worker refuses
        // it and says so on every pass, without signing anything for that role.
        this.log.error(
          { signer, id: tx.id, status: tx.status, err: describeError(error) },
          "signing key of a stored transaction cannot be read, not checked against the configuration",
        );
        continue;
      }
      if (signedBy === address && signedFor === chainId) continue;
      if (tx.status !== "sent") {
        pendingCount ??= BigInt(
          await this.client.getTransactionCount({
            address: this.accounts[signer].address,
            blockTag: "pending",
          }),
        );
        // The configured key's own count is past every stored nonce of the role.
        if (pendingCount > tx.nonce) continue;
      }
      throw new SignerHistoryMismatchError(
        signer,
        tx.id,
        { address: signedBy, chainId: signedFor ?? 0, nonce: tx.nonce, status: tx.status },
        { address, chainId, pendingCount },
      );
    }
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
        const sent = await this.store.oldestSent(signer);
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
        log.error(
          { err: describeError(error), failures },
          "transaction worker failed, retrying after a pause",
        );
        await this.pause(this.backoff(failures));
      }
    }
  }

  /** Next nonce = max(what the chain counts, pending included; highest nonce stored + 1). */
  private async nextNonce(signer: SignerName): Promise<bigint> {
    const worker = this.workers[signer];
    if (worker.nextNonce !== null) return worker.nextNonce;
    const [onChain, stored] = await Promise.all([
      this.client.getTransactionCount({
        address: this.accounts[signer].address,
        blockTag: "pending",
      }),
      this.store.maxNonce(signer),
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

    // Stopping before anything is signed leaves the row exactly as it was.
    if (this.stopping) return;

    const worker = this.workers[signer];
    const nonce = await this.nextNonce(signer);
    const fees = computeFees(suggestion, this.settings.feePolicy);
    const attempt = await this.sign(account, tx, { nonce, gas, fees });
    const state: SenderState = { gas: gas.toString(), attempts: [attempt] };

    // The signed bytes reach the database before they reach the network. If this write is lost
    // or its answer is, the nonce is derived again and the row is read again.
    const stored = await this.store.markSent({
      id: tx.id,
      nonce,
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
      { ...tx, status: "sent", nonce, txHash: attempt.hash },
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
  ): Promise<{ accepted: true } | { accepted: false; error: string }> {
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
      log.warn({ id: tx.id, txHash: attempt.hash, err: description }, "broadcast failed, retrying");
      return { accepted: false, error: description };
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
            lastBroadcastAt = this.nowMs();
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
