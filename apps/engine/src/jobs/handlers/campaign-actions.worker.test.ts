/**
 * The pause and resume jobs run by the real job worker, with the sale state service running
 * beside them, on the local chain and the real escrow: the sale state the public page shows only
 * ever moves from `paused_manual` to `open` once after a resume, and never says `open` while the
 * merchant's latest word is a pause.
 *
 * Every write of `campaigns.sale_state` is recorded by a trigger of the test database. To make the
 * worst timing certain rather than lucky, each handler is followed by one sale state pass before
 * the worker marks its job done: the moment at which a handler that wrote the state itself while
 * its job still counted as in flight made the page flap.
 */
import { randomUUID } from "node:crypto";

import pino from "pino";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { JOB_KINDS, jobIdempotencyKey, setPausedJobSchema } from "@winz/shared";

import { startSaleStates } from "../../sales";
import { enqueueJob } from "../enqueue";
import { JobWorker } from "../worker";
import { createSetPausedHandler } from "./campaign-actions";
import {
  SELLING_ASKS,
  SELLING_BIDS,
  recordSaleStates,
  saleBookSource,
  saleStateRunner,
} from "./campaign-actions.test-support";
import {
  createJobsHarness,
  createLiveCampaign,
  getCampaign,
  txRows,
  type JobsHarness,
  type LiveCampaign,
} from "./test-support";

const ONCHAIN_LIVE = 0;
const ONCHAIN_PAUSED = 1;

let harness: JobsHarness;
let log: Awaited<ReturnType<typeof recordSaleStates>>;
const stops: (() => Promise<void>)[] = [];

beforeAll(async () => {
  harness = await createJobsHarness();
  log = await recordSaleStates(harness);
});

afterAll(async () => {
  await harness?.close();
});

afterEach(async () => {
  while (stops.length > 0) await stops.pop()?.();
});

/** What POST /api/campaigns/:id/pause and /resume write: the sale state, then the job row. */
async function request(campaignId: string, paused: boolean): Promise<string> {
  const requestId = randomUUID();
  await harness.db.begin(async (tx) => {
    if (paused) {
      await tx`update campaigns set sale_state = 'paused_manual' where id = ${campaignId}`;
    }
    await enqueueJob(tx, {
      kind: JOB_KINDS.setPaused,
      payload: { campaignId, paused, requestId },
      idempotencyKey: jobIdempotencyKey.setPaused(requestId),
    });
  });
  return requestId;
}

/**
 * The real worker with the real set_paused handler, each run followed by a sale state pass on the
 * campaign's instrument before the worker ends the job; and the sale state service every 20 ms.
 */
function startEngine(campaign: LiveCampaign): void {
  harness.books.set(campaign.symbol, { asks: SELLING_ASKS, bids: SELLING_BIDS });
  const handler = createSetPausedHandler(harness.deps());
  const runner = saleStateRunner(harness);
  const worker = new JobWorker({
    db: harness.db,
    logger: harness.logger,
    config: {
      concurrency: 2,
      pollIntervalMs: 10,
      visibilityTimeoutMs: 30_000,
      workerId: `pause-worker-${randomUUID().slice(0, 8)}`,
      backoff: () => 20,
      shutdownGraceMs: 5_000,
    },
  });
  worker.register(JOB_KINDS.setPaused, setPausedJobSchema, async (payload, ctx) => {
    await handler(payload, ctx);
    await runner.runPass([campaign.symbol]);
  });
  const controller = new AbortController();
  const service = startSaleStates({
    db: harness.db,
    bookFeed: saleBookSource(harness),
    logger: pino({ level: "silent" }),
    clock: harness.clock.now,
    startupGraceMs: 0,
    signal: controller.signal,
    intervalMs: 20,
  });
  worker.start();
  stops.push(async () => {
    await worker.stop();
    controller.abort();
    await service.stopped;
  });
}

/** Waits until every set_paused job of the campaign is final and `check` holds. */
async function settle(campaign: LiveCampaign, check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const [open] = await harness.db<{ n: bigint }[]>`
      select count(*)::bigint as n from jobs
      where kind = ${JOB_KINDS.setPaused} and payload ->> 'campaignId' = ${campaign.campaignId}
        and status in ('queued', 'running')
    `;
    if (open?.n === 0n && (await check())) return;
    if (Date.now() > deadline) throw new Error("the pause jobs did not settle within 30 s");
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
}

