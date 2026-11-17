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
});
