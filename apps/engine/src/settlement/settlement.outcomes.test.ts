/**
 * R-01 / R-02 on the real contract: the watcher settles a campaign once its game is decided and
 * its sales are closed, then pushes refunds, payMerchant and release (SPEC ST-1 to ST-4). Every
 * expectation is read back from the chain (balances, getCampaign, the escrow's own logs) and
 * from the projection the real chain ingestion wrote.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { Outcome } from "@winz/shared";

import { ESCROW_STATUS } from "./plan";
import {
  buyerAddress,
  chargeThroughSender,
  createSettlementEnv,
  escrowEvents,
  eventCounts,
  FakeHedgeFinalizer,
  HOUR,
  projectedLots,
  setInstrumentOutcome,
  SYMBOL,
  tokenBalance,
  USDC,
  waitFor,
  waitForIdleOutbox,
  type SettlementEnv,
} from "./test-support";

const UNIT_PRICE = 10n * USDC;
const REFUND_BPS = 5_000;
/** 10 USDC at 50 %. */
const REFUNDABLE = 5n * USDC;
const BUDGET = 100n * USDC;
const GUARANTEE = USDC;
/** What the fake hedging lane charges each ticket, below the guarantee. */
const HEDGE_COSTS = [400_000n, 500_000n, 600_000n, 700_000n];
const HEDGE_SPENT = HEDGE_COSTS.reduce((sum, cost) => sum + cost, 0n);
const EXPOSURE = REFUNDABLE * BigInt(HEDGE_COSTS.length);

const STATUS_BY_OUTCOME = {
  yes: ESCROW_STATUS.settledYes,
  no: ESCROW_STATUS.settledNo,
  void: ESCROW_STATUS.void,
} as const;
const DB_STATUS_BY_OUTCOME = { yes: "settled_yes", no: "settled_no", void: "void" } as const;

let current: SettlementEnv | undefined;

afterEach(async () => {
  await current?.close();
  current = undefined;
});

interface Run {
  t: SettlementEnv;
  buyers: ReturnType<typeof buyerAddress>[];
  ticketIds: bigint[];
  campaignId: string;
  before: { merchant: bigint; treasury: bigint; escrow: bigint; buyers: bigint[] };
  finalizer: FakeHedgeFinalizer;
}

/**
 * One campaign of four tickets, charged by a fake hedging lane through the transaction sender,
 * settled by the watcher on `outcome`. Resolves once the chain says the campaign is finished.
 */
async function settleWith(outcome: Outcome): Promise<Run> {
  const t = await createSettlementEnv();
  current = t;
  const buyers = HEDGE_COSTS.map((_, index) => buyerAddress(index + 1));
  const campaign = await t.createCampaign({
    buyers,
    unitPrice: UNIT_PRICE,
    refundBps: REFUND_BPS,
    budget: BUDGET,
    maxHedgeCost: GUARANTEE,
  });
  const sender = await t.startSender();
  // The hedging lane: charges every lot its cost once, idempotently, through the same sender.
  const finalizer = new FakeHedgeFinalizer(async (settled) => {
    await chargeThroughSender(
      sender,
      t.env,
      `fake-hedge:${settled.onchainId.toString()}`,
      campaign.ticketIds,
      HEDGE_COSTS,
    );
  });

  await t.env.advanceTime(HOUR + 1n);
  await setInstrumentOutcome(t.db, SYMBOL, outcome);
  const before = {
    merchant: await tokenBalance(t.env, t.env.accounts.merchant.address),
    treasury: await tokenBalance(t.env, t.env.accounts.treasury.address),
    escrow: await tokenBalance(t.env, t.env.escrow),
    buyers: await Promise.all(buyers.map((buyer) => tokenBalance(t.env, buyer))),
  };

  t.startWatcher({ txSender: sender, hedgeFinalizer: finalizer });
  await waitFor(async () => {
    const onchain = await t.driver.getCampaign(campaign.onchainId);
    return (
      onchain.status === STATUS_BY_OUTCOME[outcome] &&
      onchain.released &&
      onchain.merchantDue === 0n &&
      (outcome !== "yes" || onchain.lockedRefunds === 0n)
    );
  }, `the campaign to be settled ${outcome} and finished`);
  return { t, buyers, ticketIds: campaign.ticketIds, campaignId: campaign.id, before, finalizer };
}

