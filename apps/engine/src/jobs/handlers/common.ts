import type { Logger } from "pino";
import type { TransactionSql } from "postgres";
import type { Hex } from "viem";

import {
  abortableSleep,
  projectChainEvent,
  TxSenderStoppedError,
  TxWaitTimeoutError,
  type JsonObject,
  type ProjectionOutcome,
  type StoredChainEvent,
  type TxOutcome,
  type TxRequest,
  type TxStatus,
} from "../../chain";
import type { Db } from "../../db";
import { JobError, RetryLaterError } from "../errors";
import type { JobContext } from "../worker";
import type { JobHandlerDeps, ResolvedJobHandlerOptions } from "./deps";

/** A state the database should never be in for this job: retried, and visible in `last_error`. */
export class JobStateError extends JobError {
  constructor(message: string) {
    super(message);
    this.name = "JobStateError";
  }
}

// ---------------------------------------------------------------------------------------------
// One handler at a time per subject
// ---------------------------------------------------------------------------------------------

/**
 * Runs `fn` while holding a Postgres advisory lock on `key`, or throws `RetryLaterError` when
 * another handler holds it. Delivery is at-least-once: the same job can run twice at the same
 * time (a worker that lost its lock is still running when another one takes the job), and this
 * keeps the two from interleaving their steps. Every step is idempotent all the same.
 *
 * The lock is transaction-scoped, taken in a transaction that stays open (and does nothing else)
 * while `fn` runs on other connections: it is released when `fn` ends, and also if the
 * connection dies, so a crash can never leave it held. This costs one pooled connection per
 * running handler.
 */
export async function withExclusiveLock<T>(
  db: Db,
  key: string,
  retryDelayMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  return db.begin(async (sql) => {
    const [row] = await sql<{ locked: boolean }[]>`
      select pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) as locked
    `;
    if (row?.locked !== true) {
      throw new RetryLaterError(retryDelayMs, `another handler is working on ${key}`);
    }
    return fn();
  });
}

// ---------------------------------------------------------------------------------------------
// The transactions of a job
// ---------------------------------------------------------------------------------------------

/** A row of `chain_txs` sent by a job under `<base>` or `<base>:<attempt>`. */
export interface TxAttempt {
  id: string;
  attempt: number;
  idempotencyKey: string;
  status: TxStatus;
  error: string | null;
  txHash: Hex | null;
  payload: JsonObject;
}

/** `<base>` for attempt 1 and `<base>:<n>` after, or always `<base>:<n>` when `alwaysSuffix`. */
export function attemptKey(base: string, attempt: number, alwaysSuffix = false): string {
  return attempt === 1 && !alwaysSuffix ? base : `${base}:${attempt.toString()}`;
}

/**
 * The transactions a job queued under `base`, oldest attempt first. `chain_txs` is the record of
 * the attempts: a row exists from the moment it is queued, whatever happens to the job after.
 */
export async function listTxAttempts(db: Db, base: string): Promise<TxAttempt[]> {
  const rows = await db<
    {
      id: string;
      idempotency_key: string;
      status: TxStatus;
      last_error: string | null;
      tx_hash: string | null;
      payload: JsonObject;
    }[]
  >`
    select id, idempotency_key, status, last_error, tx_hash, payload
    from chain_txs
    where idempotency_key = ${base} or starts_with(idempotency_key, ${`${base}:`})
  `;
  const attempts: TxAttempt[] = [];
  for (const row of rows) {
    let attempt: number;
    if (row.idempotency_key === base) {
      attempt = 1;
    } else {
      const suffix = row.idempotency_key.slice(base.length + 1);
      if (!/^[1-9][0-9]{0,5}$/.test(suffix)) continue; // Another subject's key.
      attempt = Number(suffix);
    }
    attempts.push({
      id: row.id,
      attempt,
      idempotencyKey: row.idempotency_key,
      status: row.status,
      error: row.last_error,
      txHash: row.tx_hash as Hex | null,
      payload: row.payload,
    });
  }
  return attempts.sort((a, b) => a.attempt - b.attempt);
}

/** The attempt whose row is `id`, read again (its hash and payload once final). */
export async function readTxAttempt(db: Db, base: string, id: string): Promise<TxAttempt> {
  const found = (await listTxAttempts(db, base)).find((attempt) => attempt.id === id);
  if (found === undefined) throw new JobStateError(`chain_txs row ${id} is not under ${base}`);
  return found;
}

