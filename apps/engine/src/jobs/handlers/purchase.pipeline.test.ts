/**
 * The purchase job with the pipelined sender, on a chain with a block time (anvil interval
 * mining at 0.5 s; Arc makes a block about every 0.46 s): simultaneous sales are ticketed within
 * a few blocks instead of a block each, and a pause sent during a burst of sales is a barrier:
 * no sale is ticketed after it is mined, and every payment ends captured or cancelled, never
 * both and never neither.
 */
import { encodeFunctionData, parseEventLogs, type Hex } from "viem";
import { afterEach, describe, expect, it } from "vitest";

import { winzEscrowAbi, type BookLevel } from "@winz/shared";

import { createDb, type Db } from "../../db";
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

async function setUp(maxInFlight: number): Promise<{ h: JobsHarness; campaign: LiveCampaign }> {
  const h = await createJobsHarness({ blockTime: 0.5, sender: { maxInFlight } });
  harness = h;
  jobsDb = createDb(h.database.url, { max: 30 });
  const campaign = await createLiveCampaign(h, `pipeline-${maxInFlight.toString()}`);
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