/** The projection agrees with the chain: status, outcome, charged lots, ticket statuses. */
async function expectProjection(run: Run, outcome: Outcome): Promise<void> {
  const { t, campaignId } = run;
  // Every receipt recorded, so every event of the watcher's transactions is in chain_events.
  await waitForIdleOutbox(t.db);
  await waitFor(async () => {
    const [row] = await t.db<{ status: string; outcome: string | null; unprojected: bigint }[]>`
      select status, outcome,
             (select count(*) from chain_events where processed_at is null) as unprojected
      from campaigns where id = ${campaignId}
    `;
    return row?.status === DB_STATUS_BY_OUTCOME[outcome] && row.unprojected === 0n;
  }, "the projection to catch up");
  const [row] = await t.db<{ outcome: string | null; demo: boolean }[]>`
    select outcome, demo from campaigns where id = ${campaignId}
  `;
  expect(row?.outcome).toBe(outcome);
  expect(row?.demo).toBe(false);
  const lots = await projectedLots(t.db, campaignId);
  run.ticketIds.forEach((ticketId, index) => {
    expect(lots.get(ticketId)).toEqual({ charged: true, chargedAmount: HEDGE_COSTS[index] });
  });
  const tickets = await t.db<{ status: string }[]>`
    select status from tickets where campaign_id = ${campaignId}
  `;
  expect(tickets).toHaveLength(run.ticketIds.length);
  const expected = outcome === "yes" ? "refunded" : "issued";
  for (const ticket of tickets) expect(ticket.status).toBe(expected);
  // The oracle signed chargeHedge and settle; the relayer refunds, payMerchant and release.
  const signers = await t.db<{ kind: string; signer: string }[]>`
    select kind, signer from chain_txs where idempotency_key like 'settlement:%'
  `;
  expect(signers.length).toBeGreaterThan(0);
  for (const { kind, signer } of signers) {
    expect({ kind, signer }).toEqual({
      kind,
      signer: kind === "settle" || kind === "chargeHedge" ? "oracle" : "relayer",
    });
  }
  const kinds = new Set(signers.map((row) => row.kind));
  expect(kinds.has("release")).toBe(true);
  if (outcome !== "no") expect(kinds.has("payMerchant")).toBe(true);
  // Nothing went wrong on the way: no error was logged by the watcher, the sender or the ingest.
  expect(t.logs.filter((entry) => typeof entry.level === "number" && entry.level >= 50)).toEqual(
    [],
  );
}

