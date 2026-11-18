/**
 * The purchase job with the pipelined sender, on a chain with a block time (anvil interval
 * mining at 0.5 s; Arc makes a block about every 0.46 s): simultaneous sales are ticketed within
 * a few blocks instead of a block each, and a pause sent during a burst of sales is a barrier:
 * no sale is ticketed after it is mined, and every payment ends captured or cancelled, never
 * both and never neither. The pause is sent once straight into the sender, and once as the
 * merchant sends it: the web route's `campaign.set_paused` job run by its real handler, then a
 * resume the same way.
 */
import { randomUUID } from "node:crypto";

import { encodeFunctionData, parseEventLogs, type Hex } from "viem";
import { afterEach, describe, expect, it } from "vitest";

import { JOB_KINDS, jobIdempotencyKey, winzEscrowAbi, type BookLevel } from "@winz/shared";

import { createDb, type Db } from "../../db";
import { enqueueJob } from "../enqueue";
import { createSetPausedHandler } from "./campaign-actions";
import { finishPauseJobs } from "./campaign-actions.test-support";
import { createPurchaseHandler } from "./purchase";
import {
  CONTRACT,
  createJobsHarness,
  createLiveCampaign,
  getCampaign,
  runHandler,
  seedPayment,
  type JobsHarness,
  type LiveCampaign,
} from "./test-support";

const ASKS: BookLevel[] = [
  { priceBps: 3_000n, qty: 200n * CONTRACT },
  { priceBps: 3_100n, qty: 300n * CONTRACT },
];
const BIDS: BookLevel[] = [{ priceBps: 2_900n, qty: 100n * CONTRACT }];

let harness: JobsHarness | undefined;
/**
 * The handlers' own pool. Each running purchase job holds a connection for its lock, as in
 * production (where `DB_POOL_MAX` is sized for the worker's concurrency); the test database's
 * pool of 5 would deadlock ten jobs at once.
 */
let jobsDb: Db | undefined;

afterEach(async () => {
  await jobsDb?.end({ timeout: 5 });
  jobsDb = undefined;
  await harness?.close();
  harness = undefined;
});

/** `maxInFlight` omitted: the sender's default window. */
async function setUp(maxInFlight?: number): Promise<{ h: JobsHarness; campaign: LiveCampaign }> {
  const h = await createJobsHarness({
    blockTime: 0.5,
    sender: maxInFlight === undefined ? {} : { maxInFlight },
  });
  harness = h;
  jobsDb = createDb(h.database.url, { max: 30 });
  const campaign = await createLiveCampaign(
    h,
    `pipeline-${maxInFlight === undefined ? "default" : maxInFlight.toString()}`,
  );
  h.books.set(campaign.symbol, { asks: ASKS, bids: BIDS });
  return { h, campaign };
}

async function pay(h: JobsHarness, campaign: LiveCampaign, index: number): Promise<string> {
  return seedPayment(h, {
    campaignId: campaign.campaignId,
    qty: 1,
    unitPrice: campaign.terms.unitPrice,
    email: `fan-${index.toString()}-${Date.now().toString(36)}@example.com`,
  });
}

async function sell(h: JobsHarness, pi: string): Promise<void> {
  await runHandler(h, createPurchaseHandler(h.deps(jobsDb === undefined ? {} : { db: jobsDb })), {
    paymentIntentId: pi,
  });
}

interface BuyRow {
  key: string;
  status: string;
  nonce: bigint | null;
  block: bigint | null;
  error: string | null;
}

async function buyRows(h: JobsHarness): Promise<BuyRow[]> {
  const rows = await h.db<
    {
      idempotency_key: string;
      status: string;
      nonce: bigint | null;
      block_number: bigint | null;
      last_error: string | null;
    }[]
  >`
    select idempotency_key, status, nonce, block_number, last_error from chain_txs
    where kind = 'buyFor' order by created_at, id
  `;
  return rows.map((row) => ({
    key: row.idempotency_key,
    status: row.status,
    nonce: row.nonce,
    block: row.block_number,
    error: row.last_error,
  }));
}

