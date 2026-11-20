import type { Logger } from "pino";
import { prettifyError, type ZodType } from "zod";

import type { Db } from "../db";
import type { LoopHeartbeat } from "../health/loops";
import type { BackoffFn } from "./backoff";
import {
  describeJobError,
  InvalidJobPayloadError,
  JobAbortedError,
  JobConfigError,
  PermanentJobError,
  RetryLaterError,
} from "./errors";

/** Current time in epoch milliseconds. Injected so tests can move time without waiting. */
export type Clock = () => number;

export interface JobContext {
  jobId: string;
  /** 1 for the first run of the job, 2 for its first retry, and so on. */
  attempt: number;
  /**
   * Aborted when the worker stops or loses the job to another worker. Its `reason` is a
   * `JobAbortedError`. A handler in a section that must not be interrupted may ignore it until
   * that section is over.
   */
  signal: AbortSignal;
}

/**
 * Executes one job. Delivery is at-least-once: a handler can run again for the same job (after a
 * crash, a lost lock, or a failed write of the result), so its effects must be idempotent.
 */
export type JobHandler<TPayload> = (payload: TPayload, ctx: JobContext) => Promise<unknown>;

export interface JobWorkerConfig {
  /** Handlers running at the same time in this worker. */
  concurrency: number;
  /** Pause between two looks at the queue when there is nothing to do. */
  pollIntervalMs: number;
  /**
   * A job `running` whose lock is older than this is considered abandoned and put back in the
   * queue by any worker. A live worker refreshes the lock of its jobs every third of this delay,
   * so a handler may run longer than the timeout.
   */
  visibilityTimeoutMs: number;
  /** Written to `jobs.locked_by`. Must be unique among live workers. */
  workerId: string;
  /** Delay before the next try after a failure. See `exponentialBackoff`. */
  backoff: BackoffFn;
  /**
   * How long `stop()` waits for in-flight handlers after aborting their signal, before it gives
   * their jobs back to the queue. Default 10 s.
   */
  shutdownGraceMs?: number;
}

export interface JobWorkerOptions {
  db: Db;
  logger: Logger;
  /** Default: the system clock. */
  clock?: Clock;
  config: JobWorkerConfig;
  /** Told of every poll that ran to its end without failing (`/healthz`, `health/loops.ts`). */
  heartbeat?: LoopHeartbeat;
}

interface Registration {
  schema: ZodType<unknown> | undefined;
  handler: JobHandler<unknown>;
}

interface ClaimedJob {
  id: string;
  kind: string;
  payload: unknown;
  attempts: number;
  max_attempts: number;
}

interface InFlight {
  job: ClaimedJob;
  controller: AbortController;
  settled: Promise<void>;
}

type Outcome =
  | { type: "done" }
  | { type: "retry"; delayMs: number; error: unknown; deferred: boolean }
  | { type: "dead"; error: unknown }
  | { type: "released" }
  | { type: "lost" };

const DEFAULT_SHUTDOWN_GRACE_MS = 10_000;
/** A result that cannot be written is retried this many times before the job is left to the reaper. */
const RESULT_WRITE_ATTEMPTS = 3;
const RESULT_WRITE_RETRY_MS = 100;

