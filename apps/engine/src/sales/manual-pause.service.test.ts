import { randomUUID } from "node:crypto";

import pino from "pino";
import type { TransactionSql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { JOB_KINDS } from "@winz/shared";
import type { Book, SaleState } from "@winz/shared";

import { insertChainEvents } from "../chain/events";
import { projectChainEvent, type StoredChainEvent } from "../chain/projector";
import type { JsonObject } from "../chain/types";
import type { Db } from "../db";
import type { BookFeedListener } from "../market-data";
import { applyRequestedSaleState } from "../jobs/handlers/campaign-actions";
import { createTestDatabase, type TestDatabase } from "../testing/postgres";
import { isManuallyPaused } from "./manual-pause";
import {
  PauseModel,
  minedJobSteps,
  pauseResumeOrders,
  randomRequestOrder,
  requestOrders,
  stepName,
  type PauseStep,
} from "./pause-model";
import { SaleStateRunner, type SaleBookSource } from "./service";
import { loadCampaignSaleRows, loadManualPauseInput } from "./store";
import { JOE_TERMS, bookAt, seededRandom } from "./test-support";

/**
 * The manual pause against a real Postgres: the real `jobs` table moved through the worker's
 * states, `chain_txs` and `chain_events` written as the transaction sender writes a mined receipt
 * (one transaction, events unprojected), the events projected with the projector's own function
 * and `processed_at`, as `ChainProjector` does. The runner must never write `open` between a pause
 * request and the projection of the matching resume.
 */

const T0 = Date.parse("2026-11-17T20:00:00.500Z");
const STARTS_AT = T0 + 2 * 3_600_000;
const SYMBOL = "KXTEST-YES";
const silent = pino({ level: "silent" });
const ESCROW = `0x${"e5".repeat(20)}`;
const RELAYER = `0x${"12".repeat(20)}`;

/** A book source that always holds a fresh, good book at the clock's time. */
class FreshBooks implements SaleBookSource {
  constructor(private readonly clock: ManualClock) {}

  getBook(symbol: string): Book | null {
    return bookAt(1_200n, this.clock.nowMs, 1_000_000_000n, symbol);
  }

  isStale(): boolean {
    return false;
  }

  subscribe(_listener: BookFeedListener): () => void {
    return () => undefined;
  }
}

class ManualClock {
  constructor(public nowMs: number) {}
  readonly now = (): number => this.nowMs;
}

let database: TestDatabase;
let db: Db;
let merchantId: string;
let counter = 0;

interface Campaign {
  id: string;
  slug: string;
  onchainId: string;
}

async function seedCampaign(): Promise<Campaign> {
  counter += 1;
  const slug = `promo-${counter.toString()}`;
  const onchainId = counter.toString();
  const [row] = await db<{ id: string }[]>`
    insert into campaigns (merchant_id, instrument, event_ticker, product, condition_label, promise,
                           unit_price, refund_bps, usual_margin_bps, min_margin_bps,
                           pause_threshold_bps, budget, sales_close, status, sale_state, slug,
                           onchain_id)
    values (${merchantId}, ${SYMBOL}, 'KXTEST', 'Pizza', 'Texas wins', 'Pizza refunded',
            ${JOE_TERMS.unitPrice.toString()}::bigint, ${Number(JOE_TERMS.refundBps)},
            ${Number(JOE_TERMS.usualMarginBps)}, ${Number(JOE_TERMS.minMarginBps)},
            ${Number(JOE_TERMS.pauseThresholdBps)}, 1000000000,
            ${new Date(STARTS_AT - 5 * 60_000)}, 'live', 'open', ${slug}, ${onchainId}::bigint)
    returning id::text as id
  `;
  if (row === undefined) throw new Error("campaign not inserted");
  await db`insert into live_campaigns (slug, sale_state) values (${slug}, 'open')`;
  return { id: row.id, slug, onchainId };
}

async function stored(id: string): Promise<{ sale: string; status: string; live: string | null }> {
  const [row] = await db<{ sale_state: string; status: string; live: string | null }[]>`
    select c.sale_state, c.status, lc.sale_state as live
    from campaigns c left join live_campaigns lc on lc.slug = c.slug
    where c.id = ${id}
  `;
  if (row === undefined) throw new Error(`campaign ${id} not found`);
  return { sale: row.sale_state, status: row.status, live: row.live };
}

/**
 * One campaign's pause and resume jobs, played as the web API, the job worker, the transaction
 * sender and the projector play them. The handler's own sale state writes are the real ones
 * (`applyRequestedSaleState`), made where the handler makes them: with the projection of its
 * receipt, or when it finds nothing to send, the campaign row locked.
 */
class Actors {
  /** Job name in the scenario → its row id and request id. */
  private readonly jobs = new Map<string, { jobId: string; requestId: string; paused: boolean }>();
  private readonly txHashes = new Map<string, string>();

  constructor(private readonly campaign: Campaign) {}

  private job(name: string): { jobId: string; requestId: string; paused: boolean } {
    const job = this.jobs.get(name);
    if (job === undefined) throw new Error(`job ${name} was never requested`);
    return job;
  }

  /** The web API: a pause writes paused_manual at once and enqueues; a resume only enqueues. */
  async request(name: string, at: Date): Promise<void> {
    const paused = name.startsWith("pause");
    const requestId = randomUUID();
    const [row] = await db.begin(async (tx) => {
      if (paused) {
        await tx`update campaigns set sale_state = 'paused_manual' where id = ${this.campaign.id}`;
      }
      return tx<{ id: string }[]>`
        insert into jobs (kind, payload, idempotency_key, created_at, run_at)
        values (${JOB_KINDS.setPaused},
                ${db.json({ campaignId: this.campaign.id, paused, requestId })},
                ${`${JOB_KINDS.setPaused}:${requestId}`}, ${at}, ${at})
        returning id::text as id
      `;
    });
    if (row === undefined) throw new Error("job not inserted");
    this.jobs.set(name, { jobId: row.id, requestId, paused });
  }

  /** The worker claims the job. */
  async claim(name: string): Promise<void> {
    await db`
      update jobs
      set status = 'running', attempts = attempts + 1, locked_at = now(), locked_by = 'test-worker'
      where id = ${this.job(name).jobId} and status = 'queued'
    `;
  }

  /** The attempt failed: back to the queue with a later run_at, as the worker does. */
  async retry(name: string): Promise<void> {
    await db`
      update jobs
      set status = 'queued', run_at = now() + interval '30 seconds',
          last_error = 'RetryLaterError: node down', locked_at = null, locked_by = null
      where id = ${this.job(name).jobId} and status = 'running'
    `;
  }

  async dead(name: string): Promise<void> {
    await db`
      update jobs set status = 'dead', last_error = 'PermanentJobError: gave up',
                      locked_at = null, locked_by = null
      where id = ${this.job(name).jobId}
    `;
  }

  /** What the handler writes once the chain matches the request, then the public row. */
  private async handlerWrites(tx: TransactionSql, name: string): Promise<void> {
    const job = this.job(name);
    await applyRequestedSaleState(tx, this.campaign.id, job.requestId, job.paused);
    await tx`
      update live_campaigns lc set sale_state = c.sale_state
      from campaigns c
      where c.id = ${this.campaign.id} and lc.slug = c.slug
        and lc.sale_state is distinct from c.sale_state
    `;
  }

  /** The handler found nothing to send (superseded, or the chain already as asked), then done. */
  async nothingSent(name: string): Promise<void> {
    await db.begin(async (tx) => {
      await tx`select id from campaigns where id = ${this.campaign.id} for update`;
      await this.handlerWrites(tx, name);
    });
    await this.done(name);
  }

  /** The handler ends the job done (after projecting, or with nothing to send). */
  async done(name: string): Promise<void> {
    await db`
      update jobs set status = 'done', locked_at = null, locked_by = null
      where id = ${this.job(name).jobId}
    `;
  }

  /**
   * The transaction is mined: the sender marks it mined and stores the receipt's events in one
   * database transaction (`TxStore.finalize`), unprojected.
   */
  async mine(name: string, at: Date): Promise<void> {
    const job = this.job(name);
    counter += 1;
    const txHash = `0x${counter.toString(16).padStart(64, "0")}`;
    this.txHashes.set(name, txHash);
    await db.begin(async (tx) => {
      await tx`
        insert into chain_txs (idempotency_key, signer, kind, to_address, data, payload, nonce,
                               signer_address, chain_id, tx_hash, status, attempts,
                               block_number, sent_at, mined_at)
        values (${`setPaused:${job.requestId}`}, 'relayer', 'setPaused', ${ESCROW}, '0x',
                ${db.json({ campaignId: this.campaign.id, paused: job.paused, requestId: job.requestId })},
                ${counter}, ${RELAYER}, 31337, ${txHash}, 'mined', 1, ${counter}, ${at}, ${at})
      `;
      const args: JsonObject = { id: this.campaign.onchainId, paused: job.paused };
      await insertChainEvents(
        tx,
        [
          {
            name: "CampaignPaused",
            args,
            txHash: txHash as `0x${string}`,
            logIndex: 0,
            blockNumber: BigInt(counter),
          },
        ],
        new Date(Math.floor(at.getTime() / 1000) * 1000),
      );
    });
  }

  /**
   * The handler projects the event (the projector's function and processed_at) and writes its
   * sale state in the same transaction, then the job ends done (unless `finish` is false: the
   * worker has not marked it yet).
   */
  async project(name: string, finish = true): Promise<void> {
    const txHash = this.txHashes.get(name);
    if (txHash === undefined) throw new Error(`${name} was never mined`);
    await db.begin(async (tx) => {
      await tx`select id from campaigns where id = ${this.campaign.id} for update`;
      const [row] = await tx<
        {
          tx_hash: string;
          log_index: number;
          block_number: bigint;
          block_time: Date | null;
          name: string;
          args: JsonObject;
          created_at: Date;
        }[]
      >`
        select tx_hash, log_index, block_number, block_time, name, args, created_at
        from chain_events where tx_hash = ${txHash} and processed_at is null
        for update
      `;
      if (row === undefined) throw new Error(`${name}: nothing to project`);
      const event: StoredChainEvent = {
        txHash: row.tx_hash as `0x${string}`,
        logIndex: row.log_index,
        blockNumber: BigInt(row.block_number),
        blockTime: row.block_time,
        name: row.name,
        args: row.args,
        createdAt: row.created_at,
      };
      const outcome = await projectChainEvent(tx, event);
      if (outcome.status !== "applied") throw new Error(`${name}: projection ${outcome.status}`);
      await tx`update chain_events set processed_at = now() where tx_hash = ${txHash}`;
      await this.handlerWrites(tx, name);
    });
    if (finish) await this.done(name);
  }

  async play(step: PauseStep, at: Date): Promise<void> {
    switch (step.phase) {
      case "requested":
        return this.request(step.job, at);
      case "running":
        return this.claim(step.job);
      case "retry":
        return this.retry(step.job);
      case "dead":
        return this.dead(step.job);
      case "nothing-sent":
        return this.nothingSent(step.job);
      case "mined":
        return this.mine(step.job, at);
      case "projected":
        return this.project(step.job);
    }
  }
}

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  await db`
    insert into events (ticker, title, sport, league, home_name, home_abbreviation,
                        away_name, away_abbreviation, starts_at, sales_close_at)
    values ('KXTEST', 'Texas at Arkansas', 'football', 'NCAAF', 'Arkansas', 'ARK', 'Texas', 'TEX',
            ${new Date(STARTS_AT)}, ${new Date(STARTS_AT - 5 * 60_000)})
  `;
  await db`
    insert into instruments (symbol, event_ticker, label, type, onchain_id)
    values (${SYMBOL}, 'KXTEST', ${SYMBOL}, 'moneyline',
            ${`0x${Buffer.from(SYMBOL).toString("hex").padEnd(64, "0")}`})
  `;
  const [user] = await db<{ id: string }[]>`
    insert into users (email) values ('joe@example.com') returning id::text as id
  `;
  const [merchant] = await db<{ id: string }[]>`
    insert into merchants (user_id, name, category) values (${user?.id ?? ""}, 'Joe''s Pizza', 'pizza')
    returning id::text as id
  `;
  merchantId = merchant?.id ?? "";
});

