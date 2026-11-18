import { randomUUID } from "node:crypto";

import { JOB_KINDS, jobIdempotencyKey } from "@winz/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../../engine/src/testing/postgres";
import { pauseCampaign, resumeCampaign } from "./campaign-writes";
import type { Db } from "./db";
import { ApiRouteError } from "./route";
import {
  insertCampaign,
  insertEvent,
  insertInstrument,
  insertMerchant,
  minutesFrom,
} from "./testing/fixtures";

/**
 * The merchant's pause and resume as decided on their LATEST request (SPEC CA-4, CA-5): every
 * sequence of two and three requests among pause and resume, with, before each request, the job
 * of the previous one as the worker leaves it (queued, running, done or dead) and the chain live
 * or paused. A pause is refused as "already paused" only when the merchant's latest request is a
 * pause (or there is none and the chain says paused); a resume is refused as "not paused" only
 * when their latest request and the chain both say live, and a resume already waiting in the
 * queue is not enqueued twice. The engine's side is played by hand: the projected status, the
 * job states, and the sale state the engine's pause rule writes for them.
 */

const now = new Date("2026-11-20T18:00:00.000Z");
const SYMBOL = "GEMI-NCAAF-ARK-TEX-S-TEX13";

type Action = "pause" | "resume";
type WorkerState = "queued" | "running" | "done" | "dead";
type Chain = "live" | "paused";

interface Gap {
  /** What the worker made of the latest job before the next request. */
  job: WorkerState;
  /** The campaign's projected status before the next request. */
  chain: Chain;
}

let database: TestDatabase;
let db: Db;
let joe: string;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  await insertEvent(db, {
    ticker: "EV",
    title: "Arkansas vs Texas",
    startsAt: minutesFrom(now, 600),
  });
  await insertInstrument(db, { symbol: SYMBOL, eventTicker: "EV", label: "Texas wins by 14+" });
  joe = (await insertMerchant(db, { email: "joe@example.com" })).merchantId;
});

afterAll(async () => {
  await database.drop();
});

interface JobRow {
  id: string;
  paused: boolean;
  status: string;
  requestId: string;
}

async function jobsOf(campaignId: string): Promise<JobRow[]> {
  const rows = await db<{ id: string; paused: boolean; status: string; request_id: string }[]>`
    select id, (payload ->> 'paused')::boolean as paused, status,
           payload ->> 'requestId' as request_id
    from jobs
    where kind = ${JOB_KINDS.setPaused} and payload ->> 'campaignId' = ${campaignId}
    order by created_at, id
  `;
  return rows.map((row) => ({
    id: row.id,
    paused: row.paused,
    status: row.status,
    requestId: row.request_id,
  }));
}

async function stored(campaignId: string): Promise<{ status: string; saleState: string }> {
  const [row] = await db<{ status: string; sale_state: string }[]>`
    select status, sale_state from campaigns where id = ${campaignId}
  `;
  if (!row) throw new Error("campaign vanished");
  return { status: row.status, saleState: row.sale_state };
}

/**
 * What the engine's pause rule makes of the jobs and the chain (apps/engine/src/sales): the sale
 * reopens only when the chain is live and the latest request is a resume the worker has finished
 * (or there is none); `paused_manual` otherwise.
 */
function engineSaleState(chain: Chain, latest: JobRow | undefined): string {
  if (latest === undefined) return chain === "live" ? "open" : "paused_manual";
  const finished = latest.status === "done" || latest.status === "dead";
  return chain === "live" && !latest.paused && finished ? "open" : "paused_manual";
}

/** Plays a gap: the latest job's state, the projected status, and the engine's sale state. */
async function applyGap(campaignId: string, gap: Gap): Promise<void> {
  const latest = (await jobsOf(campaignId)).at(-1);
  if (latest !== undefined) {
    await db`update jobs set status = ${gap.job} where id = ${latest.id}`;
    latest.status = gap.job;
  }
  await db`
    update campaigns set status = ${gap.chain}, sale_state = ${engineSaleState(gap.chain, latest)}
    where id = ${campaignId}
  `;
}

/** What the merchant's request must do, from the jobs and the chain before it. */
function expected(
  action: Action,
  jobs: readonly JobRow[],
  chain: Chain,
): "enqueued" | "already-queued" | "already paused" | "not paused" {
  const latest = jobs.at(-1);
  const intentPaused = latest === undefined ? chain === "paused" : latest.paused;
  if (action === "pause") return intentPaused ? "already paused" : "enqueued";
  if (latest !== undefined && !latest.paused && ["queued", "running"].includes(latest.status)) {
    return "already-queued";
  }
  return !intentPaused && chain === "live" ? "not paused" : "enqueued";
}

