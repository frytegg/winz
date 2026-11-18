/**
 * The wiring: `startJobs` runs a real `JobWorker` with a handler for each of the five kinds, which
 * takes the jobs the web app enqueues (same kinds, payloads and idempotency keys) and ends them
 * `done`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { JOB_KINDS, jobIdempotencyKey } from "@winz/shared";

import { waitFor } from "../../chain/ingest-test-support";
import { transientGatewayError } from "../../payments";
import { enqueueJob } from "../enqueue";
import { JobConfigError } from "../errors";
import { registerJobHandlers, startJobs, type JobsService } from "./register";
import {
  CONTRACT,
  createJobsHarness,
  createLiveCampaign,
  logsAt,
  seedFundedCampaign,
  seedInstrument,
  seedMerchant,
  seedPayment,
  type JobsHarness,
  type LiveCampaign,
} from "./test-support";

let harness: JobsHarness;

beforeAll(async () => {
  harness = await createJobsHarness();
});

afterAll(async () => {
  await harness?.close();
});

interface JobRow {
  status: string;
  last_error: string | null;
  attempts: number;
  max_attempts: number;
}

async function jobStatus(id: string): Promise<JobRow> {
  const [row] = await harness.db<JobRow[]>`
    select status, last_error, attempts, max_attempts from jobs where id = ${id}
  `;
  if (row === undefined) throw new Error(`no job ${id}`);
  return row;
}

/** Runs the engine's job worker for the duration of `fn`, then stops it. */
async function withJobs(fn: () => Promise<void>): Promise<void> {
  const stop = new AbortController();
  const service: JobsService = startJobs({
    ...harness.deps(),
    signal: stop.signal,
    worker: { pollIntervalMs: 20, visibilityTimeoutMs: 5_000, shutdownGraceMs: 2_000 },
  });
  try {
    await fn();
  } finally {
    stop.abort();
    await service.stopped;
  }
}

/** Enqueues the purchase of one unit as the web app does, and waits for the job to end. */
async function purchaseThroughQueue(
  live: LiveCampaign,
  maxAttempts?: number,
): Promise<{ pi: string; job: JobRow }> {
  const pi = await seedPayment(harness, {
    campaignId: live.campaignId,
    qty: 1,
    unitPrice: live.terms.unitPrice,
    email: `queued-${live.campaignId.slice(0, 8)}@example.com`,
  });
  await harness.clock.sync(harness.escrow);
  const { id } = await enqueueJob(harness.db, {
    kind: JOB_KINDS.purchase,
    payload: { paymentIntentId: pi },
    idempotencyKey: jobIdempotencyKey.purchase(pi),
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
  });
  await waitFor(
    async () => ["done", "dead"].includes((await jobStatus(id)).status),
    "purchase job to end",
    30_000,
  );
  return { pi, job: await jobStatus(id) };
}

async function paymentStatus(pi: string): Promise<string | undefined> {
  const [row] = await harness.db<{ status: string }[]>`
    select status from payments where stripe_pi = ${pi}
  `;
  return row?.status;
}