async function saleState(campaignId: string): Promise<{ stored: string; live: string | null }> {
  const [row] = await harness.db<{ sale_state: string; live: string | null }[]>`
    select c.sale_state, l.sale_state as live
    from campaigns c left join live_campaigns l on l.slug = c.slug
    where c.id = ${campaignId}
  `;
  if (row === undefined) throw new Error(`no campaign ${campaignId}`);
  return { stored: row.sale_state, live: row.live };
}

async function onchainStatus(campaign: LiveCampaign): Promise<number> {
  return (await getCampaign(harness, campaign.onchainId)).status;
}

/** The sale states written since the `from`-th one (0-based), in order. */
async function statesSince(campaignId: string, from: number): Promise<string[]> {
  return (await log.states(campaignId)).slice(from);
}

describe("pause and resume under the real worker and the sale state service", () => {
  it("a resume that finds the chain live (its pause superseded) reopens once, without a flap", async () => {
    const campaign = await createLiveCampaign(harness, "no-flap");
    const before = (await log.states(campaign.campaignId)).length;
    // Back to back: the pause is superseded before it is sent, the resume finds the chain live.
    const pause = await request(campaign.campaignId, true);
    const resume = await request(campaign.campaignId, false);
    startEngine(campaign);
    await settle(campaign, async () => (await saleState(campaign.campaignId)).stored === "open");

    expect(await txRows(harness, `setPaused:${pause}`)).toHaveLength(0);
    expect(await txRows(harness, `setPaused:${resume}`)).toHaveLength(0);
    expect(await onchainStatus(campaign)).toBe(ONCHAIN_LIVE);
    // paused_manual from the pause request, then open once: never back to paused_manual.
    expect(await statesSince(campaign.campaignId, before)).toEqual(["paused_manual", "open"]);
    expect(await saleState(campaign.campaignId)).toEqual({ stored: "open", live: "open" });
  });

  it("a mined resume reopens once, after the pause it undoes is projected", async () => {
    const campaign = await createLiveCampaign(harness, "mined-resume");
    startEngine(campaign);
    const before = (await log.states(campaign.campaignId)).length;
    await request(campaign.campaignId, true);
    await settle(campaign, async () => (await onchainStatus(campaign)) === ONCHAIN_PAUSED);
    await request(campaign.campaignId, false);
    await settle(campaign, async () => (await saleState(campaign.campaignId)).stored === "open");

    expect(await onchainStatus(campaign)).toBe(ONCHAIN_LIVE);
    expect(await statesSince(campaign.campaignId, before)).toEqual(["paused_manual", "open"]);
    expect(await saleState(campaign.campaignId)).toEqual({ stored: "open", live: "open" });
  });

  it("pause, resume, and pause again at once: never open, and the chain ends paused", async () => {
    const campaign = await createLiveCampaign(harness, "pause-again");
    startEngine(campaign);
    const before = (await log.states(campaign.campaignId)).length;
    await request(campaign.campaignId, true);
    await settle(campaign, async () => (await onchainStatus(campaign)) === ONCHAIN_PAUSED);
    await request(campaign.campaignId, false);
    await request(campaign.campaignId, true);
    await settle(campaign, async () => (await onchainStatus(campaign)) === ONCHAIN_PAUSED);
    // A few passes of the service more: nothing reopens it.
    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    expect(await onchainStatus(campaign)).toBe(ONCHAIN_PAUSED);
    expect(await statesSince(campaign.campaignId, before)).toEqual(["paused_manual"]);
    expect(await saleState(campaign.campaignId)).toEqual({
      stored: "paused_manual",
      live: "paused_manual",
    });
  });

  it("resume, pause, resume at once after a pause: open once at the end, the chain ends live", async () => {
    const campaign = await createLiveCampaign(harness, "resume-pause-resume");
    startEngine(campaign);
    await request(campaign.campaignId, true);
    await settle(campaign, async () => (await onchainStatus(campaign)) === ONCHAIN_PAUSED);
    const before = (await log.states(campaign.campaignId)).length;
    await request(campaign.campaignId, false);
    await request(campaign.campaignId, true);
    await request(campaign.campaignId, false);
    await settle(campaign, async () => (await saleState(campaign.campaignId)).stored === "open");

    expect(await onchainStatus(campaign)).toBe(ONCHAIN_LIVE);
    expect(await statesSince(campaign.campaignId, before)).toEqual(["open"]);
    expect(await saleState(campaign.campaignId)).toEqual({ stored: "open", live: "open" });
  });
});