async function call(
  action: Action,
  campaignId: string,
  requestId: string,
): Promise<{ status: string; saleState: string } | ApiRouteError> {
  const run = action === "pause" ? pauseCampaign : resumeCampaign;
  try {
    return await run(db, joe, campaignId, now, requestId);
  } catch (error: unknown) {
    if (error instanceof ApiRouteError) return error;
    throw error;
  }
}

/**
 * Plays `actions` with `gaps` before each (the first gap sets the chain before the first request,
 * with no job yet) and checks every answer, the jobs enqueued and the stored state. Returns a
 * description of the first difference, or null.
 */
async function play(actions: readonly Action[], gaps: readonly Gap[]): Promise<string | null> {
  const campaignId = await insertCampaign(db, {
    merchantId: joe,
    instrument: SYMBOL,
    eventTicker: "EV",
    salesClose: minutesFrom(now, 595),
  });
  const label = actions
    .map((action, i) => `[job ${gaps[i]?.job ?? "-"}, chain ${gaps[i]?.chain ?? "-"}] ${action}`)
    .join(" → ");
  for (const [index, action] of actions.entries()) {
    const gap = gaps[index];
    if (gap === undefined) throw new Error("a gap per request");
    await applyGap(campaignId, gap);
    const before = await jobsOf(campaignId);
    const stateBefore = await stored(campaignId);
    const want = expected(action, before, gap.chain);
    const requestId = randomUUID();
    const answer = await call(action, campaignId, requestId);
    const after = await jobsOf(campaignId);
    const stateAfter = await stored(campaignId);
    const where = `request ${String(index + 1)} (${action}) of ${label}`;

    if (want === "already paused" || want === "not paused") {
      if (!(answer instanceof ApiRouteError)) return `accepted, expected ${want}: ${where}`;
      if (answer.status !== 409 || answer.code !== "conflict") {
        return `answered ${String(answer.status)} ${answer.code}: ${where}`;
      }
      const refusal = want === "already paused" ? /already paused/ : /not paused/;
      if (!refusal.test(answer.message)) return `refused with "${answer.message}": ${where}`;
      if (after.length !== before.length) return `a refused request enqueued: ${where}`;
      if (stateAfter.saleState !== stateBefore.saleState) return `a refusal wrote: ${where}`;
      continue;
    }
    if (answer instanceof ApiRouteError) return `refused (${answer.message}): ${where}`;
    if (answer.status !== gap.chain) return `answered status ${answer.status}: ${where}`;
    if (want === "already-queued") {
      if (after.length !== before.length) return `a second resume enqueued: ${where}`;
      if (stateAfter.saleState !== stateBefore.saleState) return `state changed: ${where}`;
      continue;
    }
    const job = after.at(-1);
    if (after.length !== before.length + 1 || job === undefined)
      return `nothing enqueued: ${where}`;
    if (job.paused !== (action === "pause") || job.requestId !== requestId) {
      return `enqueued ${JSON.stringify(job)}: ${where}`;
    }
    if (job.status !== "queued") return `enqueued as ${job.status}: ${where}`;
    if (action === "pause") {
      // A pause is in force at once and stays so while any resume is on its way.
      if (stateAfter.saleState !== "paused_manual" || answer.saleState !== "paused_manual") {
        return `pause left ${stateAfter.saleState}: ${where}`;
      }
    } else if (stateAfter.saleState !== stateBefore.saleState) {
      return `resume wrote the sale state: ${where}`;
    }
    // The same request again (a retried click): nothing more is enqueued, the state is answered.
    const again = await call(action, campaignId, requestId);
    if (again instanceof ApiRouteError) return `the same request again refused: ${where}`;
    if ((await jobsOf(campaignId)).length !== after.length) {
      return `the same request again enqueued: ${where}`;
    }
    if (again.saleState !== stateAfter.saleState) return `the same request again changed: ${where}`;
  }
  return null;
}

const ACTIONS: readonly Action[] = ["pause", "resume"];
const WORKER_STATES: readonly WorkerState[] = ["queued", "running", "done", "dead"];
const CHAINS: readonly Chain[] = ["live", "paused"];
const GAPS: readonly Gap[] = WORKER_STATES.flatMap((job) =>
  CHAINS.map((chain) => ({ job, chain })),
);

function sequences(length: number): Action[][] {
  if (length === 0) return [[]];
  return sequences(length - 1).flatMap((head) => ACTIONS.map((action) => [...head, action]));
}

/** Every list of `count` gaps, the first one only setting the chain (no job exists yet). */
function gapLists(count: number): Gap[][] {
  if (count === 0) return [[]];
  if (count === 1) return CHAINS.map((chain) => [{ job: "queued", chain }]);
  return gapLists(count - 1).flatMap((head) => GAPS.map((gap) => [...head, gap]));
}

describe("pause and resume decided on the merchant's latest request", () => {
  for (const actions of [...sequences(2), ...sequences(3)]) {
    it(`${actions.join(", ")}: every worker state and chain status`, async () => {
      const failures: string[] = [];
      for (const gaps of gapLists(actions.length)) {
        const failure = await play(actions, gaps);
        if (failure !== null) failures.push(failure);
      }
      expect(failures.slice(0, 5)).toEqual([]);
    }, 60_000);
  }
});