describe("startJobs", () => {
  it("registers the five kinds with their schemas", () => {
    const kinds: string[] = [];
    registerJobHandlers({ register: (kind: string) => void kinds.push(kind) }, harness.deps());
    expect(kinds.sort()).toEqual(Object.values(JOB_KINDS).sort());
  });

  it("creates a campaign and sells a ticket from enqueued jobs, then stops", async () => {
    const symbol = await seedInstrument(harness, "wired");
    const { merchantId } = await seedMerchant(harness, "Wired Bar");
    const { campaignId } = await seedFundedCampaign(harness, { merchantId, symbol });
    harness.books.set(symbol, { asks: [{ priceBps: 3_000n, qty: 500n * CONTRACT }] });

    const stop = new AbortController();
    const service = startJobs({
      ...harness.deps(),
      signal: stop.signal,
      worker: { pollIntervalMs: 20, visibilityTimeoutMs: 5_000, shutdownGraceMs: 2_000 },
    });
    try {
      await harness.clock.sync(harness.escrow);
      const create = await enqueueJob(harness.db, {
        kind: JOB_KINDS.createCampaign,
        payload: { campaignId },
        idempotencyKey: jobIdempotencyKey.createCampaign(campaignId),
      });
      await waitFor(async () => (await jobStatus(create.id)).status === "done", "creation job");

      const pi = await seedPayment(harness, {
        campaignId,
        qty: 1,
        unitPrice: 5_000_000n,
        email: "wired-fan@example.com",
      });
      await harness.clock.sync(harness.escrow);
      const buy = await enqueueJob(harness.db, {
        kind: JOB_KINDS.purchase,
        payload: { paymentIntentId: pi },
        idempotencyKey: jobIdempotencyKey.purchase(pi),
      });
      await waitFor(async () => (await jobStatus(buy.id)).status === "done", "purchase job");

      const [payment] = await harness.db<{ status: string }[]>`
        select status from payments where stripe_pi = ${pi}
      `;
      expect(payment?.status).toBe("ticketed");
      expect(harness.gateway.effectsOf(pi).captures).toBe(1);

      // A payload the schema refuses is set aside, its handler never called.
      const bad = await enqueueJob(harness.db, {
        kind: JOB_KINDS.closeSales,
        payload: { campaignId: "not-a-uuid" },
      });
      await waitFor(async () => (await jobStatus(bad.id)).status === "dead", "invalid job");
      expect((await jobStatus(bad.id)).last_error).toContain("InvalidJobPayloadError");
    } finally {
      stop.abort();
      await service.stopped;
    }
    const running = await harness.db`select 1 from jobs where status = 'running'`;
    expect(running).toHaveLength(0);
  });

  it("never lets a purchase die while its ticket is issued and the capture keeps failing", async () => {
    const live = await createLiveCampaign(harness, "outlast");
    harness.books.set(live.symbol, { asks: [{ priceBps: 3_000n, qty: 500n * CONTRACT }] });
    // The payment provider fails every capture for longer than the job's five planned attempts.
    harness.gateway.failNext("capture", transientGatewayError(), 8);
    try {
      await withJobs(async () => {
        const { pi, job } = await purchaseThroughQueue(live);
        expect(job.status).toBe("done");
        expect(job.attempts).toBeGreaterThan(5);
        expect(job.max_attempts).toBeGreaterThan(job.attempts);
        expect(await paymentStatus(pi)).toBe("ticketed");
        expect(harness.gateway.callsOf(pi, "capture")).toHaveLength(9);
        expect(harness.gateway.effectsOf(pi)).toEqual({ captures: 1, cancels: 0, refunds: 0 });
      });
    } finally {
      harness.gateway.clearFailures();
    }
    expect(logsAt(harness, 40, "job kept alive past its planned attempts")).not.toHaveLength(0);
  });

  it("keeps a purchase on its last attempt trying inside the run instead of dying", async () => {
    const live = await createLiveCampaign(harness, "last-attempt");
    harness.books.set(live.symbol, { asks: [{ priceBps: 3_000n, qty: 500n * CONTRACT }] });
    harness.gateway.failNext("capture", transientGatewayError(), 3);
    try {
      await withJobs(async () => {
        const { pi, job } = await purchaseThroughQueue(live, 1);
        expect(job.status).toBe("done");
        expect(job.attempts).toBe(1);
        expect(await paymentStatus(pi)).toBe("ticketed");
        expect(harness.gateway.effectsOf(pi)).toEqual({ captures: 1, cancels: 0, refunds: 0 });
      });
    } finally {
      harness.gateway.clearFailures();
    }
    expect(
      logsAt(harness, 50, "last attempt of a committed job and its work cannot finish yet"),
    ).not.toHaveLength(0);
  });

  it("refuses a worker concurrency that reaches the database pool size", () => {
    const stop = new AbortController();
    stop.abort();
    expect(() =>
      startJobs({
        ...harness.deps(),
        signal: stop.signal,
        worker: { concurrency: harness.db.options.max },
      }),
    ).toThrow(JobConfigError);
  });

  it("returns a stopped service at once when the signal is already aborted", async () => {
    const stop = new AbortController();
    stop.abort();
    const service = startJobs({ ...harness.deps(), signal: stop.signal });
    await expect(service.stopped).resolves.toBeUndefined();
  });
});