afterAll(async () => {
  await database.drop();
});

async function clearCampaigns(): Promise<void> {
  await db`delete from live_campaigns`;
  await db`delete from jobs`;
  await db`delete from chain_events`;
  await db`delete from chain_txs`;
  await db`delete from campaigns`;
}

beforeEach(clearCampaigns);

/** A runner on a manual clock with a good book always there, and one campaign. */
async function setup(): Promise<{
  campaign: Campaign;
  actors: Actors;
  clock: ManualClock;
  /** Advances the clock by a second, runs a pass, and returns the stored states. */
  pass: () => Promise<{ sale: string; status: string; live: string | null }>;
}> {
  const clock = new ManualClock(T0);
  const campaign = await seedCampaign();
  const runner = new SaleStateRunner({
    db,
    bookFeed: new FreshBooks(clock),
    logger: silent,
    clock: clock.now,
  });
  return {
    campaign,
    actors: new Actors(campaign),
    clock,
    pass: async () => {
      clock.nowMs += 1_000;
      await runner.runPass();
      return stored(campaign.id);
    },
  };
}

/** Plays `steps` one second apart with a pass after each; returns the sale states seen. */
async function playWithPasses(
  steps: readonly PauseStep[],
): Promise<{ step: string; sale: string; live: string | null; status: string }[]> {
  const { actors, clock, pass } = await setup();
  expect((await pass()).sale).toBe("open");
  const seen: { step: string; sale: string; live: string | null; status: string }[] = [];
  for (const step of steps) {
    await actors.play(step, new Date(clock.nowMs));
    seen.push({ step: stepName(step), ...(await pass()) });
  }
  return seen;
}

