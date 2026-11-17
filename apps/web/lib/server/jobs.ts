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

/**
 * Inserts a `queued` job, after validating its payload. A second call with the same idempotency
 * key inserts nothing and returns the job that holds the key (`on conflict do nothing`: two racing
 * calls end with one row, the unique constraint decides).
 */
export async function enqueueJob<K extends JobKind>(
  sql: JobSql,
  kind: K,
  payload: JobPayload<K>,
  idempotencyKey: string,
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
  // Sent as text and cast in SQL, as the engine does: a jsonb parameter would be encoded twice.
  const text = JSON.stringify(parsed.data);
  const inserted = await sql<{ id: string }[]>`
    insert into jobs (kind, payload, status, idempotency_key)
    values (${kind}, ${text}::text::jsonb, 'queued', ${idempotencyKey})
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
