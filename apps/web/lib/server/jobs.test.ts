import { JOB_KINDS, jobIdempotencyKey } from "@winz/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../../engine/src/testing/postgres";
import type { Db } from "./db";
import { JobPayloadError, enqueueJob, type JobPayload } from "./jobs";

const CAMPAIGN = "6f1c2b8e-3d4a-4f5b-9c6d-7e8f9a0b1c2d";

let database: TestDatabase;
let db: Db;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
});

afterAll(async () => {
  await database.drop();
});

async function jobsWithKey(
  key: string,
): Promise<{ kind: string; status: string; payload: unknown }[]> {
  return db<{ kind: string; status: string; payload: unknown }[]>`
    select kind, status, payload from jobs where idempotency_key = ${key}
  `;
}

describe("enqueueJob", () => {
  it("inserts a queued job with its payload as a JSON object", async () => {
    const key = jobIdempotencyKey.purchase("pi_a");
    const job = await enqueueJob(db, JOB_KINDS.purchase, { paymentIntentId: "pi_a" }, key);
    expect(job.created).toBe(true);
    expect(await jobsWithKey(key)).toEqual([
      { kind: "purchase", status: "queued", payload: { paymentIntentId: "pi_a" } },
    ]);
    const [typed] = await db<{ t: string }[]>`
      select jsonb_typeof(payload) as t from jobs where idempotency_key = ${key}
    `;
    expect(typed?.t).toBe("object");
  });

  it("returns the first job for a repeated key and inserts nothing", async () => {
    const key = jobIdempotencyKey.createCampaign(CAMPAIGN);
    const first = await enqueueJob(db, JOB_KINDS.createCampaign, { campaignId: CAMPAIGN }, key);
    const second = await enqueueJob(db, JOB_KINDS.createCampaign, { campaignId: CAMPAIGN }, key);
    expect(second).toEqual({ id: first.id, created: false });
    expect(await jobsWithKey(key)).toHaveLength(1);
  });

  it("gives one job to concurrent calls with the same key", async () => {
    const key = jobIdempotencyKey.purchase("pi_race");
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        enqueueJob(db, JOB_KINDS.purchase, { paymentIntentId: "pi_race" }, key),
      ),
    );
    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(await jobsWithKey(key)).toHaveLength(1);
  });

  it("refuses a payload that does not match its kind, before inserting", async () => {
    const key = "campaign.set_paused:bad";
    const bad = { campaignId: "not-a-uuid", paused: true } as unknown as JobPayload<
      typeof JOB_KINDS.setPaused
    >;
    await expect(enqueueJob(db, JOB_KINDS.setPaused, bad, key)).rejects.toBeInstanceOf(
      JobPayloadError,
    );
    await expect(
      enqueueJob(db, JOB_KINDS.purchase, { paymentIntentId: "pi_x" }, "  "),
    ).rejects.toBeInstanceOf(JobPayloadError);
    expect(await jobsWithKey(key)).toEqual([]);
  });

  it("commits and rolls back with the caller's transaction", async () => {
    const key = jobIdempotencyKey.closeSales(CAMPAIGN);
    await expect(
      db.begin(async (tx) => {
        await enqueueJob(tx, JOB_KINDS.closeSales, { campaignId: CAMPAIGN }, key);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await jobsWithKey(key)).toEqual([]);

    await db.begin(async (tx) => {
      await enqueueJob(tx, JOB_KINDS.closeSales, { campaignId: CAMPAIGN }, key);
    });
    expect(await jobsWithKey(key)).toHaveLength(1);
  });

  it("stamps the job with the clock read by the insert, not the start of the caller's transaction", async () => {
    const key = jobIdempotencyKey.closeSales("0b5c2a1e-9d8f-4a7b-8c6d-5e4f3a2b1c0d");
    const { began, row } = await db.begin(async (tx) => {
      const [start] = await tx<{ began: Date }[]>`select now() as began`;
      await tx`select pg_sleep(0.05)`;
      await enqueueJob(
        tx,
        JOB_KINDS.closeSales,
        { campaignId: "0b5c2a1e-9d8f-4a7b-8c6d-5e4f3a2b1c0d" },
        key,
      );
      const [job] = await tx<{ created_at: Date; same: boolean }[]>`
        select created_at, run_at = created_at as same from jobs where idempotency_key = ${key}
      `;
      return { began: start?.began, row: job };
    });
    if (began === undefined || row === undefined) throw new Error("nothing read");
    expect(row.created_at.getTime() - began.getTime()).toBeGreaterThanOrEqual(50);
    expect(row.same).toBe(true);
  });

  it("with sequenceBy, stamps strictly after the sequence's latest job; run_at stays on the clock", async () => {
    const campaignId = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
    const ahead = jobIdempotencyKey.setPaused("2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a");
    await db`
      insert into jobs (kind, payload, idempotency_key, created_at)
      values (${JOB_KINDS.setPaused},
              ${db.json({ campaignId, paused: true, requestId: "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a" })},
              ${ahead}, now() + interval '1 hour')
    `;
    // Another campaign's job, later still, is not in the sequence.
    await db`
      insert into jobs (kind, payload, idempotency_key, created_at)
      values (${JOB_KINDS.setPaused},
              ${db.json({ campaignId: CAMPAIGN, paused: true, requestId: "3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b" })},
              'other-campaign', now() + interval '2 hours')
    `;
    const requestId = "4f5a6b7c-8d9e-4f0a-9b2c-3d4e5f6a7b8c";
    const key = jobIdempotencyKey.setPaused(requestId);
    await enqueueJob(db, JOB_KINDS.setPaused, { campaignId, paused: false, requestId }, key, {
      sequenceBy: "campaignId",
    });
    const [row] = await db<{ gap: string; on_clock: boolean }[]>`
      select (j.created_at - a.created_at)::text as gap,
             j.run_at < a.created_at and j.run_at <= j.created_at as on_clock
      from jobs j, jobs a
      where j.idempotency_key = ${key} and a.idempotency_key = ${ahead}
    `;
    expect(row).toEqual({ gap: "00:00:00.000001", on_clock: true });
  });

  it("refuses a sequence field that is not a string, before inserting", async () => {
    const requestId = "5a6b7c8d-9e0f-4a1b-8c3d-4e5f6a7b8c9d";
    const key = jobIdempotencyKey.setPaused(requestId);
    await expect(
      enqueueJob(db, JOB_KINDS.setPaused, { campaignId: CAMPAIGN, paused: true, requestId }, key, {
        sequenceBy: "paused",
      }),
    ).rejects.toBeInstanceOf(JobPayloadError);
    expect(await jobsWithKey(key)).toEqual([]);
  });
});