/** Paused_manual (stored and public) after every step but the last, open after it. */
function expectPausedUntilLast(
  seen: readonly { step: string; sale: string; live: string | null; status: string }[],
): void {
  const order = seen.map((entry) => entry.step).join(" → ");
  seen.forEach((entry, index) => {
    const expected: SaleState = index === seen.length - 1 ? "open" : "paused_manual";
    expect({ sale: entry.sale, live: entry.live }, `after ${entry.step} in ${order}`).toEqual({
      sale: expected,
      live: expected,
    });
  });
}

const step = (job: string, phase: PauseStep["phase"]): PauseStep => ({ job, phase });

describe("manual pause against Postgres", () => {
  it("resume requested after the pause is mined and stored, before it is projected (the case CI hit)", async () => {
    const seen = await playWithPasses([
      step("pause", "requested"),
      step("pause", "running"),
      step("pause", "mined"),
      step("resume", "requested"),
      step("pause", "projected"),
      step("resume", "running"),
      step("resume", "mined"),
      step("resume", "projected"),
    ]);
    expectPausedUntilLast(seen);
    // The pause was on-chain and projected meanwhile, and the resume ended it.
    expect(seen.find((entry) => entry.step === "pause:projected")?.status).toBe("paused");
    expect(seen[seen.length - 1]?.status).toBe("live");
  });

  it("pause and resume both requested before either is mined", async () => {
    expectPausedUntilLast(
      await playWithPasses([
        step("pause", "requested"),
        step("resume", "requested"),
        step("pause", "running"),
        step("pause", "mined"),
        step("pause", "projected"),
        step("resume", "running"),
        step("resume", "mined"),
        step("resume", "projected"),
      ]),
    );
  });

  it("pause and resume both requested before the pause runs: superseded, nothing mined", async () => {
    expectPausedUntilLast(
      await playWithPasses([
        step("pause", "requested"),
        step("resume", "requested"),
        step("pause", "running"),
        step("pause", "nothing-sent"),
        step("resume", "running"),
        step("resume", "nothing-sent"),
      ]),
    );
  });

  it("never writes open before the resume is projected, in every order of the eight steps", async () => {
    const orders = pauseResumeOrders(minedJobSteps("pause"), minedJobSteps("resume"));
    expect(orders.length).toBeGreaterThan(20);
    for (const order of orders) {
      expectPausedUntilLast(await playWithPasses(order));
      await clearCampaigns();
    }
  }, 120_000);

  it("a pause retried after a transient failure holds; a resume retried leaves only once projected", async () => {
    const seen = await playWithPasses([
      step("pause", "requested"),
      step("pause", "running"),
      step("pause", "retry"),
      step("pause", "running"),
      step("pause", "mined"),
      step("pause", "projected"),
      step("resume", "requested"),
      step("resume", "running"),
      step("resume", "retry"),
      step("resume", "running"),
      step("resume", "mined"),
      step("resume", "projected"),
    ]);
    expectPausedUntilLast(seen);
  });

  it("a dead pause keeps the pause until the merchant resumes", async () => {
    const seen = await playWithPasses([
      step("pause", "requested"),
      step("pause", "running"),
      step("pause", "dead"),
      step("resume", "requested"),
      step("resume", "running"),
      step("resume", "nothing-sent"),
    ]);
    expectPausedUntilLast(seen);
    expect(seen.every((entry) => entry.status === "live")).toBe(true);
  });

  it("a dead resume keeps the campaign paused on-chain and paused_manual, until a new resume lands", async () => {
    const seen = await playWithPasses([
      ...minedJobSteps("pause"),
      step("resume", "requested"),
      step("resume", "running"),
      // Nothing is in flight any more: still paused, on-chain and on the page.
      step("resume", "dead"),
      ...minedJobSteps("resume2"),
    ]);
    expectPausedUntilLast(seen);
    expect(seen.find((entry) => entry.step === "resume:dead")?.status).toBe("paused");
  });

  it("a pause requested in the second an earlier pause was mined, whose job dies, keeps the pause", async () => {
    const { actors, campaign, clock, pass } = await setup();
    expect((await pass()).sale).toBe("open");
    // Every step in one block second s: an earlier pause mined and projected, a resume landed,
    // then a new pause requested and its job dead (no transaction of its own reached the chain).
    const second = Math.floor(clock.nowMs / 1000) * 1000 + 1_000;
    const steps: PauseStep[] = [
      ...minedJobSteps("pause"),
      ...minedJobSteps("resume"),
      step("pause2", "requested"),
      step("pause2", "running"),
      step("pause2", "dead"),
    ];
    for (const [index, s] of steps.entries()) {
      await actors.play(s, new Date(second + index * 50));
    }
    // The merchant's latest word is a pause the chain never showed: the sale stays paused.
    expect(await loadManualPauseInput(db, campaign.id)).toEqual({
      status: "live",
      pauseJobInFlight: false,
      pauseEventUnprojected: false,
      latestPauseJob: { paused: true, pauseProjected: false },
    });
    expect(await pass()).toEqual({ sale: "paused_manual", live: "paused_manual", status: "live" });
    expect(await pass()).toEqual({ sale: "paused_manual", live: "paused_manual", status: "live" });
  });

  it("only the request's own pause counts as seen on-chain", async () => {
    const { actors, campaign, clock } = await setup();
    // Each step a second later: this helper stamps the jobs itself, with the time given.
    const tick = (): Date => {
      clock.nowMs += 1_000;
      return new Date(clock.nowMs);
    };
    for (const s of minedJobSteps("pause")) await actors.play(s, tick());
    expect((await loadManualPauseInput(db, campaign.id))?.latestPauseJob).toEqual({
      paused: true,
      pauseProjected: true,
    });
    // Another campaign's pause, and this campaign's resume, are not this request's pause.
    for (const s of minedJobSteps("resume")) await actors.play(s, tick());
    expect((await loadManualPauseInput(db, campaign.id))?.latestPauseJob).toEqual({
      paused: false,
      pauseProjected: false,
    });
    const other = new Actors(await seedCampaign());
    for (const s of minedJobSteps("pause")) await other.play(s, tick());
    await actors.request("pause2", tick());
    expect((await loadManualPauseInput(db, campaign.id))?.latestPauseJob).toEqual({
      paused: true,
      pauseProjected: false,
    });
    // Mined, not projected: not seen yet (and paused by c).
    await actors.claim("pause2");
    await actors.mine("pause2", tick());
    expect(await loadManualPauseInput(db, campaign.id)).toMatchObject({
      pauseEventUnprojected: true,
      latestPauseJob: { paused: true, pauseProjected: false },
    });
    await actors.project("pause2");
    expect((await loadManualPauseInput(db, campaign.id))?.latestPauseJob).toEqual({
      paused: true,
      pauseProjected: true,
    });
  });

  it("a pause that found the chain already paused holds while it is, and ends with the merchant's next resume", async () => {
    const seen = await playWithPasses([
      ...minedJobSteps("pause"),
      step("resume", "requested"),
      step("pause2", "requested"),
      step("resume", "running"),
      step("resume", "nothing-sent"),
      step("pause2", "running"),
      // The chain is paused: nothing to send.
      step("pause2", "nothing-sent"),
      ...minedJobSteps("resume2"),
    ]);
    expectPausedUntilLast(seen);
    expect(seen.find((entry) => entry.step === "pause2:nothing-sent")?.status).toBe("paused");
    expect(seen[seen.length - 1]?.status).toBe("live");
  });

  it("one campaign's unfinished job or unprojected event does not pause another", async () => {
    const clock = new ManualClock(T0);
    const runner = new SaleStateRunner({
      db,
      bookFeed: new FreshBooks(clock),
      logger: silent,
      clock: clock.now,
    });
    // Several campaigns on the same instrument, with neighbouring on-chain ids.
    const campaigns: Campaign[] = [];
    for (let i = 0; i < 11; i += 1) campaigns.push(await seedCampaign());
    const [paused, ...others] = campaigns;
    if (paused === undefined) throw new Error("no campaign");
    const actors = new Actors(paused);
    const passAndCheck = async (pausedState: SaleState = "paused_manual"): Promise<void> => {
      clock.nowMs += 1_000;
      await runner.runPass();
      expect((await stored(paused.id)).sale).toBe(pausedState);
      for (const other of others) {
        expect(await stored(other.id), `campaign ${other.onchainId}`).toMatchObject({
          sale: "open",
          live: "open",
        });
      }
    };
    await passAndCheck("open");
    await actors.request("pause", new Date(clock.nowMs));
    await passAndCheck();
    await actors.claim("pause");
    await passAndCheck();
    await actors.mine("pause", new Date(clock.nowMs));
    await passAndCheck();
    await actors.request("resume", new Date(clock.nowMs));
    await passAndCheck();
    await actors.project("pause");
    await actors.claim("resume");
    await actors.mine("resume", new Date(clock.nowMs));
    await passAndCheck();
    await actors.project("resume");
    clock.nowMs += 1_000;
    await runner.runPass();
    for (const campaign of campaigns) {
      expect((await stored(campaign.id)).sale).toBe("open");
    }
  });
});

