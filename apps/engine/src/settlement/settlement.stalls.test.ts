/**
 * What must never stall the watcher: a hedge finalizer that never answers, a campaign run that
 * hangs, and a `settle` already in the outbox when the known result changes. The contract, the
 * transaction sender and the projection are real.
 */
import { afterEach, describe, expect, it } from "vitest";
import { encodeFunctionData } from "viem";

import { winzEscrowAbi } from "@winz/shared";

import { campaignKeyPrefix, ESCROW_STATUS } from "./plan";
import {
  buyerAddress,
  createSettlementEnv,
  errorLogs,
  eventCounts,
  FakeHedgeFinalizer,
  forceResult,
  HOUR,
  OTHER_SYMBOL,
  projectedLots,
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

/** Resolves with "stopped", or with "still running" when `stopped` takes longer than `ms`. */
async function stopsWithin(stopped: Promise<void>, ms: number): Promise<string> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve("still running"), ms);
  });
  try {
    return await Promise.race([stopped.then(() => "stopped"), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** Never settles. */
function never(): Promise<void> {
  return new Promise<void>(() => undefined);
}

describe("a hedge finalizer that never answers", () => {
  it("does not hold the other campaigns: a campaign decided later is settled, and the hanging one goes to the safety net after timeouts", async () => {
    const t = await freshEnv();
    const hanging = await t.createCampaign({ buyers: [buyerAddress(1)], budget: BUDGET });
    const later = await t.createCampaign({
      symbol: OTHER_SYMBOL,
      buyers: [buyerAddress(2)],
      budget: BUDGET,
    });
    const sender = await t.startSender();
    await t.env.advanceTime(HOUR + 1n);
    await setInstrumentOutcome(t.db, SYMBOL, "no");
    const finalizer = new FakeHedgeFinalizer(async (campaign) => {
      if (campaign.onchainId === hanging.onchainId) await never();
    });
    const { settlement, controller } = t.startWatcher({
      txSender: sender,
      hedgeFinalizer: finalizer,
      finalizeTimeoutMs: 300,
      finalizeFailuresBeforeSafetyNet: 2,
    });
    // The other game is decided once the watcher is already stuck in the first finalizer call.
    await waitFor(async () => finalizer.calls.length >= 1, "the first finalizer call");
    await setInstrumentOutcome(t.db, OTHER_SYMBOL, "no");

    await waitFor(
      async () => (await t.driver.getCampaign(later.onchainId)).released,
      "the campaign decided later to be settled and released",
    );
    await waitFor(
      async () => (await t.driver.getCampaign(hanging.onchainId)).released,
      "the campaign whose finalizer hangs to be settled by the safety net",
    );
    expect((await t.driver.getCampaign(hanging.onchainId)).status).toBe(ESCROW_STATUS.settledNo);
    // A call still pending is never doubled: the finalizer was called once for that campaign.
    expect(finalizer.calls.filter((call) => call.onchainId === hanging.onchainId)).toHaveLength(1);
    const timedOut = errorLogs(t.logs, "the hedge finalizer failed");
    expect(timedOut.length).toBeGreaterThanOrEqual(1);
    expect(timedOut[0]).toMatchObject({
      campaignId: hanging.id,
      step: "finalize",
      error: {
        type: "FinalizeTimeoutError",
        message: expect.stringContaining("did not answer within 300 ms") as unknown,
      },
    });
    expect(errorLogs(t.logs, "the hedge finalizer keeps failing").length).toBeGreaterThanOrEqual(1);

    controller.abort();
    expect(await stopsWithin(settlement.stopped, 3_000)).toBe("stopped");
  });

  it("does not hold the watcher's stop", async () => {
    const t = await freshEnv();
    await t.createCampaign({ buyers: [buyerAddress(1)], budget: BUDGET });
    const sender = await t.startSender();
    await t.env.advanceTime(HOUR + 1n);
    await setInstrumentOutcome(t.db, SYMBOL, "yes");
    const finalizer = new FakeHedgeFinalizer(never);
    const { settlement, controller } = t.startWatcher({
      txSender: sender,
      hedgeFinalizer: finalizer,
      finalizeTimeoutMs: 600_000,
    });
    await waitFor(async () => finalizer.calls.length >= 1, "the finalizer to be called");
    controller.abort();
    expect(await stopsWithin(settlement.stopped, 3_000)).toBe("stopped");
  });
});

describe("a campaign run that hangs", () => {
  it("holds one slot, not the passes: a campaign decided later is still settled", async () => {
    const t = await freshEnv();
    const stuck = await t.createCampaign({ buyers: [buyerAddress(1)], budget: BUDGET });
    const later = await t.createCampaign({
      symbol: OTHER_SYMBOL,
      buyers: [buyerAddress(2)],
      budget: BUDGET,
    });
    const sender = await t.startSender();
    await t.env.advanceTime(HOUR + 1n);
    await setInstrumentOutcome(t.db, SYMBOL, "no");
    let unblock: () => void = () => undefined;
    const blocked = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    let stuckSeen = false;
    t.startWatcher({
      txSender: sender,
      hedgeFinalizer: new FakeHedgeFinalizer(),
      // Hangs the run of one campaign after its finalizer, where no abort reaches it.
      onStep: async (event) => {
        if (event.campaignId === stuck.id && event.step === "finalize") {
          stuckSeen = true;
          await blocked;
        }
      },
    });
    try {
      await waitFor(async () => stuckSeen, "the stuck campaign's run to hang");
      await setInstrumentOutcome(t.db, OTHER_SYMBOL, "no");
      await waitFor(
        async () => (await t.driver.getCampaign(later.onchainId)).released,
        "the campaign decided later to be settled while the other run hangs",
      );
      expect((await t.driver.getCampaign(stuck.onchainId)).status).toBe(ESCROW_STATUS.live);
    } finally {
      unblock();
    }
  });
});

describe("a settle already in the outbox", () => {
  it("is waited for, never doubled by a settle on a result that changed meanwhile", async () => {
    const t = await freshEnv();
    const campaign = await t.createCampaign({ buyers: [buyerAddress(1)], budget: BUDGET });
    // Charged by the hedging lane already: nothing for the safety net to send.
    await t.driver.chargeHedge(campaign.ticketIds, [0n]);
    await waitFor(
      async () =>
        (await projectedLots(t.db, campaign.id)).get(campaign.ticketIds[0] ?? 0n)?.charged === true,
      "the charge to be projected",
    );
    await t.env.advanceTime(HOUR + 1n);
    // A previous watcher queued settle on a forced NO; the sender has not sent it yet.
    const sender = t.createSender();
    const prefix = campaignKeyPrefix(t.env.escrow, campaign.onchainId);
    await sender.enqueue({
      idempotencyKey: `${prefix}:settle:no:a1`,
      signer: "oracle",
      kind: "settle",
      to: t.env.escrow,
      data: encodeFunctionData({
        abi: winzEscrowAbi,
        functionName: "settle",
        args: [campaign.onchainId, 1],
      }),
    });
    // The forced result changes before it is mined.
    await forceResult(t.db, SYMBOL, "yes");
    const finalizer = new FakeHedgeFinalizer();
    t.startWatcher({ txSender: sender, hedgeFinalizer: finalizer, txWaitTimeoutMs: 200 });
    await waitFor(async () => finalizer.calls.length >= 3, "a few passes of the watcher");
    const settles = async (): Promise<string[]> =>
      (
        await t.db<{ idempotency_key: string }[]>`
          select idempotency_key from chain_txs where kind = 'settle' order by created_at
        `
      ).map((row) => row.idempotency_key);
    expect(await settles()).toEqual([`${prefix}:settle:no:a1`]);

    await sender.start();
    await waitFor(
      async () => (await t.driver.getCampaign(campaign.onchainId)).released,
      "the campaign to be settled and released",
    );
    expect(await settles()).toEqual([`${prefix}:settle:no:a1`]);
    expect((await eventCounts(t.env, "CampaignSettled")).get(campaign.onchainId)).toBe(1);
    // The chain's result stands, and the difference is logged.
    expect((await t.driver.getCampaign(campaign.onchainId)).status).toBe(ESCROW_STATUS.settledNo);
    expect(
      t.logs.some(
        (entry) =>
          typeof entry.msg === "string" &&
          entry.msg.includes("settled on-chain with another result"),
      ),
    ).toBe(true);
  });
});