function spread(blocks: readonly bigint[]): bigint {
  let low = blocks[0] ?? 0n;
  let high = low;
  for (const block of blocks) {
    if (block < low) low = block;
    if (block > high) high = block;
  }
  return high - low;
}

/** Every payment ended with a ticket and one capture, or with one cancel and no ticket. */
async function expectSettledPayments(h: JobsHarness, pis: readonly string[]): Promise<string[]> {
  const statuses: string[] = [];
  for (const pi of pis) {
    const [row] = await h.db<{ status: string; ticket_id: string | null }[]>`
      select status, ticket_id from payments where stripe_pi = ${pi}
    `;
    const effects = h.gateway.effectsOf(pi);
    if (row?.status === "ticketed") {
      expect(effects, pi).toEqual({ captures: 1, cancels: 0, refunds: 0 });
      expect(row.ticket_id, pi).not.toBeNull();
    } else {
      expect(row?.status, pi).toBe("cancelled_paused");
      expect(effects, pi).toEqual({ captures: 0, cancels: 1, refunds: 0 });
      expect(row?.ticket_id, pi).toBeNull();
    }
    statuses.push(row?.status ?? "missing");
  }
  return statuses;
}

describe("simultaneous sales on a chain with a block time", () => {
  const SALES = 8;

  async function burst(maxInFlight: number): Promise<bigint[]> {
    const { h, campaign } = await setUp(maxInFlight);
    const pis: string[] = [];
    for (let index = 0; index < SALES; index += 1) pis.push(await pay(h, campaign, index));
    await Promise.all(pis.map((pi) => sell(h, pi)));
    expect(await expectSettledPayments(h, pis)).toEqual(Array(SALES).fill("ticketed"));
    const rows = await buyRows(h);
    expect(rows).toHaveLength(SALES);
    expect(rows.every((row) => row.status === "mined")).toBe(true);
    const blocks = rows.map((row) => row.block as bigint);
    await jobsDb?.end({ timeout: 5 });
    jobsDb = undefined;
    await harness?.close();
    harness = undefined;
    return blocks;
  }

  it("are ticketed within a few blocks, not a block each", async () => {
    const together = await burst(8);
    const alone = await burst(1);
    process.stdout.write(
      `[purchase pipeline] ${SALES.toString()} simultaneous sales: window 8 mined in blocks ` +
        `${together.join(", ")} (spread ${spread(together).toString()}); window 1 in blocks ` +
        `${alone.join(", ")} (spread ${spread(alone).toString()})\n`,
    );
    expect(spread(together)).toBeLessThanOrEqual(2n);
    expect(new Set(alone).size).toBe(SALES);
    expect(spread(alone)).toBeGreaterThanOrEqual(BigInt(SALES - 1));
  }, 240_000);
});