/**
 * Plays `steps` (the merchant's requests and the system's steps, see `requestOrders`) on a new
 * campaign with a pass after each, and the same steps on the model, which says what the chain
 * holds and whether the merchant's latest request has landed. Returns the first broken promise:
 *
 * - the sale state, stored and public, is `paused_manual` (after the handler's writes and after
 *   the pass) unless the chain is live AND the latest request is a resume whose job has ended;
 * - once it left `paused_manual`, it does not come back without a new request (no flap);
 * - at the end every job has ended, the projected status is the chain's, which is the latest
 *   request's, and the sale state is `paused_manual` after a pause, `open` after a resume.
 *
 * Jobs may die (`dead`): a latest resume that died with the chain live counts as ended, and at the
 * end a dead latest job leaves `paused_manual` if it asked a pause or the chain is paused, `open`
 * otherwise. With `stepMs`, the steps are stamped `stepMs` apart from the start of a block second
 * (the passes still run a second apart): with 50, twenty steps share one block second.
 */
async function brokenPromise(steps: readonly PauseStep[], stepMs?: number): Promise<string | null> {
  const { actors, clock, pass, campaign } = await setup();
  if ((await pass()).sale !== "open") return "the campaign does not start open";
  const model = new PauseModel();
  const name = steps.map(stepName).join(" → ");
  const base = Math.floor(clock.nowMs / 1000) * 1000 + 1_000;
  let reopened = false;
  for (const [index, step] of steps.entries()) {
    const at = stepMs === undefined ? clock.nowMs : base + index * stepMs;
    await actors.play(step, new Date(at));
    model.apply(step, at);
    const latest = model.latest();
    const landed = !model.chainPaused() && latest !== null && !latest.paused;
    const finished = landed && (latest.status === "done" || latest.status === "dead");
    // Right after a step, the public row is the one the step leaves: the web API's pause writes
    // only `campaigns.sale_state`, which the next pass copies (see `writeSaleState`).
    const afterStep = await stored(campaign.id);
    for (const [moment, seen] of [
      ["after the step", { ...afterStep, live: afterStep.sale }],
      ["after the pass", await pass()],
    ] as const) {
      const where = `${moment} ${stepName(step)} (step ${String(index + 1)}) in ${name}`;
      const open = seen.sale !== "paused_manual" || seen.live !== "paused_manual";
      if (open && !finished) return `${seen.sale}/${String(seen.live)} ${where}`;
      if (step.phase === "requested") reopened = false;
      else if (reopened && !open) return `paused_manual again ${where}`;
      if (open) reopened = true;
    }
  }
  const latest = model.latest();
  if (latest === null) return `no request in ${name}`;
  const unfinished = model
    .jobsView()
    .filter((job) => job.status !== "done" && job.status !== "dead");
  if (unfinished.length > 0) return `stuck: ${unfinished.map((job) => job.job).join(", ")}`;
  const end = await stored(campaign.id);
  const chainPaused = model.chainPaused();
  const pausedEnd = latest.status === "dead" ? latest.paused || chainPaused : latest.paused;
  const expected = {
    sale: pausedEnd ? "paused_manual" : "open",
    live: pausedEnd ? "paused_manual" : "open",
    status: chainPaused ? "paused" : "live",
  };
  if (latest.status === "done" && chainPaused !== latest.paused) {
    return `the chain ends against ${latest.job}`;
  }
  if (end.sale !== expected.sale || end.live !== expected.live || end.status !== expected.status) {
    return `ends ${JSON.stringify(end)} instead of ${JSON.stringify(expected)} in ${name}`;
  }
  return null;
}

