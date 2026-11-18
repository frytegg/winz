import { randomUUID } from "node:crypto";

import { JOB_KINDS, jobIdempotencyKey } from "@winz/shared";
import type { TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isLatestRequest } from "../../../engine/src/jobs/handlers/campaign-actions";
import { loadManualPauseInput } from "../../../engine/src/sales/store";
import { createTestDatabase, type TestDatabase } from "../../../engine/src/testing/postgres";
import { latestPauseRequest, pauseCampaign, resumeCampaign } from "./campaign-writes";
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

/** A live campaign of Joe's, sales open for hours. */
async function liveCampaign(): Promise<string> {
  return insertCampaign(db, {
    merchantId: joe,
    instrument: SYMBOL,
    eventTicker: "EV",
    salesClose: minutesFrom(now, 595),
  });
}

/** The campaign's `campaign.set_paused` jobs with their stamp in microseconds, oldest first. */
async function stampsOf(campaignId: string): Promise<{ requestId: string; micros: bigint }[]> {
  const rows = await db<{ request_id: string; micros: bigint }[]>`
    select payload ->> 'requestId' as request_id,
           (extract(epoch from created_at) * 1000000)::bigint as micros
    from jobs
    where kind = ${JOB_KINDS.setPaused} and payload ->> 'campaignId' = ${campaignId}
    order by created_at, id
  `;
  return rows.map((row) => ({ requestId: row.request_id, micros: row.micros }));
}

/**
 * A client whose transactions begin and read `now()` at once (the moment Postgres fixes for the
 * whole transaction), then wait for `release` before doing the route's work: the route's request
 * begins before another one and takes the campaign's lock after it.
 */
function earlyTransactions(): { db: Db; began: Promise<Date>; release: () => void } {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let markBegan: (at: Date) => void = () => undefined;
  const began = new Promise<Date>((resolve) => {
    markBegan = resolve;
  });
  const begin = <T>(work: (tx: TransactionSql) => Promise<T>): Promise<T> =>
    db.begin(async (tx) => {
      const [row] = await tx<{ began: Date }[]>`select now() as began`;
      markBegan(row?.began ?? new Date(0));
      await gate;
      return work(tx);
    }) as Promise<T>;
  const early = new Proxy(db, {
    get(target, property, receiver): unknown {
      return property === "begin" ? begin : Reflect.get(target, property, receiver);
    },
  });
  return { db: early, began, release };
}