describe("the merchant can always pause again", () => {
  async function campaign(): Promise<string> {
    return insertCampaign(db, {
      merchantId: joe,
      instrument: SYMBOL,
      eventTicker: "EV",
      salesClose: minutesFrom(now, 595),
    });
  }

  it("paused on-chain, resumed by mistake: a pause before the resume lands is accepted and holds", async () => {
    const id = await campaign();
    await pauseCampaign(db, joe, id, now);
    // The engine put the pause on-chain and projected it.
    await db`update jobs set status = 'done' where payload ->> 'campaignId' = ${id}`;
    await db`update campaigns set status = 'paused' where id = ${id}`;
    expect(await resumeCampaign(db, joe, id, now)).toEqual({
      status: "paused",
      saleState: "paused_manual",
    });
    // The resume is queued (or running): the merchant pauses again at once.
    await db`
      update jobs set status = 'running'
      where payload ->> 'campaignId' = ${id} and (payload ->> 'paused')::boolean = false
    `;
    expect(await pauseCampaign(db, joe, id, now)).toEqual({
      status: "paused",
      saleState: "paused_manual",
    });
    expect((await jobsOf(id)).map((job) => job.paused)).toEqual([true, false, true]);
    expect(await stored(id)).toEqual({ status: "paused", saleState: "paused_manual" });
    // Now their latest word is a pause: a third pause is refused, a resume accepted.
    await expect(pauseCampaign(db, joe, id, now)).rejects.toThrow(/already paused/);
    await resumeCampaign(db, joe, id, now);
    expect((await jobsOf(id)).map((job) => job.paused)).toEqual([true, false, true, false]);
  });

  it("a resume while the pause is on its way is accepted and supersedes it", async () => {
    const id = await campaign();
    await pauseCampaign(db, joe, id, now);
    expect(await resumeCampaign(db, joe, id, now)).toEqual({
      status: "live",
      saleState: "paused_manual",
    });
    expect((await jobsOf(id)).map((job) => job.paused)).toEqual([true, false]);
  });

  it("the same request id twice enqueues once, for a pause and for a resume", async () => {
    const id = await campaign();
    const pause = randomUUID();
    await pauseCampaign(db, joe, id, now, pause);
    expect(await pauseCampaign(db, joe, id, now, pause)).toEqual({
      status: "live",
      saleState: "paused_manual",
    });
    const resume = randomUUID();
    await resumeCampaign(db, joe, id, now, resume);
    await db`update jobs set status = 'done' where payload ->> 'requestId' = ${resume}`;
    expect(await resumeCampaign(db, joe, id, now, resume)).toEqual({
      status: "live",
      saleState: "paused_manual",
    });
    expect((await jobsOf(id)).map((job) => job.requestId)).toEqual([pause, resume]);
    const [count] = await db<{ n: bigint }[]>`
      select count(*)::bigint as n from jobs
      where idempotency_key in (${jobIdempotencyKey.setPaused(pause)}, ${jobIdempotencyKey.setPaused(resume)})
    `;
    expect(count?.n).toBe(2n);
  });

  it("a request id already used for the other action or another campaign is refused", async () => {
    const id = await campaign();
    const other = await campaign();
    const requestId = randomUUID();
    await pauseCampaign(db, joe, id, now, requestId);
    await expect(resumeCampaign(db, joe, id, now, requestId)).rejects.toThrow(/already used/);
    await expect(pauseCampaign(db, joe, other, now, requestId)).rejects.toThrow(/already used/);
    expect(await jobsOf(other)).toEqual([]);
    expect(await stored(other)).toEqual({ status: "live", saleState: "open" });
  });

  it("keeps the other refusals: not live yet, sales closed", async () => {
    for (const status of ["funding", "draft"] as const) {
      const id = await insertCampaign(db, {
        merchantId: joe,
        instrument: SYMBOL,
        eventTicker: "EV",
        salesClose: minutesFrom(now, 595),
        status,
        saleState: "closed",
      });
      await expect(pauseCampaign(db, joe, id, now)).rejects.toThrow(/not live yet/);
      await expect(resumeCampaign(db, joe, id, now)).rejects.toThrow(/not live yet/);
    }
    const closed = await insertCampaign(db, {
      merchantId: joe,
      instrument: SYMBOL,
      eventTicker: "EV",
      salesClose: minutesFrom(now, -1),
      status: "paused",
      saleState: "paused_manual",
    });
    await expect(pauseCampaign(db, joe, closed, now)).rejects.toThrow(/already closed/);
    await expect(resumeCampaign(db, joe, closed, now)).rejects.toThrow(/already closed/);
    expect(await jobsOf(closed)).toEqual([]);
  });
});
