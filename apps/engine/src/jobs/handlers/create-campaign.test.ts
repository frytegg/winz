/**
 * J-02 on the real contract: the creation job against a local chain with the real escrow, a real
 * Postgres, the real transaction sender and projector, and a fake payment gateway.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { slugSchema } from "@winz/shared";

import { RetryLaterError } from "../errors";
import { createCampaignCreationHandler } from "./create-campaign";
import {
  campaignCount,
  checksum,
  createJobsHarness,
  getCampaign,
  logsAt,
  runHandler,
  seedFundedCampaign,
  seedInstrument,
  seedMerchant,
  treasuryBalance,
  txRows,
  USDC,
  type JobsHarness,
} from "./test-support";

let harness: JobsHarness;

beforeAll(async () => {
  harness = await createJobsHarness();
});

afterAll(async () => {
  await harness?.close();
});

interface CampaignDbRow {
  status: string;
  sale_state: string;
  onchain_id: bigint | null;
  slug: string | null;
  live_at: Date | null;
  sales_close: Date;
  unit_price: bigint;
  refund_bps: number;
  budget: bigint;
}

async function campaignRow(campaignId: string): Promise<CampaignDbRow> {
  const [row] = await harness.db<CampaignDbRow[]>`
    select status, sale_state, onchain_id, slug, live_at, sales_close, unit_price, refund_bps, budget
    from campaigns where id = ${campaignId}
  `;
  if (row === undefined) throw new Error(`no campaign ${campaignId}`);
  return row;
}

function handler(): ReturnType<typeof createCampaignCreationHandler> {
  return createCampaignCreationHandler(harness.deps());
}

describe("campaign creation job", () => {
  it("puts a funded campaign live on-chain with its parameters, a slug and its budget", async () => {
    const symbol = await seedInstrument(harness, "happy");
    const merchant = await seedMerchant(harness, "Joe's Bar & Grill");
    const { campaignId, budgetPi, terms } = await seedFundedCampaign(harness, {
      merchantId: merchant.merchantId,
      symbol,
    });
    const before = await treasuryBalance(harness);
    const countBefore = await campaignCount(harness);

    await runHandler(harness, handler(), { campaignId });

    const row = await campaignRow(campaignId);
    expect(row.status).toBe("live");
    expect(row.sale_state).toBe("open");
    expect(row.live_at).not.toBeNull();
    expect(row.onchain_id).toBe(countBefore + 1n);
    expect(row.slug).toBe("joes-bar-and-grill-texas-wins");
    expect(slugSchema.safeParse(row.slug).success).toBe(true);

    const onchainId = row.onchain_id ?? 0n;
    const [user] = await harness.db<{ wallet: string | null; roles: string[] }[]>`
      select wallet, roles from users where id = ${merchant.userId}
    `;
    expect(user?.wallet).toMatch(/^0x[0-9a-f]{40}$/);
    expect(user?.roles).toEqual(["merchant"]);
    const [instrument] = await harness.db<{ onchain_id: string }[]>`
      select onchain_id from instruments where symbol = ${symbol}
    `;
    const onchain = await getCampaign(harness, onchainId);
    expect(onchain.merchant).toBe(checksum(user?.wallet ?? ""));
    expect(onchain.instrument).toBe(instrument?.onchain_id);
    expect(onchain.salesClose).toBe(BigInt(Math.floor(row.sales_close.getTime() / 1000)));
    expect(onchain.unitPrice).toBe(terms.unitPrice);
    expect(onchain.refundBps).toBe(terms.refundBps);
    expect(onchain.hedgeBudget).toBe(terms.budget);
    expect(onchain.status).toBe(0); // Live

    expect(before - (await treasuryBalance(harness))).toBe(terms.budget);
    expect(harness.gateway.effectsOf(budgetPi).refunds).toBe(0);

    // The public row exists and the receipt's events are processed.
    const [live] = await harness.db<{ sale_state: string }[]>`
      select sale_state from live_campaigns where slug = ${row.slug}
    `;
    expect(live?.sale_state).toBe("open");
    const unprocessed = await harness.db`
      select 1 from chain_events where name = 'CampaignCreated'
        and args ->> 'id' = ${onchainId.toString()} and processed_at is null
    `;
    expect(unprocessed).toHaveLength(0);
  });

  it("creates one on-chain campaign when the job runs twice, and twice at once", async () => {
    const symbol = await seedInstrument(harness, "twice");
    const { merchantId } = await seedMerchant(harness, "Twice Pub");
    const { campaignId } = await seedFundedCampaign(harness, { merchantId, symbol });
    const countBefore = await campaignCount(harness);

    const results = await Promise.allSettled([
      runHandler(harness, handler(), { campaignId }),
      runHandler(harness, handler(), { campaignId }),
    ]);
    for (const result of results) {
      if (result.status === "rejected") expect(result.reason).toBeInstanceOf(RetryLaterError);
    }
    await runHandler(harness, handler(), { campaignId });
    await runHandler(harness, handler(), { campaignId });

    expect(await campaignCount(harness)).toBe(countBefore + 1n);
    expect(await txRows(harness, `createCampaign:${campaignId}`)).toHaveLength(1);
    const row = await campaignRow(campaignId);
    expect(row.status).toBe("live");
    expect(row.onchain_id).toBe(countBefore + 1n);
  });

  it("retries a job that arrives before the budget payment succeeded, then creates", async () => {
    const symbol = await seedInstrument(harness, "early");
    const { merchantId } = await seedMerchant(harness, "Early Bar");
    const { campaignId, budgetPi } = await seedFundedCampaign(harness, {
      merchantId,
      symbol,
      budgetStatus: "processing",
    });

    await expect(runHandler(harness, handler(), { campaignId })).rejects.toBeInstanceOf(
      RetryLaterError,
    );
    expect((await campaignRow(campaignId)).status).toBe("funding");
    expect(await txRows(harness, `createCampaign:${campaignId}`)).toHaveLength(0);

    harness.gateway.setStatus(budgetPi, "succeeded");
    await runHandler(harness, handler(), { campaignId });
    expect((await campaignRow(campaignId)).status).toBe("live");
  });

  it("refunds the budget once and closes a campaign whose sales close has passed", async () => {
    const symbol = await seedInstrument(harness, "late");
    const { merchantId } = await seedMerchant(harness, "Late Bar");
    const { campaignId, budgetPi } = await seedFundedCampaign(harness, {
      merchantId,
      symbol,
      terms: { salesClose: new Date(harness.clock.chainNow() - 60_000) },
    });
    const countBefore = await campaignCount(harness);
    const before = await treasuryBalance(harness);

    await runHandler(harness, handler(), { campaignId });
    await runHandler(harness, handler(), { campaignId });

    const row = await campaignRow(campaignId);
    expect(row.status).toBe("closed");
    expect(row.onchain_id).toBeNull();
    expect(row.slug).toBeNull();
    expect(harness.gateway.effectsOf(budgetPi).refunds).toBe(1);
    expect(harness.gateway.wasRefunded(budgetPi)).toBe(true);
    expect(await campaignCount(harness)).toBe(countBefore);
    expect(await treasuryBalance(harness)).toBe(before);
    expect(await txRows(harness, `createCampaign:${campaignId}`)).toHaveLength(0);
    expect(logsAt(harness, 40, "campaign can never go live")).not.toHaveLength(0);
  });

  it("refunds and closes when the instrument is no longer listed", async () => {
    const symbol = await seedInstrument(harness, "delisted");
    const { merchantId } = await seedMerchant(harness, "Delisted Bar");
    const { campaignId, budgetPi } = await seedFundedCampaign(harness, { merchantId, symbol });
    await harness.db`update instruments set active = false where symbol = ${symbol}`;

    await runHandler(harness, handler(), { campaignId });

    expect((await campaignRow(campaignId)).status).toBe("closed");
    expect(harness.gateway.effectsOf(budgetPi).refunds).toBe(1);
  });

  it("refunds and closes when the escrow refuses the parameters (InvalidParams)", async () => {
    const symbol = await seedInstrument(harness, "refused");
    const { merchantId } = await seedMerchant(harness, "Refused Bar");
    // Sales closed a second ago by the chain's clock; the handler's clock runs ten minutes
    // behind, so it believes the campaign can still go live and sends it.
    const { campaignId, budgetPi } = await seedFundedCampaign(harness, {
      merchantId,
      symbol,
      terms: { salesClose: new Date(harness.clock.chainNow() - 1_000) },
    });
    const countBefore = await campaignCount(harness);
    harness.clock.skewMs = -600_000;
    try {
      await runHandler(harness, handler(), { campaignId });
    } finally {
      harness.clock.skewMs = 0;
    }

    const rows = await txRows(harness, `createCampaign:${campaignId}`);
    expect(rows.map((tx) => [tx.status, tx.last_error])).toEqual([["failed", "InvalidParams"]]);
    expect((await campaignRow(campaignId)).status).toBe("closed");
    expect(harness.gateway.effectsOf(budgetPi).refunds).toBe(1);
    expect(await campaignCount(harness)).toBe(countBefore);
  });

  it("retries a creation the treasury could not fund, and creates it once the treasury is topped up", async () => {
    const symbol = await seedInstrument(harness, "short");
    const { merchantId } = await seedMerchant(harness, "Short Bar");
    // More than the treasury holds: the simulation of createCampaignFor reverts in the token.
    const budget = 2_000_000n * USDC;
    const { campaignId, budgetPi } = await seedFundedCampaign(harness, {
      merchantId,
      symbol,
      terms: { budget },
    });
    const countBefore = await campaignCount(harness);

    await expect(runHandler(harness, handler(), { campaignId })).rejects.toBeInstanceOf(
      RetryLaterError,
    );
    const failed = await txRows(harness, `createCampaign:${campaignId}`);
    expect(failed.map((tx) => tx.status)).toEqual(["failed"]);
    expect((await campaignRow(campaignId)).status).toBe("funding");
    expect(harness.gateway.effectsOf(budgetPi).refunds).toBe(0);
    expect(
      logsAt(harness, 50, "campaign creation failed on-chain").filter(
        (entry) => entry.campaignId === campaignId,
      ),
    ).toHaveLength(1);

    // Someone tops the treasury up; the next run sends a new attempt, which goes through.
    await harness.escrow.mint(harness.escrow.accounts.treasury.address, budget);
    await runHandler(harness, handler(), { campaignId });

    const rows = await txRows(harness, `createCampaign:${campaignId}`);
    expect(rows.map((tx) => [tx.idempotency_key, tx.status])).toEqual([
      [`createCampaign:${campaignId}`, "failed"],
      [`createCampaign:${campaignId}:2`, "mined"],
    ]);
    const row = await campaignRow(campaignId);
    expect(row.status).toBe("live");
    expect(row.onchain_id).toBe(countBefore + 1n);
    expect((await getCampaign(harness, countBefore + 1n)).hedgeBudget).toBe(budget);
    expect(harness.gateway.effectsOf(budgetPi).refunds).toBe(0);
  });

  it("refunds once and closes a creation the treasury still cannot fund when sales close passes", async () => {
    const symbol = await seedInstrument(harness, "never-funded");
    const { merchantId } = await seedMerchant(harness, "Never Funded Bar");
    const { campaignId, budgetPi } = await seedFundedCampaign(harness, {
      merchantId,
      symbol,
      terms: { budget: 1_000_000_000n * USDC },
    });
    const countBefore = await campaignCount(harness);

    await expect(runHandler(harness, handler(), { campaignId })).rejects.toBeInstanceOf(
      RetryLaterError,
    );
    // Still short when the retries reach sales close (two days later by the handler's clock).
    harness.clock.skewMs = 3 * 24 * 3_600_000;
    try {
      await runHandler(harness, handler(), { campaignId });
      await runHandler(harness, handler(), { campaignId });
    } finally {
      harness.clock.skewMs = 0;
    }

    expect((await campaignRow(campaignId)).status).toBe("closed");
    expect(harness.gateway.effectsOf(budgetPi).refunds).toBe(1);
    expect(await campaignCount(harness)).toBe(countBefore);
    expect((await txRows(harness, `createCampaign:${campaignId}`)).map((tx) => tx.status)).toEqual([
      "failed",
    ]);
  });

  it("gives a colliding slug a numeric suffix", async () => {
    const first = await seedInstrument(harness, "slug-a");
    const second = await seedInstrument(harness, "slug-b");
    const a = await seedMerchant(harness, "Slug Saloon");
    const b = await seedMerchant(harness, "Slug Saloon");
    const one = await seedFundedCampaign(harness, { merchantId: a.merchantId, symbol: first });
    const two = await seedFundedCampaign(harness, { merchantId: b.merchantId, symbol: second });

    await runHandler(harness, handler(), { campaignId: one.campaignId });
    await runHandler(harness, handler(), { campaignId: two.campaignId });

    expect((await campaignRow(one.campaignId)).slug).toBe("slug-saloon-texas-wins");
    expect((await campaignRow(two.campaignId)).slug).toBe("slug-saloon-texas-wins-2");
  });

  it("refuses a budget payment that does not pay this campaign", async () => {
    const symbol = await seedInstrument(harness, "mismatch");
    const { merchantId } = await seedMerchant(harness, "Mismatch Bar");
    const { campaignId, budgetPi } = await seedFundedCampaign(harness, { merchantId, symbol });
    const intent = harness.gateway.intent(budgetPi);
    if (intent === undefined) throw new Error("no intent");
    harness.gateway.setIntent({ ...intent, amount: intent.amount - 1n });

    await expect(runHandler(harness, handler(), { campaignId })).rejects.toThrow(
      /amount is not the campaign budget/,
    );
    expect((await campaignRow(campaignId)).status).toBe("funding");
    expect(await txRows(harness, `createCampaign:${campaignId}`)).toHaveLength(0);
  });
});
