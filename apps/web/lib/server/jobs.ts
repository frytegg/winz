import { JOB_PAYLOAD_SCHEMAS, type JobKind } from "@winz/shared";
import type { Sql, TransactionSql } from "postgres";
import type { z } from "zod";

/**
 * The web app's side of the job queue (SPEC section 7): routes never send a transaction, they
 * insert a job that the engine executes. Same table and same rules as the engine's
 * `apps/engine/src/jobs/enqueue.ts`.
 */

/** A pooled client or a transaction handle: inside a transaction the job commits with it. */
export type JobSql = Sql | TransactionSql;

/** The payload a job kind takes, as `JOB_PAYLOAD_SCHEMAS` defines it. */
export type JobPayload<K extends JobKind> = z.input<(typeof JOB_PAYLOAD_SCHEMAS)[K]>;

/** A payload that does not match its kind's schema: a programming error, never a client one. */
export class JobPayloadError extends Error {
  constructor(kind: JobKind, reason: string) {
    super(`invalid payload for job kind "${kind}": ${reason}`);
    this.name = "JobPayloadError";
  }
}

export interface EnqueuedJob {
  id: string;
  /** False when the idempotency key already had a job: nothing was inserted. */
  created: boolean;
}

/** How a job is placed among others: see `enqueueJob`. */
export interface EnqueueJobOptions<K extends JobKind> {
  /**
   * A payload field naming a sequence of jobs (for `campaign.set_paused`, `campaignId`: one
   * merchant's pause and resume requests of one campaign). The job's `created_at` is then at least
   * one microsecond after that of every job of the same kind with the same value in this field,
   * even when the clock is behind it or reads the same microsecond: inside the sequence the stamps
   * strictly increase in the order of the inserts, and no tie is left for a random id to break.
   * That order is the order in which the jobs became visible only when the caller holds a lock
   * that serialises the sequence's inserts until it commits (the campaign's row lock for the
   * pause routes); without one, two inserts may read the same latest stamp.
   */
  sequenceBy?: keyof JobPayload<K> & string;
}

/**
 * Inserts a `queued` job, after validating its payload. A second call with the same idempotency
 * key inserts nothing and returns the job that holds the key (`on conflict do nothing`: two racing
 * calls end with one row, the unique constraint decides).
 *
 * The job is stamped with the wall clock read by the insert itself (`clock_timestamp()`), not with
 * the time the caller's transaction began (`now()`, the column default): a request that waited for
 * a lock is stamped after the request that held it, so the order of the stamps is the order in
 * which the requests went through the lock. `run_at` is that same reading (the job may run at
 * once), never later than `created_at`.
 */
export async function enqueueJob<K extends JobKind>(
  sql: JobSql,
  kind: K,
  payload: JobPayload<K>,
  idempotencyKey: string,
  options: EnqueueJobOptions<K> = {},
): Promise<EnqueuedJob> {
  if (idempotencyKey.trim() === "") throw new JobPayloadError(kind, "empty idempotency key");
  const parsed = JOB_PAYLOAD_SCHEMAS[kind].safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new JobPayloadError(
      kind,
      `${issue?.path.join(".") ?? ""} ${issue?.message ?? ""}`.trim(),
    );
  }
  const field = options.sequenceBy;
  let floor = sql`null::timestamptz`;
  if (field !== undefined) {
    const value: unknown = (parsed.data as Record<string, unknown>)[field];
    if (typeof value !== "string") {
      throw new JobPayloadError(kind, `sequence field "${field}" is not a string`);
    }
    floor = sql`(
      select max(created_at) + interval '1 microsecond' from jobs
      where kind = ${kind} and payload ->> ${field} = ${value}
    )`;
  }
  // Sent as text and cast in SQL, as the engine does: a jsonb parameter would be encoded twice.
  const text = JSON.stringify(parsed.data);
  const inserted = await sql<{ id: string }[]>`
    with clock as (select clock_timestamp() as now),
    stamp as (select clock.now as run_at, greatest(clock.now, ${floor}) as created_at from clock)
    insert into jobs (kind, payload, status, idempotency_key, created_at, run_at)
    select ${kind}, ${text}::text::jsonb, 'queued', ${idempotencyKey}, stamp.created_at, stamp.run_at
    from stamp
    on conflict (idempotency_key) do nothing
    returning id
  `;
  const created = inserted[0];
  if (created) return { id: created.id, created: true };
  const [existing] = await sql<{ id: string }[]>`
    select id from jobs where idempotency_key = ${idempotencyKey}
  `;
  if (!existing) {
    throw new Error(`job with idempotency key "${idempotencyKey}" conflicted but cannot be read`);
  }
  return { id: existing.id, created: false };
}