/** The signal's reason (a `JobAbortedError` from the worker), as an error to throw. */
export function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason : new JobError("the job was interrupted");
}

/** Rejects with the signal's reason (a `JobAbortedError`) once it aborts. */
function abortPromise(signal: AbortSignal): { promise: Promise<never>; dispose: () => void } {
  let onAbort: (() => void) | undefined;
  const promise = new Promise<never>((_resolve, reject) => {
    const fail = (): void => {
      reject(abortError(signal));
    };
    if (signal.aborted) {
      fail();
      return;
    }
    onAbort = fail;
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return {
    promise,
    dispose: (): void => {
      if (onAbort) signal.removeEventListener("abort", onAbort);
    },
  };
}

/**
 * The final outcome of a queued transaction. When it is not final within the wait, or the sender
 * stops, the job is retried later (`RetryLaterError`): the transaction is not abandoned, and the
 * retry, finding the same row, waits for it again. Nothing is ever decided on an unknown outcome.
 * When the job's signal aborts (worker stopping, lock lost), its reason is thrown so the worker
 * gives the job back.
 *
 * The sender's `waitFor` takes no signal, so the wait is cut in slices of `waitSliceMs` and the
 * signal is checked between them: once the job gives up, the abandoned `waitFor` polls the
 * database for at most one slice.
 */
export async function awaitOutcome(
  deps: Pick<JobHandlerDeps, "txSender">,
  options: Pick<ResolvedJobHandlerOptions, "waitTimeoutMs" | "retryDelayMs" | "waitSliceMs">,
  ctx: Pick<JobContext, "signal">,
  txId: string,
): Promise<TxOutcome> {
  const deadline = Date.now() + options.waitTimeoutMs;
  const aborted = abortPromise(ctx.signal);
  try {
    for (;;) {
      if (ctx.signal.aborted) throw abortError(ctx.signal);
      const slice = Math.max(0, Math.min(options.waitSliceMs, deadline - Date.now()));
      try {
        return await Promise.race([
          deps.txSender.waitFor(txId, { timeoutMs: slice }),
          aborted.promise,
        ]);
      } catch (error: unknown) {
        if (error instanceof TxWaitTimeoutError && Date.now() < deadline) continue;
        if (error instanceof TxWaitTimeoutError || error instanceof TxSenderStoppedError) {
          throw new RetryLaterError(
            options.retryDelayMs,
            `transaction ${txId} is not final yet (${error.status}); the retry waits for it again`,
          );
        }
        throw error;
      }
    }
  } finally {
    aborted.dispose();
  }
}

/** The transaction sender could not prepare the call (node down): it was never sent. */
export function isNodeUnavailable(reason: string | null | undefined): boolean {
  return reason?.startsWith("NodeUnavailable") === true;
}

/**
 * Delay before attempt `attempt + 1` of a transaction whose attempt `attempt` failed for a
 * reason that may change: `resendDelayMs`, doubled at each further attempt, at most
 * `maxResendDelayMs`.
 */
export function resendDelay(
  options: Pick<ResolvedJobHandlerOptions, "resendDelayMs" | "maxResendDelayMs">,
  attempt: number,
): number {
  const doublings = Math.min(Math.max(attempt - 1, 0), 30);
  return Math.min(options.resendDelayMs * 2 ** doublings, options.maxResendDelayMs);
}

export type PreparedTx = Omit<TxRequest, "idempotencyKey">;

export interface SentTx {
  txId: string;
  attempt: number;
  outcome: TxOutcome;
}

export interface SendOrResumeOptions {
  /**
   * Whether an attempt that ended `failed` or `reverted` for `reason` is superseded by a new
   * attempt on the next run, because the reason may change (the treasury was short of USDC, the
   * relayer of gas). Such an attempt can never be mined any more (it was never signed, or it was
   * mined and reverted, or its nonce went to another transaction), so a new key is safe. Default:
   * never, except the node outages below.
   */
  resendAfter?: (reason: string) => boolean;
}

/**
 * Sends the one transaction of a job under `base`, or resumes it, so that at most one attempt is
 * ever mined. A mined attempt answers at once. An attempt still `queued` or `sent` is waited for:
 * the same idempotency key resumes the same transaction. A new attempt (`<base>:<n>`) is queued
 * only when every earlier one is final and was not mined, and the latest was given up before
 * anything was signed (`NodeUnavailable`) or failed for a reason `resendAfter` accepts.
 * Otherwise the latest attempt's final outcome is returned for the caller to handle.
 *
 * `prepare` builds the request of a new attempt, or returns null when the job decided there is
 * nothing to send (then this returns null). An attempt that ends `NodeUnavailable` throws
 * `RetryLaterError`; the next run queues the following attempt.
 */
export async function sendOrResume(
  deps: Pick<JobHandlerDeps, "db" | "txSender">,
  options: Pick<ResolvedJobHandlerOptions, "waitTimeoutMs" | "retryDelayMs" | "waitSliceMs">,
  ctx: Pick<JobContext, "signal">,
  base: string,
  prepare: () => Promise<PreparedTx | null>,
  sendOptions: SendOrResumeOptions = {},
): Promise<SentTx | null> {
  const attempts = await listTxAttempts(deps.db, base);
  const resendAfter = sendOptions.resendAfter ?? ((): boolean => false);
  const waitOn = async (attempt: TxAttempt): Promise<SentTx> => {
    const outcome = await awaitOutcome(deps, options, ctx, attempt.id);
    if (outcome.status === "failed" && isNodeUnavailable(outcome.error)) {
      throw new RetryLaterError(
        options.retryDelayMs,
        `the node could not be reached to send ${attempt.idempotencyKey}; the next run sends it again`,
      );
    }
    return { txId: attempt.id, attempt: attempt.attempt, outcome };
  };

  const mined = attempts.find((attempt) => attempt.status === "mined");
  if (mined !== undefined) return waitOn(mined);
  const open = attempts.find((attempt) => attempt.status === "queued" || attempt.status === "sent");
  if (open !== undefined) return waitOn(open);
  const latest = attempts[attempts.length - 1];
  if (latest !== undefined) {
    const reason = latest.error ?? "unknown error";
    if (!isNodeUnavailable(reason) && !resendAfter(reason)) return waitOn(latest);
  }

  const request = await prepare();
  if (request === null) return null;
  const attempt = (latest?.attempt ?? 0) + 1;
  const idempotencyKey = attemptKey(base, attempt);
  const { id } = await deps.txSender.enqueue({ ...request, idempotencyKey });
  return waitOn({
    id,
    attempt,
    idempotencyKey,
    status: "queued",
    error: null,
    txHash: null,
    payload: {},
  });
}

// ---------------------------------------------------------------------------------------------
// A job that must not die of a passing condition
// ---------------------------------------------------------------------------------------------

type AttemptRoom = "room" | "last" | "unmanaged";

/**
 * Keeps room in the job's row for two more runs (`max_attempts >= attempts + 2`), and says
 * whether the current run had room before: "room" when a deferral of this run is retried by the
 * worker, "last" when this run is the job's last attempt (the worker would set it `dead`), and
 * "unmanaged" when the row is not this run's (a direct call, or the job was taken over).
 *
 * Extending `max_attempts` also keeps the job alive if this worker crashes: the reaper sets an
 * abandoned job `dead` only once its attempts are used up.
 */
async function keepAttemptRoom(
  db: Db,
  ctx: Pick<JobContext, "jobId" | "attempt">,
): Promise<{
  room: AttemptRoom;
  extendedTo: number | null;
}> {
  const rows = await db<{ before: number; after: number }[]>`
    with mine as (
      select id, max_attempts from jobs
      where id = ${ctx.jobId} and status = 'running' and attempts = ${ctx.attempt}
      for update
    )
    update jobs
    set max_attempts = greatest(jobs.max_attempts, jobs.attempts + 2)
    from mine
    where jobs.id = mine.id
    returning mine.max_attempts as before, jobs.max_attempts as after
  `;
  const [row] = rows;
  if (row === undefined) return { room: "unmanaged", extendedTo: null };
  return {
    room: row.before > ctx.attempt ? "room" : "last",
    extendedTo: row.after > row.before ? row.after : null,
  };
}

/**
 * Runs `fn` so that a passing condition (`RetryLaterError`: a node or payment outage, a
 * transaction not final yet) can never send the job to `dead` once `committed()` says money or
 * a transaction is at stake. The worker counts a deferral as an attempt, and a job that defers on
 * its last attempt goes `dead`: a purchase whose ticket is issued would then never be captured,
 * a campaign whose budget is paid never created.
 *
 * So, at each deferral of a committed job, the job's row is given room for more runs (logged at
 * warn once it goes past the attempts it was enqueued with). If this run is already the last
 * one, the deferral is not handed to the worker: `fn` is run again in this run after the
 * deferral's delay (logged at error), until it ends or the job's signal aborts, whose reason is
 * then thrown so the worker gives the job back with its attempt refunded.
 */
export async function runUntilSettled<T>(
  deps: Pick<JobHandlerDeps, "db">,
  log: Logger,
  ctx: JobContext,
  fields: Record<string, unknown>,
  committed: () => Promise<boolean>,
  fn: () => Promise<T>,
): Promise<T> {
  let inRun = false;
  for (;;) {
    try {
      return await fn();
    } catch (error: unknown) {
      if (!(error instanceof RetryLaterError)) throw error;
      if (!inRun) {
        let room: AttemptRoom;
        try {
          if (!(await committed())) throw error;
          const kept = await keepAttemptRoom(deps.db, ctx);
          room = kept.room;
          if (kept.extendedTo !== null) {
            log.warn(
              { ...fields, jobId: ctx.jobId, attempt: ctx.attempt, maxAttempts: kept.extendedTo },
              "job kept alive past its planned attempts: its work is committed and cannot finish yet",
            );
          }
        } catch (checkError: unknown) {
          if (checkError === error) throw error;
          // The database cannot say: the safe side is to keep trying in this run.
          log.warn(
            { ...fields, jobId: ctx.jobId, err: checkError },
            "could not keep room for the job's retries; retrying in this run",
          );
          room = "last";
        }
        if (room !== "last") throw error;
        inRun = true;
        log.error(
          { ...fields, jobId: ctx.jobId, attempt: ctx.attempt, reason: error.message },
          "last attempt of a committed job and its work cannot finish yet: retrying inside this run",
        );
      }
      if (ctx.signal.aborted) throw abortError(ctx.signal);
      await abortableSleep(error.delayMs, ctx.signal);
      if (ctx.signal.aborted) throw abortError(ctx.signal);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Projection of a receipt
// ---------------------------------------------------------------------------------------------

interface ChainEventRow {
  tx_hash: string;
  log_index: number;
  block_number: bigint;
  block_time: Date | null;
  name: string;
  args: JsonObject;
  created_at: Date;
}

/**
 * The escrow events of a transaction, locked for the rest of `sql`'s transaction so the chain
 * projector skips them (it takes rows with `skip locked`) while this job applies them.
 */
export async function lockTransactionEvents(
  sql: TransactionSql,
  txHash: Hex,
): Promise<StoredChainEvent[]> {
  const rows = await sql<ChainEventRow[]>`
    select tx_hash, log_index, block_number, block_time, name, args, created_at
    from chain_events
    where tx_hash = ${txHash.toLowerCase()}
    order by log_index
    for update
  `;
  return rows.map((row) => ({
    txHash: row.tx_hash as Hex,
    logIndex: row.log_index,
    blockNumber: row.block_number,
    blockTime: row.block_time,
    name: row.name,
    args: row.args,
    createdAt: row.created_at,
  }));
}

/**
 * Applies events with `projectChainEvent`, the code path of every other source, and marks them
 * processed, inside the caller's transaction. Idempotent: an event the projector already applied
 * is applied again to the same result. An event that has to wait for its campaign is a
 * `JobStateError`: the jobs that call this write the campaign first.
 */
export async function projectEvents(
  sql: TransactionSql,
  events: readonly StoredChainEvent[],
): Promise<ProjectionOutcome[]> {
  const outcomes: ProjectionOutcome[] = [];
  for (const event of events) {
    const outcome = await projectChainEvent(sql, event);
    if (outcome.status === "deferred") {
      throw new JobStateError(
        `event ${event.name} of ${event.txHash} cannot be projected: ${outcome.reason}`,
      );
    }
    await sql`
      update chain_events set processed_at = coalesce(processed_at, now())
      where tx_hash = ${event.txHash} and log_index = ${event.logIndex}
    `;
    outcomes.push(outcome);
  }
  return outcomes;
}

/** A uint argument of an event as stored (decimal string or small number). */
export function uintArg(event: StoredChainEvent, name: string): bigint {
  const value = event.args[name];
  if (typeof value === "string" && /^[0-9]+$/.test(value)) return BigInt(value);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  throw new JobStateError(`event ${event.name} of ${event.txHash} has no uint argument ${name}`);
}