describe("a campaign paused during a burst of sales", () => {
  it("tickets no sale after the pause is mined, and every payment ends captured or cancelled", async () => {
    const { h, campaign } = await setUp(8);
    const before: string[] = [];
    const after: string[] = [];
    for (let index = 0; index < 5; index += 1) before.push(await pay(h, campaign, index));
    for (let index = 5; index < 10; index += 1) after.push(await pay(h, campaign, index));

    // The first wave's buyFor are in the outbox before the pause.
    const first = before.map((pi) => sell(h, pi));
    for (;;) {
      if ((await buyRows(h)).length >= before.length) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    // The merchant's pause, as its job sends it: `setPaused` from the relayer, a barrier. The
    // database is left unaware, so the second wave quotes and queues its buyFor all the same.
    const { id: pauseId } = await h.sender.enqueue({
      idempotencyKey: "setPaused:burst",
      signer: "relayer",
      kind: "setPaused",
      to: h.escrow.escrow,
      data: encodeFunctionData({
        abi: winzEscrowAbi,
        functionName: "setPaused",
        args: [campaign.onchainId, true],
      }),
      payload: { campaignId: campaign.campaignId, paused: true },
    });
    const second = after.map((pi) => sell(h, pi));
    await Promise.all([...first, ...second]);
    const pause = await h.sender.waitFor(pauseId, { timeoutMs: 20_000 });
    expect(pause.status).toBe("mined");
    expect((await getCampaign(h, campaign.onchainId)).status).toBe(1);

    const statuses = await expectSettledPayments(h, [...before, ...after]);
    expect(statuses.slice(0, 5)).toEqual(Array(5).fill("ticketed"));
    expect(statuses.slice(5)).toEqual(Array(5).fill("cancelled_paused"));

    // On-chain: every purchase is in a block before the pause's, none after it.
    const pauseBlock = pause.blockNumber as bigint;
    const logs = await h.escrow.publicClient.getLogs({
      address: h.escrow.escrow,
      fromBlock: h.escrow.deployedAtBlock,
      toBlock: "latest",
    });
    const purchases = parseEventLogs({ abi: winzEscrowAbi, eventName: "TicketPurchased", logs });
    expect(purchases).toHaveLength(5);
    for (const event of purchases) expect(event.blockNumber).toBeLessThan(pauseBlock);
    // The pause went alone, after the first wave; the second wave was refused in simulation,
    // never signed, never given a nonce.
    const rows = await buyRows(h);
    const [pauseRow] = await h.db<{ nonce: bigint; tx_hash: Hex }[]>`
      select nonce, tx_hash from chain_txs where id = ${pauseId}
    `;
    const waveOne = rows.filter((row) => before.some((pi) => row.key.startsWith(`buyFor:${pi}:`)));
    const waveTwo = rows.filter((row) => after.some((pi) => row.key.startsWith(`buyFor:${pi}:`)));
    for (const row of waveOne) {
      expect(row.status).toBe("mined");
      expect(row.nonce as bigint).toBeLessThan(pauseRow?.nonce as bigint);
      expect(row.block as bigint).toBeLessThan(pauseBlock);
    }
    expect(waveTwo.length).toBeGreaterThanOrEqual(5);
    for (const row of waveTwo) {
      expect(row).toMatchObject({ status: "failed", nonce: null, error: "SalesArePaused" });
    }
    // The first wave travelled together.
    expect(spread(waveOne.map((row) => row.block as bigint))).toBeLessThanOrEqual(2n);
  }, 240_000);
});

/**
 * What POST /api/campaigns/:id/pause and /resume write (`apps/web/lib/server/campaign-writes.ts`),
 * in one transaction: a pause sets the sale state to `paused_manual` at once, then the request's
 * `campaign.set_paused` job row. Returns the request id.
 *
 * `saleStateFirst: false` writes the job row alone, the sale state left as it was: the route
 * writes both in one transaction, so this cannot happen through it; a test does it by hand to
 * check the pause job's own write of the sale state.
 */
async function merchantRequest(
  h: JobsHarness,
  campaignId: string,
  paused: boolean,
  { saleStateFirst = true }: { saleStateFirst?: boolean } = {},
): Promise<string> {
  const requestId = randomUUID();
  await h.db.begin(async (tx) => {
    if (paused && saleStateFirst)
      await tx`update campaigns set sale_state = 'paused_manual' where id = ${campaignId}`;
    await enqueueJob(tx, {
      kind: JOB_KINDS.setPaused,
      payload: { campaignId, paused, requestId },
      idempotencyKey: jobIdempotencyKey.setPaused(requestId),
    });
  });
  return requestId;
}

/** The job worker's run of a `campaign.set_paused` job: the real handler, then the job done. */
async function runPauseJob(
  h: JobsHarness,
  campaignId: string,
  paused: boolean,
  requestId: string,
): Promise<void> {
  const handler = createSetPausedHandler(h.deps(jobsDb === undefined ? {} : { db: jobsDb }));
  await runHandler(h, handler, { campaignId, paused, requestId });
  await finishPauseJobs(h, campaignId);
}

/** The `setPaused` transaction of a merchant request: mined, and its block. */
async function pauseTx(
  h: JobsHarness,
  requestId: string,
): Promise<{ status: string; block: bigint }> {
  const [row] = await h.db<{ status: string; block_number: bigint | null }[]>`
    select status, block_number from chain_txs
    where kind = 'setPaused' and payload ->> 'requestId' = ${requestId}
    order by created_at
  `;
  if (row === undefined) throw new Error(`no setPaused transaction for request ${requestId}`);
  return { status: row.status, block: row.block_number ?? -1n };
}

async function storedSaleState(
  h: JobsHarness,
  campaignId: string,
): Promise<{ status: string; stored: string; live: string | null }> {
  const [row] = await h.db<{ status: string; sale_state: string; live: string | null }[]>`
    select c.status, c.sale_state, l.sale_state as live
    from campaigns c left join live_campaigns l on l.slug = c.slug
    where c.id = ${campaignId}
  `;
  if (row === undefined) throw new Error(`no campaign ${campaignId}`);
  return { status: row.status, stored: row.sale_state, live: row.live };
}

function rowsOfPayment(rows: readonly BuyRow[], pi: string): BuyRow[] {
  return rows.filter((row) => row.key.startsWith(`buyFor:${pi}:`));
}

async function ticketBlocks(h: JobsHarness): Promise<bigint[]> {
  const logs = await h.escrow.publicClient.getLogs({
    address: h.escrow.escrow,
    fromBlock: h.escrow.deployedAtBlock,
    toBlock: "latest",
  });
  return parseEventLogs({ abi: winzEscrowAbi, eventName: "TicketPurchased", logs }).map(
    (event) => event.blockNumber,
  );
}

describe("the merchant's pause job during a burst of sales, then a resume (default window)", () => {
  it("tickets no sale after the pause is mined, settles every payment once, stores paused_manual, refuses the later sales, and tickets again after the resume", async () => {
    const { h, campaign } = await setUp();
    const { campaignId } = campaign;
    const inFlight: string[] = [];
    const racing: string[] = [];
    const afterPause: string[] = [];
    const afterResume: string[] = [];
    for (let index = 0; index < 5; index += 1) inFlight.push(await pay(h, campaign, index));
    for (let index = 5; index < 8; index += 1) racing.push(await pay(h, campaign, index));
    for (let index = 8; index < 12; index += 1) afterPause.push(await pay(h, campaign, index));

    // A burst of sales in flight: their buyFor are in the outbox.
    const first = inFlight.map((pi) => sell(h, pi));
    for (;;) {
      if ((await buyRows(h)).length >= inFlight.length) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    // More sales start as the merchant clicks pause; the pause job runs at once; then sales whose
    // purchase jobs start after the job row was written.
    const racingSales = racing.map((pi) => sell(h, pi));
    const pauseRequest = await merchantRequest(h, campaignId, true);
    const pauseJob = runPauseJob(h, campaignId, true, pauseRequest);
    const refusedSales = afterPause.map((pi) => sell(h, pi));
    await Promise.all([...first, ...racingSales, ...refusedSales, pauseJob]);

    const pause = await pauseTx(h, pauseRequest);
    expect(pause.status).toBe("mined");
    expect((await getCampaign(h, campaign.onchainId)).status).toBe(1);
    // The database was told: the projected pause, and the merchant's sale state.
    const paused = await storedSaleState(h, campaignId);
    expect(paused).toMatchObject({ status: "paused", stored: "paused_manual" });
    if (paused.live !== null) expect(paused.live).toBe("paused_manual");

    // Every payment ends captured with its ticket, or cancelled without one: never both, never
    // neither.
    const statuses = await expectSettledPayments(h, [...inFlight, ...racing, ...afterPause]);
    expect(statuses.slice(0, inFlight.length)).toEqual(Array(inFlight.length).fill("ticketed"));
    expect(statuses.slice(inFlight.length + racing.length)).toEqual(
      Array(afterPause.length).fill("cancelled_paused"),
    );

    const rows = await buyRows(h);
    // No sale is ticketed after the pause is mined: every mined purchase is in an earlier block.
    for (const [index, pi] of [...inFlight, ...racing].entries()) {
      const mined = rowsOfPayment(rows, pi).filter((row) => row.status === "mined");
      if (statuses[index] === "ticketed") {
        expect(mined, pi).toHaveLength(1);
        expect(mined[0]?.block as bigint, pi).toBeLessThan(pause.block);
      } else {
        expect(mined, pi).toEqual([]);
      }
    }
    // The sales started after the pause job's row: refused by the engine's own sale-state check
    // (no buyFor at all), or by the escrow on SalesArePaused; never signed into a ticket.
    let refusedBySaleState = 0;
    let refusedOnChain = 0;
    for (const pi of afterPause) {
      const own = rowsOfPayment(rows, pi);
      if (own.length === 0) refusedBySaleState += 1;
      else refusedOnChain += 1;
      for (const row of own) {
        expect(["failed", "reverted"], pi).toContain(row.status);
        expect(row.error, pi).toBe("SalesArePaused");
      }
    }
    const ticketed = statuses.filter((status) => status === "ticketed").length;
    const pausedTickets = await ticketBlocks(h);
    expect(pausedTickets).toHaveLength(ticketed);
    for (const block of pausedTickets) expect(block).toBeLessThan(pause.block);

    // The merchant resumes: the job brings the chain back to live, the sale state reopens.
    const resumeRequest = await merchantRequest(h, campaignId, false);
    await runPauseJob(h, campaignId, false, resumeRequest);
    const resume = await pauseTx(h, resumeRequest);
    expect(resume.status).toBe("mined");
    expect(resume.block).toBeGreaterThan(pause.block);
    expect((await getCampaign(h, campaign.onchainId)).status).toBe(0);
    const resumed = await storedSaleState(h, campaignId);
    expect(resumed).toMatchObject({ status: "live", stored: "open" });
    if (resumed.live !== null) expect(resumed.live).toBe("open");

    // Sales are ticketed again.
    for (let index = 12; index < 15; index += 1) afterResume.push(await pay(h, campaign, index));
    await Promise.all(afterResume.map((pi) => sell(h, pi)));
    expect(await expectSettledPayments(h, afterResume)).toEqual(
      Array(afterResume.length).fill("ticketed"),
    );
    const allTickets = await ticketBlocks(h);
    expect(allTickets).toHaveLength(ticketed + afterResume.length);
    // None while the campaign was paused on-chain.
    for (const block of allTickets) {
      expect(block < pause.block || block > resume.block, block.toString()).toBe(true);
    }
    process.stdout.write(
      `[merchant pause job] pause mined in block ${pause.block.toString()}, resume in ${resume.block.toString()}; ` +
        `racing sales ${statuses
          .slice(inFlight.length, inFlight.length + racing.length)
          .join(", ")}; later sales refused by the sale state ${refusedBySaleState.toString()}, ` +
        `on-chain ${refusedOnChain.toString()}; ${allTickets.length.toString()} tickets in all\n`,
    );
  }, 240_000);
});

/** Polls `condition` every 5 ms until it holds, or fails after `timeoutMs`. */
async function until(
  condition: () => Promise<boolean>,
  what: string,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

interface OutboxRow {
  id: string;
  key: string;
  kind: string;
  status: string;
  nonce: bigint | null;
  error: string | null;
  createdAt: Date;
}

/** The `setPaused` of a merchant request and every `buyFor`, in the outbox's order. */
async function outboxRows(h: JobsHarness, requestId: string): Promise<OutboxRow[]> {
  const rows = await h.db<
    {
      id: string;
      idempotency_key: string;
      kind: string;
      status: string;
      nonce: bigint | null;
      last_error: string | null;
      created_at: Date;
    }[]
  >`
    select id, idempotency_key, kind, status, nonce, last_error, created_at from chain_txs
    where kind = 'buyFor' or (kind = 'setPaused' and payload ->> 'requestId' = ${requestId})
    order by created_at, id
  `;
  return rows.map((row) => ({
    id: row.id,
    key: row.idempotency_key,
    kind: row.kind,
    status: row.status,
    nonce: row.nonce,
    error: row.last_error,
    createdAt: row.created_at,
  }));
}

/** The purchase handler's "sale refused" lines of a payment, with their reason. */
function refusalReasons(h: JobsHarness, pi: string): unknown[] {
  return h.logs
    .filter(
      (entry) =>
        entry.paymentIntentId === pi &&
        typeof entry.msg === "string" &&
        entry.msg.startsWith("sale refused: authorization released"),
    )
    .map((entry) => entry.reason);
}

describe("sales whose buyFor is already queued behind the merchant's pause (sale state not written first)", () => {
  it("the pause job writes paused_manual itself; each queued sale is refused with SalesArePaused, cancelled once, never captured, never ticketed", async () => {
    const { h, campaign } = await setUp();
    const { campaignId } = campaign;
    const inFlight: string[] = [];
    const queuedBehind: string[] = [];
    for (let index = 0; index < 3; index += 1) inFlight.push(await pay(h, campaign, index));
    for (let index = 3; index < 8; index += 1) queuedBehind.push(await pay(h, campaign, index));

    // A burst of sales in flight: their buyFor are in the outbox.
    const first = inFlight.map((pi) => sell(h, pi));
    await until(
      async () => (await buyRows(h)).length >= inFlight.length,
      "the first sales' buyFor",
    );

    // Blocks stop for a moment (anvil's interval mining off): what is sent now stays pending, so
    // the pause is not mined while the later sales queue their buyFor behind it.
    await h.anvil.rpc("evm_setIntervalMining", [0]);
    let pauseJob: Promise<void>;
    let later: Promise<void>[];
    let queuedOutbox: OutboxRow[];
    const pauseRequest = await merchantRequest(h, campaignId, true, { saleStateFirst: false });
    try {
      // The merchant's pause job, with the sale state still `open` (the route's first write
      // missing): its `setPaused` enters the outbox, a barrier.
      pauseJob = runPauseJob(h, campaignId, true, pauseRequest);
      await until(
        async () => (await outboxRows(h, pauseRequest)).some((row) => row.kind === "setPaused"),
        "the pause's setPaused in the outbox",
      );
      // Nothing has told the database yet: the purchase handler's own checks let the later sales
      // through, and they quote and queue their buyFor behind the pause.
      expect(await storedSaleState(h, campaignId)).toMatchObject({
        status: "live",
        stored: "open",
      });
      later = queuedBehind.map((pi) => sell(h, pi));
      await until(async () => {
        const rows = await buyRows(h);
        return queuedBehind.every((pi) => rowsOfPayment(rows, pi).length === 1);
      }, "the later sales' buyFor queued");
      queuedOutbox = await outboxRows(h, pauseRequest);
    } finally {
      // Blocks again, whatever happened above.
      await h.anvil.rpc("evm_setIntervalMining", [1]);
    }
    // Positive control: when blocks resumed, the pause was in the outbox before each later sale's
    // buyFor, not mined, and each of those buyFor was waiting behind it, unsigned.
    const pauseQueued = queuedOutbox.find((row) => row.kind === "setPaused");
    expect(pauseQueued).toBeDefined();
    expect(["queued", "sent"]).toContain(pauseQueued?.status);
    for (const pi of queuedBehind) {
      const [row] = queuedOutbox.filter((entry) => entry.key.startsWith(`buyFor:${pi}:`));
      expect(row, pi).toMatchObject({ status: "queued", nonce: null });
      expect(row?.createdAt.getTime(), pi).toBeGreaterThanOrEqual(
        pauseQueued?.createdAt.getTime() as number,
      );
      expect(queuedOutbox.indexOf(row as OutboxRow), pi).toBeGreaterThan(
        queuedOutbox.indexOf(pauseQueued as OutboxRow),
      );
    }

    await Promise.all([...first, ...later, pauseJob]);

    const pause = await pauseTx(h, pauseRequest);
    expect(pause.status).toBe("mined");
    expect((await getCampaign(h, campaign.onchainId)).status).toBe(1);
    // The pause job's own write: the sale state was still `open` when it ran.
    const paused = await storedSaleState(h, campaignId);
    expect(paused).toMatchObject({ status: "paused", stored: "paused_manual" });
    if (paused.live !== null) expect(paused.live).toBe("paused_manual");

    // The sales in flight before the pause are ticketed; the ones queued behind it end cancelled
    // with exactly one cancel and no capture (checked by `expectSettledPayments`).
    const statuses = await expectSettledPayments(h, [...inFlight, ...queuedBehind]);
    expect(statuses).toEqual([
      ...Array<string>(inFlight.length).fill("ticketed"),
      ...Array<string>(queuedBehind.length).fill("cancelled_paused"),
    ]);

    // Each queued sale's one buyFor was refused by the escrow on SalesArePaused: in simulation
    // (`failed`, no nonce used) or on-chain (`reverted`). The handler read it as the sale closed,
    // not as a failure to retry or a success.
    const rows = await buyRows(h);
    let refusedInSimulation = 0;
    let revertedOnChain = 0;
    for (const pi of queuedBehind) {
      const own = rowsOfPayment(rows, pi);
      expect(own, pi).toHaveLength(1);
      const [row] = own;
      expect(row?.error, pi).toBe("SalesArePaused");
      if (row?.status === "failed") {
        expect(row.nonce, pi).toBeNull();
        refusedInSimulation += 1;
      } else {
        expect(row?.status, pi).toBe("reverted");
        revertedOnChain += 1;
      }
      expect(refusalReasons(h, pi), pi).toEqual(["SalesArePaused"]);
    }
    expect(refusedInSimulation + revertedOnChain).toBe(queuedBehind.length);

    // No ticket for them: only the sales in flight before the pause, all mined before it.
    for (const pi of inFlight) {
      const mined = rowsOfPayment(rows, pi).filter((row) => row.status === "mined");
      expect(mined, pi).toHaveLength(1);
      expect(mined[0]?.block as bigint, pi).toBeLessThan(pause.block);
    }
    const tickets = await ticketBlocks(h);
    expect(tickets).toHaveLength(inFlight.length);
    for (const block of tickets) expect(block).toBeLessThan(pause.block);
    const [ticketRows] = await h.db<{ n: bigint }[]>`
      select count(*)::bigint as n from tickets where campaign_id = ${campaignId}
    `;
    expect(ticketRows?.n).toBe(BigInt(inFlight.length));

    process.stdout.write(
      `[sales queued behind the pause] pause mined in block ${pause.block.toString()}; ` +
        `${queuedBehind.length.toString()} sales queued behind it: refused in simulation ` +
        `${refusedInSimulation.toString()}, reverted on-chain ${revertedOnChain.toString()}; ` +
        `${tickets.length.toString()} tickets (the ${inFlight.length.toString()} sales in flight before it)\n`,
    );
  }, 240_000);
});