/** `count` orders of `orders`, drawn without replacement with a seeded generator. */
function sample<T>(orders: readonly T[], count: number, seed: number): T[] {
  const random = seededRandom(seed);
  const pool = [...orders];
  const picked: T[] = [];
  while (picked.length < count && pool.length > 0) {
    const [order] = pool.splice(Math.floor(random() * pool.length), 1);
    if (order !== undefined) picked.push(order);
  }
  return picked;
}

async function expectEveryOrderHolds(
  orders: readonly PauseStep[][],
  stepMs?: number,
): Promise<void> {
  for (const order of orders) {
    expect(await brokenPromise(order, stepMs)).toBeNull();
    await clearCampaigns();
  }
}

const req = (job: string): PauseStep => ({ job, phase: "requested" });

describe("manual pause against Postgres: any number of requests", () => {
  it("pause, wait for it on-chain, resume, pause again at once (before the resume is claimed)", async () => {
    await expectEveryOrderHolds([
      [
        ...minedJobSteps("pause"),
        req("resume"),
        req("pause2"),
        step("resume", "running"),
        step("resume", "nothing-sent"),
        step("pause2", "running"),
        step("pause2", "nothing-sent"),
      ],
    ]);
  });

  it("pause, resume mined, pause again before the resume is projected", async () => {
    await expectEveryOrderHolds([
      [
        ...minedJobSteps("pause"),
        req("resume"),
        step("resume", "running"),
        step("resume", "mined"),
        req("pause2"),
        step("pause2", "running"),
        step("resume", "projected"),
        step("pause2", "mined"),
        step("pause2", "projected"),
      ],
    ]);
  });

  it("pause, resume, pause again: a sample of every order (seeded)", async () => {
    const orders = requestOrders(["pause", "resume", "pause2"]);
    await expectEveryOrderHolds(sample(orders, 25, 1));
  }, 120_000);

  it("after a pause on-chain, resume, pause, resume: a sample of every order (seeded)", async () => {
    const prefix = minedJobSteps("pause");
    const orders = requestOrders(["resume", "pause2", "resume2"], { prefix });
    await expectEveryOrderHolds(sample(orders, 25, 2).map((order) => [...prefix, ...order]));
  }, 120_000);

  it("pause, resume, pause again with deaths, every step in one block second: a sample (seeded)", async () => {
    const orders = requestOrders(["pause", "resume", "pause2"], { deaths: true, stepMs: 50 });
    const dying = orders.filter((order) => order.some((s) => s.phase === "dead"));
    await expectEveryOrderHolds(sample(dying, 25, 4), 50);
  }, 120_000);

  it("after a pause on-chain, resume, pause, resume with deaths in one block second: a sample (seeded)", async () => {
    const prefix = minedJobSteps("pause");
    const orders = requestOrders(["resume", "pause2", "resume2"], {
      prefix,
      deaths: true,
      stepMs: 50,
    });
    const dying = orders.filter((order) => order.some((s) => s.phase === "dead"));
    await expectEveryOrderHolds(
      sample(dying, 25, 5).map((order) => [...prefix, ...order]),
      50,
    );
  }, 120_000);

  it("pause, resume, pause, resume with transient failures: random orders (seeded)", async () => {
    const random = seededRandom(3);
    const orders: PauseStep[][] = [];
    for (let i = 0; i < 10; i += 1) {
      orders.push(
        randomRequestOrder(["pause", "resume", "pause2", "resume2"], random, { maxRetries: 2 }),
      );
    }
    await expectEveryOrderHolds(orders);
  }, 120_000);
});