describe("the merchant's latest request is the one that took the campaign's lock last", () => {
  /**
   * Request B begins first and reads now(); request A then runs to its commit; B goes on, takes
   * the lock and enqueues. B is the merchant's last word: it must be the latest for the web
   * route, for the engine's handler (`isLatestRequest`) and for the pause rule (`pj`).
   */
  async function interleave(
    campaignId: string,
    first: Action,
    last: Action,
  ): Promise<{ first: string; last: string }> {
    const a = randomUUID();
    const b = randomUUID();
    const early = earlyTransactions();
    const lastRun = last === "pause" ? pauseCampaign : resumeCampaign;
    const firstRun = first === "pause" ? pauseCampaign : resumeCampaign;
    const pending = lastRun(early.db, joe, campaignId, now, b);
    const bBegan = await early.began;
    try {
      await firstRun(db, joe, campaignId, now, a);
    } finally {
      early.release();
    }
    await pending;
    // The interleaving really happened: A's transaction began after B's.
    const [aBegan] = await db<{ at: Date }[]>`
      select created_at as at from jobs where idempotency_key = ${jobIdempotencyKey.setPaused(a)}
    `;
    expect(aBegan?.at.getTime()).toBeGreaterThanOrEqual(bBegan.getTime());
    return { first: a, last: b };
  }

  async function expectLatest(
    campaignId: string,
    requestId: string,
    paused: boolean,
  ): Promise<void> {
    expect(await latestPauseRequest(db, campaignId)).toEqual({
      requestId,
      paused,
      status: "queued",
    });
    expect(await isLatestRequest(db, campaignId, requestId)).toBe(true);
    expect((await loadManualPauseInput(db, campaignId))?.latestPauseJob?.paused).toBe(paused);
  }

  it("a resume that commits first, then a pause that began before it: the pause is the latest", async () => {
    const id = await liveCampaign();
    await pauseCampaign(db, joe, id, now);
    await db`update jobs set status = 'done' where payload ->> 'campaignId' = ${id}`;
    await db`update campaigns set status = 'paused' where id = ${id}`;

    const { first, last } = await interleave(id, "resume", "pause");
    await expectLatest(id, last, true);
    expect(await isLatestRequest(db, id, first)).toBe(false);
    // The merchant's latest word is a pause: another pause is refused, a resume accepted.
    await expect(pauseCampaign(db, joe, id, now)).rejects.toThrow(/already paused/);
    expect((await stampsOf(id)).map((job) => job.requestId).slice(1)).toEqual([first, last]);
  });

  it("a pause that commits first, then a resume that began before it: the resume is the latest", async () => {
    const id = await liveCampaign();
    const { first, last } = await interleave(id, "pause", "resume");
    await expectLatest(id, last, false);
    expect(await isLatestRequest(db, id, first)).toBe(false);
    expect((await stampsOf(id)).map((job) => job.requestId)).toEqual([first, last]);
  });

  it("requests that commit one after the other get strictly increasing stamps, the last one latest", async () => {
    const id = await liveCampaign();
    const made: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const requestId = randomUUID();
      const action: Action = i % 2 === 0 ? "pause" : "resume";
      await call(action, id, requestId);
      made.push(requestId);
      expect((await latestPauseRequest(db, id))?.requestId).toBe(requestId);
    }
    const stamps = await stampsOf(id);
    expect(stamps.map((job) => job.requestId)).toEqual(made);
    for (let i = 1; i < stamps.length; i += 1) {
      expect((stamps[i]?.micros ?? 0n) > (stamps[i - 1]?.micros ?? 0n)).toBe(true);
    }
  });

  it("a stamp is strictly after the campaign's latest one, in the same millisecond or with the clock behind", async () => {
    const id = await liveCampaign();
    // A resume stamped an hour ahead on a whole millisecond (the clock then stepped back), done.
    const earlier = randomUUID();
    const [ahead] = await db<{ micros: bigint }[]>`
      insert into jobs (kind, payload, status, idempotency_key, created_at, run_at)
      values (${JOB_KINDS.setPaused},
              ${db.json({ campaignId: id, paused: false, requestId: earlier })},
              'done', ${jobIdempotencyKey.setPaused(earlier)},
              date_trunc('milliseconds', now() + interval '1 hour'),
              date_trunc('milliseconds', now() + interval '1 hour'))
      returning (extract(epoch from created_at) * 1000000)::bigint as micros
    `;
    if (ahead === undefined) throw new Error("job not inserted");
    const pause = randomUUID();
    const resume = randomUUID();
    await pauseCampaign(db, joe, id, now, pause);
    await resumeCampaign(db, joe, id, now, resume);
    // One microsecond apart, in the same millisecond: no tie for a random id to break.
    expect(await stampsOf(id)).toEqual([
      { requestId: earlier, micros: ahead.micros },
      { requestId: pause, micros: ahead.micros + 1n },
      { requestId: resume, micros: ahead.micros + 2n },
    ]);
    expect((await latestPauseRequest(db, id))?.requestId).toBe(resume);
    expect(await isLatestRequest(db, id, resume)).toBe(true);
    expect((await loadManualPauseInput(db, id))?.latestPauseJob?.paused).toBe(false);
  });
});

describe("a resume retried with another request id", () => {
  it("answers 200 while the first resume is queued, then 409 once it has landed: enqueued once", async () => {
    const id = await liveCampaign();
    await pauseCampaign(db, joe, id, now);
    await db`update jobs set status = 'done' where payload ->> 'campaignId' = ${id}`;
    await db`update campaigns set status = 'paused' where id = ${id}`;
    const first = randomUUID();
    const second = randomUUID();
    await resumeCampaign(db, joe, id, now, first);
    // A second resume while the first waits in the queue: answered, nothing recorded.
    expect(await resumeCampaign(db, joe, id, now, second)).toEqual({
      status: "paused",
      saleState: "paused_manual",
    });
    // The first resume lands: the engine sends it and projects it, the sale reopens.
    await db`update jobs set status = 'done' where payload ->> 'requestId' = ${first}`;
    await db`update campaigns set status = 'live', sale_state = 'open' where id = ${id}`;
    // The second request id again: nothing tells it from a new click on a live promo, so it is
    // refused as such (decided, see `resumeCampaign`).
    const again = await call("resume", id, second);
    expect(again).toBeInstanceOf(ApiRouteError);
    expect(again).toMatchObject({
      status: 409,
      code: "conflict",
      message: "This promo is not paused",
    });
    const jobs = await jobsOf(id);
    expect(jobs.map((job) => [job.paused, job.requestId === first])).toEqual([
      [true, false],
      [false, true],
    ]);
    const [recorded] = await db<{ n: bigint }[]>`
      select count(*)::bigint as n from jobs
      where idempotency_key = ${jobIdempotencyKey.setPaused(second)}
    `;
    expect(recorded?.n).toBe(0n);
  });
});