function requirePositive(name: string, value: number, integer: boolean): void {
  const valid = Number.isFinite(value) && value > 0 && (!integer || Number.isInteger(value));
  if (!valid) {
    throw new JobConfigError(
      `JobWorker config ${name} must be a positive ${integer ? "integer" : "number"}, got ${String(value)}`,
    );
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Takes jobs from the `jobs` table and runs their handlers.
 *
 * Several workers can share the queue: a job is claimed with `for update skip locked`, so two
 * workers never take the same row. A job is `queued` -> `running` -> `done`, back to `queued`
 * with a later `run_at` after a failure, and `dead` once its attempts are used up or its handler
 * says retrying is pointless. `dead` jobs are never picked up again; they stay for inspection.
 */
export class JobWorker {
  private readonly db: Db;
  private readonly logger: Logger;
  private readonly clock: Clock;
  private readonly config: Required<JobWorkerConfig>;
  private readonly registrations = new Map<string, Registration>();
  private readonly inFlight = new Map<string, InFlight>();
  private readonly loopHeartbeat: LoopHeartbeat | undefined;

  private loopDone: Promise<void> | undefined;
  private stopDone: Promise<void> | undefined;
  private stopping = false;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private heartbeatBusy = false;
  /** Set while the loop sleeps; calling it ends the sleep. */
  private wakeSleeper: (() => void) | undefined;
  /** A wake-up that arrived while the loop was busy, so the next sleep is skipped. */
  private wakePending = false;

  constructor(options: JobWorkerOptions) {
    const { config } = options;
    requirePositive("concurrency", config.concurrency, true);
    requirePositive("pollIntervalMs", config.pollIntervalMs, false);
    requirePositive("visibilityTimeoutMs", config.visibilityTimeoutMs, false);
    const shutdownGraceMs = config.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;
    if (!Number.isFinite(shutdownGraceMs) || shutdownGraceMs < 0) {
      throw new JobConfigError(
        `JobWorker config shutdownGraceMs must be a number >= 0, got ${String(shutdownGraceMs)}`,
      );
    }
    if (config.workerId.trim() === "") {
      throw new JobConfigError("JobWorker config workerId must not be empty");
    }
    this.db = options.db;
    this.clock = options.clock ?? Date.now;
    this.config = { ...config, shutdownGraceMs };
    this.logger = options.logger.child({ module: "jobs", workerId: config.workerId });
    this.loopHeartbeat = options.heartbeat;
  }

  /** Registers the handler of a job kind. The payload reaches the handler as stored. */
  register(kind: string, handler: JobHandler<unknown>): void;
  /**
   * Registers the handler of a job kind with the schema of its payload. A payload the schema
   * rejects sends the job straight to `dead` with the validation message; the handler is not
   * called. The handler receives the parsed value (defaults and transforms applied).
   */
  register<TPayload>(kind: string, schema: ZodType<TPayload>, handler: JobHandler<TPayload>): void;
  register<TPayload>(
    kind: string,
    schemaOrHandler: ZodType<TPayload> | JobHandler<unknown>,
    maybeHandler?: JobHandler<TPayload>,
  ): void {
    if (kind.trim() === "") throw new JobConfigError("job kind must not be empty");
    if (this.registrations.has(kind)) {
      throw new JobConfigError(`a handler is already registered for job kind "${kind}"`);
    }
    if (typeof schemaOrHandler === "function") {
      this.registrations.set(kind, { schema: undefined, handler: schemaOrHandler });
      return;
    }
    if (maybeHandler === undefined) {
      throw new JobConfigError(`job kind "${kind}" was registered with a schema but no handler`);
    }
    this.registrations.set(kind, {
      schema: schemaOrHandler,
      // Sound: the handler is only ever called with the output of this schema.
      handler: maybeHandler as JobHandler<unknown>,
    });
  }

  /** Starts polling. Returns at once; the loop runs until `stop()`. */
  start(): void {
    if (this.loopDone !== undefined) {
      throw new JobConfigError(`job worker ${this.config.workerId} is already started`);
    }
    this.stopping = false;
    this.stopDone = undefined;
    this.wakePending = false;
    this.loopDone = this.loop();
    this.heartbeatTimer = setInterval(
      () => {
        void this.heartbeat();
      },
      Math.max(1, Math.floor(this.config.visibilityTimeoutMs / 3)),
    );
    this.logger.info(
      {
        concurrency: this.config.concurrency,
        pollIntervalMs: this.config.pollIntervalMs,
        visibilityTimeoutMs: this.config.visibilityTimeoutMs,
        kinds: [...this.registrations.keys()],
      },
      "job worker started",
    );
  }

  /**
   * Stops taking jobs, aborts the signal of in-flight handlers and waits for them up to
   * `shutdownGraceMs`. A handler that returns ends its job `done`; one that throws because it was
   * interrupted gets its job back in the queue with the attempt refunded; one still running after
   * the grace period has its job taken away and put back in the queue (its late result is
   * ignored). When the promise resolves, no job is `running` under this worker's id. Never
   * rejects.
   */
  stop(): Promise<void> {
    if (this.loopDone === undefined) return Promise.resolve();
    this.stopDone ??= this.shutdown(this.loopDone);
    return this.stopDone;
  }

  private async shutdown(loopDone: Promise<void>): Promise<void> {
    this.stopping = true;
    this.wake();
    await loopDone;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;

    const running = [...this.inFlight.values()];
    for (const entry of running) {
      entry.controller.abort(
        new JobAbortedError("worker-stopping", `worker ${this.config.workerId} is stopping`),
      );
    }
    if (running.length > 0) {
      let graceTimer: NodeJS.Timeout | undefined;
      const graceOver = new Promise<void>((resolve) => {
        graceTimer = setTimeout(resolve, this.config.shutdownGraceMs);
      });
      await Promise.race([Promise.all(running.map((entry) => entry.settled)), graceOver]);
      clearTimeout(graceTimer);
    }

    const leftover = [...this.inFlight.values()].map((entry) => entry.job);
    if (leftover.length > 0) {
      try {
        await this.release(leftover, "handler still running after the shutdown grace period");
      } catch (error: unknown) {
        // The jobs stay `running`; another worker takes them over after the visibility timeout.
        this.logger.error(
          { err: error, jobIds: leftover.map((job) => job.id) },
          "could not release jobs at shutdown; they will be recovered after the visibility timeout",
        );
      }
      for (const job of leftover) this.inFlight.delete(job.id);
    }
    this.loopDone = undefined;
    this.logger.info({ released: leftover.length }, "job worker stopped");
  }

  // ----------------------------------------------------------------------------------------
  // Loop
  // ----------------------------------------------------------------------------------------

  private async loop(): Promise<void> {
    let reap = true;
    while (!this.stopping) {
      try {
        if (reap) await this.recoverAbandoned();
        await this.claimAndRun();
        this.beat();
      } catch (error: unknown) {
        // Typically the database is unreachable: keep polling, it is a recoverable condition.
        this.logger.error({ err: error }, "job worker tick failed; retrying at the next poll");
      }
      if (this.stopping) break;
      // Abandoned jobs are looked for at the polling pace, not each time a handler ends.
      reap = (await this.idle()) === "timeout";
    }
  }

  private beat(): void {
    try {
      this.loopHeartbeat?.beat();
    } catch {
      // The health report must never stop the worker.
    }
  }

  /** Sleeps one poll interval, or less if a handler finishes or the worker stops. */
  private idle(): Promise<"timeout" | "wake"> {
    if (this.wakePending) {
      this.wakePending = false;
      return Promise.resolve("wake");
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wakeSleeper = undefined;
        resolve("timeout");
      }, this.config.pollIntervalMs);
      this.wakeSleeper = (): void => {
        clearTimeout(timer);
        this.wakeSleeper = undefined;
        resolve("wake");
      };
    });
  }

  private wake(): void {
    if (this.wakeSleeper) this.wakeSleeper();
    else this.wakePending = true;
  }

  private async claimAndRun(): Promise<void> {
    const free = this.config.concurrency - this.inFlight.size;
    const kinds = [...this.registrations.keys()];
    if (free <= 0 || kinds.length === 0) return;

    const now = new Date(this.clock());
    const claimed = await this.db<ClaimedJob[]>`
      with next as (
        select id from jobs
        where status = 'queued' and run_at <= ${now} and kind in ${this.db(kinds)}
        order by run_at, created_at
        limit ${free}
        for update skip locked
      )
      update jobs
      set status = 'running',
          attempts = jobs.attempts + 1,
          locked_at = ${now},
          locked_by = ${this.config.workerId}
      from next
      where jobs.id = next.id
      returning jobs.id, jobs.kind, jobs.payload, jobs.attempts, jobs.max_attempts
    `;
    if (claimed.length === 0) return;

    if (this.stopping) {
      // stop() was called while the claim was in flight: do not start handlers only to abort them.
      await this.release(claimed, "worker stopped before the handler started");
      return;
    }
    for (const job of claimed) this.launch(job);
  }

  private launch(job: ClaimedJob): void {
    const controller = new AbortController();
    const entry: InFlight = { job, controller, settled: Promise.resolve() };
    this.inFlight.set(job.id, entry);
    this.logger.info(
      { jobId: job.id, kind: job.kind, attempt: job.attempts, maxAttempts: job.max_attempts },
      "job started",
    );
    entry.settled = this.run(job, controller.signal)
      .catch((error: unknown) => {
        // run() handles its own errors; this guards the queue against a bug in the worker itself.
        this.logger.error(
          { err: error, jobId: job.id, kind: job.kind, attempt: job.attempts },
          "job worker failed while finishing a job; it will be recovered after the visibility timeout",
        );
      })
      .finally(() => {
        // Only forget the entry if it is still ours: after a forced release at shutdown and a
        // restart, the same job id may be in flight again.
        if (this.inFlight.get(job.id) === entry) this.inFlight.delete(job.id);
        this.wake();
      });
  }

  // ----------------------------------------------------------------------------------------
  // One job
  // ----------------------------------------------------------------------------------------

  private async run(job: ClaimedJob, signal: AbortSignal): Promise<void> {
    const outcome = await this.execute(job, signal);
    await this.writeOutcome(job, outcome);
  }

  private async execute(job: ClaimedJob, signal: AbortSignal): Promise<Outcome> {
    const registration = this.registrations.get(job.kind);
    if (registration === undefined) {
      // Cannot happen: only registered kinds are claimed and handlers are never removed.
      return { type: "dead", error: new JobConfigError(`no handler for job kind "${job.kind}"`) };
    }

    let payload: unknown = job.payload;
    if (registration.schema !== undefined) {
      const parsed = registration.schema.safeParse(job.payload);
      if (!parsed.success) {
        return {
          type: "dead",
          error: new InvalidJobPayloadError(job.kind, prettifyError(parsed.error)),
        };
      }
      payload = parsed.data;
    }

    try {
      await registration.handler(payload, { jobId: job.id, attempt: job.attempts, signal });
      return { type: "done" };
    } catch (error: unknown) {
      return this.classifyFailure(job, signal, error);
    }
  }

  private classifyFailure(job: ClaimedJob, signal: AbortSignal, error: unknown): Outcome {
    if (error instanceof PermanentJobError) return { type: "dead", error };

    const abortReason: unknown = signal.aborted ? signal.reason : undefined;
    if (abortReason instanceof JobAbortedError) {
      // The handler was interrupted, it did not fail: the queue must not hold it against the job.
      if (abortReason.reason === "lock-lost") return { type: "lost" };
      if (!(error instanceof RetryLaterError)) return { type: "released" };
    }

    const exhausted = job.attempts >= job.max_attempts;
    if (exhausted) return { type: "dead", error };
    if (error instanceof RetryLaterError) {
      return { type: "retry", delayMs: error.delayMs, error, deferred: true };
    }
    const backoffMs = this.config.backoff(job.attempts);
    const delayMs = Number.isFinite(backoffMs) && backoffMs > 0 ? backoffMs : 0;
    return { type: "retry", delayMs, error, deferred: false };
  }

  /**
   * Writes the result of a run. Every write is guarded by "still running, still locked by this
   * worker, same attempt": if the job was taken over meanwhile, the write changes nothing and the
   * new owner's result stands.
   */
  private async writeOutcome(job: ClaimedJob, outcome: Outcome): Promise<void> {
    const fields = { jobId: job.id, kind: job.kind, attempt: job.attempts };
    if (outcome.type === "lost") {
      this.logger.warn(fields, "job interrupted: its lock was taken over by another worker");
      return;
    }

    let applied: boolean;
    for (let attempt = 1; ; attempt += 1) {
      try {
        applied = await this.applyOutcome(job, outcome);
        break;
      } catch (error: unknown) {
        if (attempt >= RESULT_WRITE_ATTEMPTS) {
          this.logger.error(
            { ...fields, err: error, outcome: outcome.type },
            "could not write the result of a job; it stays running and will be run again after the visibility timeout",
          );
          return;
        }
        this.logger.warn(
          { ...fields, err: error, outcome: outcome.type },
          "writing the result of a job failed; retrying",
        );
        await delay(RESULT_WRITE_RETRY_MS * attempt);
      }
    }

    if (!applied) {
      this.logger.warn(
        { ...fields, outcome: outcome.type },
        "job result ignored: the job is no longer locked by this worker",
      );
      return;
    }
    switch (outcome.type) {
      case "done":
        this.logger.info(fields, "job done");
        return;
      case "released":
        this.logger.info(fields, "job released to the queue: the worker is stopping");
        return;
      case "dead":
        this.logger.error(
          { ...fields, err: outcome.error, maxAttempts: job.max_attempts },
          "job dead: it will not be retried",
        );
        return;
      case "retry":
        if (outcome.deferred) {
          this.logger.info(
            { ...fields, delayMs: outcome.delayMs, reason: describeJobError(outcome.error) },
            "job deferred by its handler",
          );
        } else {
          this.logger.warn(
            {
              ...fields,
              err: outcome.error,
              delayMs: outcome.delayMs,
              maxAttempts: job.max_attempts,
            },
            "job failed; retry scheduled",
          );
        }
        return;
    }
  }

  private async applyOutcome(
    job: ClaimedJob,
    outcome: Exclude<Outcome, { type: "lost" }>,
  ): Promise<boolean> {
    const db = this.db;
    const owned = db`
      id = ${job.id} and status = 'running'
      and locked_by = ${this.config.workerId} and attempts = ${job.attempts}
    `;
    const nowMs = this.clock();
    switch (outcome.type) {
      case "done": {
        const rows = await db`
          update jobs set status = 'done', locked_at = null, locked_by = null
          where ${owned} returning id
        `;
        return rows.length > 0;
      }
      case "retry": {
        const rows = await db`
          update jobs
          set status = 'queued', run_at = ${new Date(nowMs + outcome.delayMs)},
              last_error = ${describeJobError(outcome.error)}, locked_at = null, locked_by = null
          where ${owned} returning id
        `;
        return rows.length > 0;
      }
      case "dead": {
        const rows = await db`
          update jobs
          set status = 'dead', last_error = ${describeJobError(outcome.error)},
              locked_at = null, locked_by = null
          where ${owned} returning id
        `;
        return rows.length > 0;
      }
      case "released": {
        const rows = await db`
          update jobs
          set status = 'queued', attempts = greatest(attempts - 1, 0), run_at = ${new Date(nowMs)},
              locked_at = null, locked_by = null
          where ${owned} returning id
        `;
        return rows.length > 0;
      }
    }
  }

  /** Gives jobs back to the queue as if they had not been taken: the attempt is refunded. */
  private async release(jobs: ClaimedJob[], reason: string): Promise<void> {
    const ids = jobs.map((job) => job.id);
    const released = await this.db<{ id: string }[]>`
      update jobs
      set status = 'queued', attempts = greatest(attempts - 1, 0),
          run_at = ${new Date(this.clock())}, locked_at = null, locked_by = null
      where id in ${this.db(ids)} and status = 'running' and locked_by = ${this.config.workerId}
      returning id
    `;
    const releasedIds = new Set(released.map((row) => row.id));
    for (const job of jobs) {
      if (!releasedIds.has(job.id)) continue;
      this.logger.warn(
        { jobId: job.id, kind: job.kind, attempt: job.attempts, reason },
        "job released to the queue",
      );
    }
  }

  // ----------------------------------------------------------------------------------------
  // Locks: abandoned jobs and heartbeat
  // ----------------------------------------------------------------------------------------

  /**
   * Puts back in the queue the jobs whose worker stopped refreshing their lock (it crashed or was
   * killed). The attempt they were on stays counted, so a job that kills its worker every time
   * still ends up `dead`.
   */
  private async recoverAbandoned(): Promise<void> {
    const nowMs = this.clock();
    const now = new Date(nowMs);
    const cutoff = new Date(nowMs - this.config.visibilityTimeoutMs);
    const recovered = await this.db<
      {
        id: string;
        kind: string;
        attempts: number;
        status: string;
        previous_owner: string | null;
      }[]
    >`
      with stale as (
        select id, locked_by from jobs
        where status = 'running' and (locked_at is null or locked_at < ${cutoff})
        for update skip locked
      )
      update jobs
      set status = case when jobs.attempts >= jobs.max_attempts then 'dead' else 'queued' end,
          run_at = ${now},
          last_error = 'JobAbandonedError: worker ' || coalesce(stale.locked_by, 'unknown')
            || ' stopped refreshing its lock during attempt ' || jobs.attempts::text,
          locked_at = null,
          locked_by = null
      from stale
      where jobs.id = stale.id
      returning jobs.id, jobs.kind, jobs.attempts, jobs.status, stale.locked_by as previous_owner
    `;
    for (const row of recovered) {
      const fields = {
        jobId: row.id,
        kind: row.kind,
        attempt: row.attempts,
        previousOwner: row.previous_owner,
      };
      if (row.status === "dead") {
        this.logger.error(fields, "abandoned job dead: its attempts are used up");
      } else {
        this.logger.warn(fields, "abandoned job recovered: back in the queue");
      }
      // If the "dead" worker is this one (its heartbeat could not reach the database), stop the
      // handler: the job no longer belongs to it.
      this.abortLost(row.id, row.attempts);
    }
  }

  /** Refreshes the lock of in-flight jobs, and interrupts the handlers whose lock was lost. */
  private async heartbeat(): Promise<void> {
    if (this.heartbeatBusy || this.inFlight.size === 0) return;
    this.heartbeatBusy = true;
    try {
      const mine = [...this.inFlight.values()].map((entry) => entry.job);
      const ids = mine.map((job) => job.id);
      const kept = await this.db<{ id: string; attempts: number }[]>`
        update jobs set locked_at = ${new Date(this.clock())}
        where id in ${this.db(ids)} and status = 'running' and locked_by = ${this.config.workerId}
        returning id, attempts
      `;
      const keptAttempt = new Map(kept.map((row) => [row.id, row.attempts]));
      for (const job of mine) {
        if (keptAttempt.get(job.id) !== job.attempts) this.abortLost(job.id, job.attempts);
      }
    } catch (error: unknown) {
      this.logger.warn({ err: error }, "could not refresh job locks; retrying at the next beat");
    } finally {
      this.heartbeatBusy = false;
    }
  }

  private abortLost(jobId: string, attempt: number): void {
    const entry = this.inFlight.get(jobId);
    if (entry === undefined || entry.job.attempts !== attempt || entry.controller.signal.aborted) {
      return;
    }
    entry.controller.abort(
      new JobAbortedError("lock-lost", `job ${jobId} is no longer locked by this worker`),
    );
  }
}
