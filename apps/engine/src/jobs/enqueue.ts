import type { Sql, TransactionSql } from "postgres";

import { JobEnqueueError } from "./errors";

/**
 * A pooled client or a transaction handle of the `postgres` library. With a transaction handle
 * the job is inserted in the caller's transaction: it becomes visible to workers when the caller
 * commits, and disappears if the caller rolls back.
 */
export type JobSql = Sql | TransactionSql;

export interface EnqueueJobInput {
  kind: string;
  /** Anything `JSON.stringify` accepts. A `bigint` is refused: send amounts as strings. */
  payload: unknown;
  /** Two enqueues with the same key give one job. The key is global, not per kind. */
  idempotencyKey?: string;
  /** Earliest time a worker may pick the job up. Default: `created_at` (database clock). */
  runAt?: Date;
  /** Runs allowed before the job is set aside as `dead`. Default: the column default (5). */
  maxAttempts?: number;
}

export interface EnqueueJobResult {
  id: string;
  /** False when the idempotency key already had a job: `id` is that job, nothing was inserted. */
  created: boolean;
}

/** How many times the insert-then-read is retried when the conflicting row vanishes in between. */
const MAX_ENQUEUE_ROUNDS = 3;

function serialisePayload(kind: string, payload: unknown): string {
  let text: string | undefined;
  try {
    text = JSON.stringify(payload);
  } catch (error: unknown) {
    throw new JobEnqueueError(`payload of job kind "${kind}" cannot be serialised to JSON`, {
      cause: error,
    });
  }
  if (text === undefined) {
    throw new JobEnqueueError(
      `payload of job kind "${kind}" is not JSON (undefined, a function or a symbol)`,
    );
  }
  return text;
}

/**
 * Inserts a `queued` job. With an idempotency key, a second call returns the job that already
 * holds the key (`created: false`) and never inserts a duplicate, including when two calls race:
 * the unique constraint decides, and `on conflict do nothing` waits for a concurrent insert of the
 * same key to commit or roll back before answering.
 *
 * `created_at` is the wall clock read by the insert (`clock_timestamp()`), as on the web's side
 * (`apps/web/lib/server/jobs.ts`), not the time the caller's transaction began (`now()`, the
 * column default): the jobs of one table carry one meaning of the stamp, the moment the row was
 * written, so a job inserted after waiting for a lock is stamped after the one that held it.
 * Without `runAt`, `run_at` is that same reading: the job may run at once, and `run_at` is never
 * after `created_at`.
 */
export async function enqueueJob(db: JobSql, input: EnqueueJobInput): Promise<EnqueueJobResult> {
  const { kind, idempotencyKey, runAt, maxAttempts } = input;
  if (kind.trim() === "") throw new JobEnqueueError("job kind must not be empty");
  if (idempotencyKey !== undefined && idempotencyKey === "") {
    throw new JobEnqueueError(`idempotency key of job kind "${kind}" must not be empty`);
  }
  if (maxAttempts !== undefined && (!Number.isInteger(maxAttempts) || maxAttempts < 1)) {
    throw new JobEnqueueError(
      `maxAttempts of job kind "${kind}" must be an integer >= 1, got ${String(maxAttempts)}`,
    );
  }
  if (runAt !== undefined && Number.isNaN(runAt.getTime())) {
    throw new JobEnqueueError(`runAt of job kind "${kind}" is not a valid date`);
  }
  // Sent as text and cast in SQL: a jsonb parameter would be JSON-encoded a second time by the
  // client, and the payload would be stored as a JSON string instead of an object.
  const payload = serialisePayload(kind, input.payload);
  const key = idempotencyKey ?? null;

  for (let round = 0; round < MAX_ENQUEUE_ROUNDS; round += 1) {
    const inserted = await db<{ id: string }[]>`
      with stamp as (select clock_timestamp() as at)
      insert into jobs (kind, payload, idempotency_key, created_at, run_at, max_attempts)
      values (
        ${kind},
        ${payload}::text::jsonb,
        ${key},
        (select at from stamp),
        ${runAt === undefined ? db`(select at from stamp)` : db`${runAt}`},
        ${maxAttempts === undefined ? db`default` : db`${maxAttempts}`}
      )
      on conflict (idempotency_key) do nothing
      returning id
    `;
    const created = inserted[0];
    if (created) return { id: created.id, created: true };

    // Only reachable with a key: without one, nothing can conflict.
    const existing = await db<{ id: string }[]>`
      select id from jobs where idempotency_key = ${key}
    `;
    const found = existing[0];
    if (found) return { id: found.id, created: false };
    // The job that held the key was deleted between the two statements: insert again.
  }
  throw new JobEnqueueError(
    `could not enqueue job kind "${kind}": idempotency key "${String(key)}" conflicts with a job ` +
      "that cannot be read (deleted concurrently, or hidden by the caller's transaction snapshot)",
  );
}