describe("the settlement watcher on the three outcomes", () => {
  it("YES: refunds every ticket, pays the merchant its exposure from the treasury, releases the unspent budget", async () => {
    const run = await settleWith("yes");
    const { t, buyers, ticketIds, before } = run;

    // Every buyer got exactly the refundable part of the price, once.
    for (const [index, buyer] of buyers.entries()) {
      expect(await tokenBalance(t.env, buyer)).toBe((before.buyers[index] ?? 0n) + REFUNDABLE);
    }
    const refunded = await eventCounts(t.env, "TicketRefunded");
    for (const ticketId of ticketIds) expect(refunded.get(ticketId)).toBe(1);
    expect((await eventCounts(t.env, "RefundFailed")).size).toBe(0);

    // Merchant: its exposure from the treasury (payMerchant) and the unspent budget (release).
    expect(await tokenBalance(t.env, t.env.accounts.merchant.address)).toBe(
      before.merchant + EXPOSURE + (BUDGET - HEDGE_SPENT),
    );
    // Treasury: received the hedge charges, paid the exposure.
    expect(await tokenBalance(t.env, t.env.accounts.treasury.address)).toBe(
      before.treasury + HEDGE_SPENT - EXPOSURE,
    );
    // The escrow holds nothing for the campaign (it is the only one on this chain).
    expect(before.escrow).toBe(EXPOSURE + BUDGET);
    expect(await tokenBalance(t.env, t.env.escrow)).toBe(0n);

    const onchain = await t.driver.getCampaign(1n);
    expect(onchain).toMatchObject({
      hedgeReserved: 0n,
      hedgeSpent: HEDGE_SPENT,
      lockedRefunds: 0n,
      merchantDue: 0n,
      released: true,
    });
    expect((await eventCounts(t.env, "MerchantPaid")).get(1n)).toBe(1);
    expect((await eventCounts(t.env, "CampaignReleased")).get(1n)).toBe(1);
    expect((await eventCounts(t.env, "CampaignSettled")).get(1n)).toBe(1);
    expect(run.finalizer.calls.length).toBeGreaterThanOrEqual(1);
    expect(run.finalizer.calls[0]).toMatchObject({ onchainId: 1n, outcome: "yes", forced: false });

    await expectProjection(run, "yes");
  });

  it("NO: the escrow and the unspent budget go to the merchant, nobody is refunded", async () => {
    const run = await settleWith("no");
    const { t, buyers, before } = run;

    for (const [index, buyer] of buyers.entries()) {
      expect(await tokenBalance(t.env, buyer)).toBe(before.buyers[index]);
    }
    expect((await eventCounts(t.env, "TicketRefunded")).size).toBe(0);
    expect((await eventCounts(t.env, "MerchantPaid")).size).toBe(0);
    expect(await tokenBalance(t.env, t.env.accounts.merchant.address)).toBe(
      before.merchant + EXPOSURE + (BUDGET - HEDGE_SPENT),
    );
    expect(await tokenBalance(t.env, t.env.accounts.treasury.address)).toBe(
      before.treasury + HEDGE_SPENT,
    );
    expect(await tokenBalance(t.env, t.env.escrow)).toBe(0n);
    expect(await t.driver.getCampaign(1n)).toMatchObject({
      lockedRefunds: 0n,
      merchantDue: 0n,
      released: true,
    });
    // Nothing for the treasury to pay on NO: payMerchant was never sent.
    const sent = await t.db<{ kind: string }[]>`
      select kind from chain_txs where idempotency_key like 'settlement:%'
    `;
    expect(sent.map((row) => row.kind).sort()).toEqual(["release", "settle"]);

    await expectProjection(run, "no");
  });

  it("VOID: like NO for the escrow, and the treasury gives the merchant the hedge spent back", async () => {
    const run = await settleWith("void");
    const { t, buyers, before } = run;

    for (const [index, buyer] of buyers.entries()) {
      expect(await tokenBalance(t.env, buyer)).toBe(before.buyers[index]);
    }
    expect((await eventCounts(t.env, "TicketRefunded")).size).toBe(0);
    // Escrow and unspent budget by release, the hedge spent by payMerchant: the whole budget.
    expect(await tokenBalance(t.env, t.env.accounts.merchant.address)).toBe(
      before.merchant + EXPOSURE + BUDGET,
    );
    expect(await tokenBalance(t.env, t.env.accounts.treasury.address)).toBe(before.treasury);
    expect(await tokenBalance(t.env, t.env.escrow)).toBe(0n);
    const merchantPaid = (await escrowEvents(t.env)).filter(
      (event) => event.eventName === "MerchantPaid",
    );
    expect(merchantPaid).toHaveLength(1);
    expect((merchantPaid[0]?.args as { amount: bigint }).amount).toBe(HEDGE_SPENT);
    expect(await t.driver.getCampaign(1n)).toMatchObject({
      lockedRefunds: 0n,
      merchantDue: 0n,
      released: true,
    });

    await expectProjection(run, "void");
  });
});
