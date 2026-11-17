import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "../db";
import { createTestDatabase, type TestDatabase } from "../testing/postgres";
import { enqueueJob } from "./enqueue";
import { JobEnqueueError } from "./errors";

interface JobRow {
  id: string;
  kind: string;
  payload: unknown;
  status: string;
  attempts: number;
  max_attempts: number;
  run_at: Date;
  created_at: Date;
  idempotency_key: string | null;
}

class RollbackForTest extends Error {
  constructor() {
    super("rollback requested by the test");
    this.name = "RollbackForTest";
  }
}

describe("enqueueJob", () => {
  let database: TestDatabase;
  let db: Db;
  /** A wider pool than the test default (5), so 20 enqueues really run at the same time. */
  let widePool: Db;

  beforeAll(async () => {
    database = await createTestDatabase();
    db = database.db;
    widePool = createDb(database.url, { max: 20 });
  });
  afterAll(async () => {
    await widePool.end({ timeout: 5 });
    await database.drop();
  });
  beforeEach(async () => {
    await db`delete from jobs`;
  });

  async function allJobs(): Promise<JobRow[]> {
    return db<JobRow[]>`select * from jobs order by created_at`;
  }

  it("inserts a queued job with the payload stored as a JSON object", async () => {
    const result = await enqueueJob(db, {
      kind: "purchase",
      payload: { paymentIntent: "pi_1", qty: 2, nested: { amount: "20000000" } },
    });
    expect(result.created).toBe(true);

    const rows = await allJobs();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.id).toBe(result.id);
    expect(row?.kind).toBe("purchase");
    expect(row?.status).toBe("queued");
    expect(row?.attempts).toBe(0);
    expect(row?.max_attempts).toBe(5);
    expect(row?.idempotency_key).toBeNull();
    expect(row?.payload).toEqual({ paymentIntent: "pi_1", qty: 2, nested: { amount: "20000000" } });
    // Default run_at is "now" on the database clock.
    expect(row?.run_at.getTime()).toBe(row?.created_at.getTime());

    const [shape] = await db<{ type: string }[]>`select jsonb_typeof(payload) as type from jobs`;
    expect(shape?.type).toBe("object");
  });

  it("stores runAt and maxAttempts when given", async () => {
    const runAt = new Date("2030-01-02T03:04:05.000Z");
    await enqueueJob(db, { kind: "settle", payload: [1, 2], runAt, maxAttempts: 9 });
    const [row] = await allJobs();
    expect(row?.run_at.toISOString()).toBe(runAt.toISOString());
    expect(row?.max_attempts).toBe(9);
    expect(row?.payload).toEqual([1, 2]);
  });

  it("returns the existing job for a known idempotency key and leaves it untouched", async () => {
    const first = await enqueueJob(db, {
      kind: "purchase",
      payload: { from: "webhook" },
      idempotencyKey: "pi_123",
    });
    const second = await enqueueJob(db, {
      kind: "purchase",
      payload: { from: "client-confirmation" },
      idempotencyKey: "pi_123",
    });
    expect(first.created).toBe(true);
    expect(second).toEqual({ id: first.id, created: false });

    const rows = await allJobs();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toEqual({ from: "webhook" });
  });

  it("does not deduplicate jobs without a key, nor jobs with different keys", async () => {
    await enqueueJob(db, { kind: "purchase", payload: {} });
    await enqueueJob(db, { kind: "purchase", payload: {} });
    await enqueueJob(db, { kind: "purchase", payload: {}, idempotencyKey: "a" });
    await enqueueJob(db, { kind: "purchase", payload: {}, idempotencyKey: "b" });
    expect(await allJobs()).toHaveLength(4);
  });

  it("creates one row for 20 concurrent enqueues of the same key", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        enqueueJob(widePool, {
          kind: "purchase",
          payload: { caller: index },
          idempotencyKey: "pi_race",
        }),
      ),
    );
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.id)).size).toBe(1);

    const rows = await allJobs();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(results[0]?.id);
  });

  it("creates one row when the racing enqueues each run in their own transaction", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        widePool.begin(async (tx) => {
          const result = await enqueueJob(tx, {
            kind: "purchase",
            payload: { caller: index },
            idempotencyKey: "pi_tx_race",
          });
          // Hold the transaction open so the others really wait on the uncommitted row.
          await tx`select pg_sleep(0.02)`;
          return result;
        }),
      ),
    );
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    expect(await allJobs()).toHaveLength(1);
  });

  it("commits the job with the caller's transaction", async () => {
    const result = await db.begin(async (tx) => {
      const enqueued = await enqueueJob(tx, { kind: "create-campaign", payload: { budget: "1" } });
      // Not visible outside the transaction yet.
      const outside = await db<{ n: bigint }[]>`select count(*) as n from jobs`;
      expect(outside[0]?.n).toBe(0n);
      return enqueued;
    });
    const rows = await allJobs();
    expect(rows.map((row) => row.id)).toEqual([result.id]);
  });

  it("leaves no job when the caller's transaction rolls back", async () => {
    let enqueuedId: string | undefined;
    await expect(
      db.begin(async (tx) => {
        const enqueued = await enqueueJob(tx, {
          kind: "purchase",
          payload: {},
          idempotencyKey: "pi_rolled_back",
        });
        enqueuedId = enqueued.id;
        expect(enqueued.created).toBe(true);
        throw new RollbackForTest();
      }),
    ).rejects.toBeInstanceOf(RollbackForTest);

    expect(enqueuedId).toBeDefined();
    expect(await allJobs()).toHaveLength(0);

    // The key is free again: the rolled-back insert did not reserve it.
    const again = await enqueueJob(db, {
      kind: "purchase",
      payload: {},
      idempotencyKey: "pi_rolled_back",
    });
    expect(again.created).toBe(true);
    expect(again.id).not.toBe(enqueuedId);
  });

  it("refuses input it cannot store, before touching the database", async () => {
    await expect(enqueueJob(db, { kind: " ", payload: {} })).rejects.toBeInstanceOf(
      JobEnqueueError,
    );
    await expect(
      enqueueJob(db, { kind: "purchase", payload: { amount: 20_000_000n } }),
    ).rejects.toBeInstanceOf(JobEnqueueError);
    await expect(enqueueJob(db, { kind: "purchase", payload: undefined })).rejects.toBeInstanceOf(
      JobEnqueueError,
    );
    await expect(
      enqueueJob(db, { kind: "purchase", payload: {}, maxAttempts: 0 }),
    ).rejects.toBeInstanceOf(JobEnqueueError);
    await expect(
      enqueueJob(db, { kind: "purchase", payload: {}, idempotencyKey: "" }),
    ).rejects.toBeInstanceOf(JobEnqueueError);
    await expect(
      enqueueJob(db, { kind: "purchase", payload: {}, runAt: new Date("nope") }),
    ).rejects.toBeInstanceOf(JobEnqueueError);
    expect(await allJobs()).toHaveLength(0);
  });
});
