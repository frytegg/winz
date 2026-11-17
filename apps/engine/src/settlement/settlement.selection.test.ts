/**
 * Which campaigns the watcher settles, and when it must not: a forced demo result, sales still
 * open, no result yet, and the emergency window (brief R-01 / R-02).
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  buyerAddress,
  createSettlementEnv,
  EMERGENCY_DELAY,
  errorLogs,
  eventCounts,
  FakeHedgeFinalizer,
  forceResult,
  HOUR,
  OTHER_SYMBOL,
  setInstrumentOutcome,
  SYMBOL,
  USDC,
  waitFor,
  type SettlementEnv,
} from "./test-support";

const BUDGET = 100n * USDC;

let current: SettlementEnv | undefined;

afterEach(async () => {
  await current?.close();
  current = undefined;
});

async function freshEnv(): Promise<SettlementEnv> {
  current = await createSettlementEnv();
  return current;
}

async function settlementTxs(t: SettlementEnv): Promise<{ kind: string; payload: unknown }[]> {
  return t.db<{ kind: string; payload: unknown }[]>`
    select kind, payload from chain_txs where idempotency_key like 'settlement:%'
  `;
}

describe("demo mode", () => {
  it("settles on a forced result, which wins over Gemini's, and marks the campaign demo", async () => {
    const t = await freshEnv();
    // No real result on this instrument: the forced one alone settles it.
    const noResult = await t.createCampaign({ buyers: [buyerAddress(1)], budget: BUDGET });
    // A real YES on this one, forced to NO: the forced value wins.
    const overridden = await t.createCampaign({
      symbol: OTHER_SYMBOL,
      buyers: [buyerAddress(2)],
      budget: BUDGET,
    });
    // A third campaign on the overridden instrument's real result would be YES without the
    // override; the override applies to every campaign of the instrument.
    await setInstrumentOutcome(t.db, OTHER_SYMBOL, "yes");
    await forceResult(t.db, SYMBOL, "void");
    await forceResult(t.db, OTHER_SYMBOL, "no");
    const sender = await t.startSender();
    await t.env.advanceTime(HOUR + 1n);
    const finalizer = new FakeHedgeFinalizer();
    t.startWatcher({ txSender: sender, hedgeFinalizer: finalizer });

    await waitFor(async () => {
      const [a, b] = await Promise.all([
        t.driver.getCampaign(noResult.onchainId),
        t.driver.getCampaign(overridden.onchainId),
      ]);
      return a.released && a.merchantDue === 0n && b.released;
    }, "both campaigns settled and released");
    expect((await t.driver.getCampaign(noResult.onchainId)).status).toBe(4); // Void
    expect((await t.driver.getCampaign(overridden.onchainId)).status).toBe(3); // SettledNo
    expect((await eventCounts(t.env, "TicketRefunded")).size).toBe(0);

    const rows = await t.db<{ id: string; demo: boolean }[]>`select id, demo from campaigns`;
    expect(rows.find((row) => row.id === noResult.id)?.demo).toBe(true);
    expect(rows.find((row) => row.id === overridden.id)?.demo).toBe(true);
    const settles = (await settlementTxs(t)).filter((row) => row.kind === "settle");
    expect(settles.map((row) => row.payload)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ outcome: "void", forced: true }),
        expect.objectContaining({ outcome: "no", forced: true }),
      ]),
    );
    expect(finalizer.calls.every((call) => call.forced)).toBe(true);
  });
});

describe("campaigns that must be left alone", () => {
  it("does nothing for a campaign whose sales are still open or whose instrument has no result", async () => {
    const t = await freshEnv();
    const salesOpen = await t.createCampaign({
      buyers: [buyerAddress(1)],
      budget: BUDGET,
      salesCloseInSeconds: 10n * HOUR,
    });
    const noResult = await t.createCampaign({
      symbol: OTHER_SYMBOL,
      buyers: [buyerAddress(2)],
      budget: BUDGET,
      salesCloseInSeconds: HOUR,
    });
    await setInstrumentOutcome(t.db, SYMBOL, "yes");
    await t.env.advanceTime(HOUR + 1n);
    const sender = await t.startSender();
    const finalizer = new FakeHedgeFinalizer();
    const { settlement } = t.startWatcher({ txSender: sender, hedgeFinalizer: finalizer });

    // Several passes run (interval 100 ms) without touching either campaign.
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(await settlementTxs(t)).toEqual([]);
    expect(finalizer.calls).toEqual([]);

    // Asked directly, the watcher still refuses: the chain says the sales are open, the database
    // has no result.
    const open = await settlement.settleCampaignNow(salesOpen.id);
    expect(open).toMatchObject({ status: "not-ready", detail: "sales are still open on-chain" });
    const unknown = await settlement.settleCampaignNow(noResult.id);
    expect(unknown).toMatchObject({ status: "not-ready" });
    expect(await settlementTxs(t)).toEqual([]);
    expect(finalizer.calls).toEqual([]);
    expect((await t.driver.getCampaign(salesOpen.onchainId)).status).toBe(0);
    expect((await t.driver.getCampaign(noResult.onchainId)).status).toBe(0);
    await expect(
      settlement.settleCampaignNow("00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow("does not exist");
  });
});

describe("the emergency window", () => {
  it("never attempts settle once the emergency window is open, and says so at error level", async () => {
    const t = await freshEnv();
    const campaign = await t.createCampaign({ buyers: [buyerAddress(1)], budget: BUDGET });
    await t.env.advanceTime(HOUR + EMERGENCY_DELAY + 1n);
    await setInstrumentOutcome(t.db, SYMBOL, "yes");
    const sender = await t.startSender();
    const finalizer = new FakeHedgeFinalizer();
    const { settlement } = t.startWatcher({ txSender: sender, hedgeFinalizer: finalizer });

    await waitFor(
      async () => errorLogs(t.logs, "the emergency window is open").length > 0,
      "the emergency to be reported",
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await settlementTxs(t)).toEqual([]);
    expect(finalizer.calls).toEqual([]);
    const result = await settlement.settleCampaignNow(campaign.id);
    expect(result.status).toBe("emergency");
    expect(await settlementTxs(t)).toEqual([]);
    // Reported once, not at every pass.
    const reports = errorLogs(t.logs, "the emergency window is open");
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ step: "settle", onchainId: campaign.onchainId.toString() });
    expect((await t.driver.getCampaign(campaign.onchainId)).status).toBe(0);
  });
});