describe("the store's exception for a job whose transaction is mined", () => {
  it("a resume mined and projected while its job is still running reads as finished: open, no flap", async () => {
    const { campaign, actors, clock, pass } = await setup();
    expect((await pass()).sale).toBe("open");
    for (const s of minedJobSteps("pause")) await actors.play(s, new Date(clock.nowMs));
    expect((await pass()).sale).toBe("paused_manual");
    await actors.request("resume", new Date(clock.nowMs));
    await actors.claim("resume");
    await actors.mine("resume", new Date(clock.nowMs));
    // The handler projects its receipt; the worker has not marked the job done yet.
    await actors.project("resume", false);

    const [job] = await db<{ status: string }[]>`
      select status from jobs where payload ->> 'campaignId' = ${campaign.id}
      order by created_at desc, id desc limit 1
    `;
    expect(job?.status).toBe("running");
    const input = await loadManualPauseInput(db, campaign.id);
    expect(input).toMatchObject({ status: "live", pauseJobInFlight: false });
    const { rows } = await loadCampaignSaleRows(db, [SYMBOL]);
    expect(rows.find((row) => row.id === campaign.id)?.pauseJobInFlight).toBe(false);
    expect(await pass()).toMatchObject({ sale: "open", live: "open" });
    // The worker marks it done: still open, never back to paused_manual.
    await actors.done("resume");
    expect(await pass()).toMatchObject({ sale: "open", live: "open" });
  });

  it("a queued job is in flight although another campaign's setPaused transaction is mined", async () => {
    const { campaign, actors, clock, pass } = await setup();
    // Another campaign's pause is mined (not projected, its job still running).
    const other = new Actors(await seedCampaign());
    await other.request("pause", new Date(clock.nowMs));
    await other.claim("pause");
    await other.mine("pause", new Date(clock.nowMs));
    // This campaign: pause and resume back to back; the pause is superseded and ends; the resume
    // waits in the queue. Only that job keeps the pause (the chain is live, nothing unprojected).
    await actors.request("pause", new Date(clock.nowMs));
    clock.nowMs += 1_000;
    await actors.request("resume", new Date(clock.nowMs));
    await actors.claim("pause");
    await actors.nothingSent("pause");

    expect(await loadManualPauseInput(db, campaign.id)).toMatchObject({
      status: "live",
      pauseJobInFlight: true,
      pauseEventUnprojected: false,
      latestPauseJob: { paused: false },
    });
    expect(await pass()).toMatchObject({ sale: "paused_manual", live: "paused_manual" });
    await actors.claim("resume");
    await actors.nothingSent("resume");
    expect(await pass()).toMatchObject({ sale: "open", live: "open" });
  });

  it("a queued job is in flight although an earlier request of the same campaign was mined", async () => {
    const { campaign, actors, clock, pass } = await setup();
    // A pause and a resume of this campaign went through the chain (their transactions mined).
    for (const s of [...minedJobSteps("pause0"), ...minedJobSteps("resume0")]) {
      await actors.play(s, new Date(clock.nowMs));
    }
    expect((await pass()).sale).toBe("open");
    await actors.request("pause1", new Date(clock.nowMs));
    clock.nowMs += 1_000;
    await actors.request("resume1", new Date(clock.nowMs));
    await actors.claim("pause1");
    await actors.nothingSent("pause1");

    const input = await loadManualPauseInput(db, campaign.id);
    expect(input).toMatchObject({ status: "live", pauseJobInFlight: true });
    expect(input === null ? null : isManuallyPaused(input)).toBe(true);
    expect(await pass()).toMatchObject({ sale: "paused_manual", live: "paused_manual" });
    await actors.claim("resume1");
    await actors.nothingSent("resume1");
    expect(await pass()).toMatchObject({ sale: "open", live: "open" });
  });
});
