/**
 * Crash safety of the settlement watcher: the watcher (and its transaction sender) is stopped
 * after each step in turn, as a crashed process would be, then a new watcher and a new sender
 * start on the same database and chain. The final state must be the one of an uninterrupted run,
 * and no step may have run twice on-chain: the escrow's own logs are counted.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  allocateLot,
  buyerAddress,
  createSettlementEnv,
  eventCounts,
  FakeHedgeFinalizer,
  HOUR,
  setInstrumentOutcome,
  stepRecorder,
  SYMBOL,
  tokenBalance,
  USDC,
  waitFor,
  waitForIdleOutbox,
  type SettlementEnv,
} from "./test-support";
import type { SettlementStep } from "./types";

const UNIT_PRICE = 10n * USDC;
const REFUNDABLE = 5n * USDC;
const BUDGET = 100n * USDC;
const LOT_COSTS = [300_000n, 400_000n, 500_000n];
const HEDGE_SPENT = LOT_COSTS.reduce((sum, cost) => sum + cost, 0n);
const EXPOSURE = REFUNDABLE * BigInt(LOT_COSTS.length);

class InjectedCrash extends Error {
  constructor(at: string) {
    super(`injected crash after ${at}`);
    this.name = "InjectedCrash";
  }
}

const CRASH_POINTS: { step: SettlementStep; phase: "enqueued" | "done" }[] = [
  { step: "finalize", phase: "done" },
  { step: "charge", phase: "enqueued" },
  { step: "charge", phase: "done" },
  { step: "settle", phase: "enqueued" },
  { step: "settle", phase: "done" },
  { step: "refund", phase: "enqueued" },
  { step: "refund", phase: "done" },
  { step: "pay-merchant", phase: "enqueued" },
  { step: "pay-merchant", phase: "done" },
  { step: "release", phase: "enqueued" },
  { step: "release", phase: "done" },
];

let current: SettlementEnv | undefined;

afterEach(async () => {
  await current?.close();
  current = undefined;
});

describe("a watcher stopped after each step, then restarted", () => {
  it.each(CRASH_POINTS)(
    "ends in the same state with every step run once on-chain: crash after $step $phase",
    async ({ step, phase }) => {
      const t = await createSettlementEnv();
      current = t;
      const buyers = LOT_COSTS.map((_, index) => buyerAddress(index + 1));
      const campaign = await t.createCampaign({ buyers, unitPrice: UNIT_PRICE, budget: BUDGET });
      for (const [index, ticketId] of campaign.ticketIds.entries()) {
        await allocateLot(t.db, ticketId, LOT_COSTS[index] ?? 0n, USDC);
      }
      await t.env.advanceTime(HOUR + 1n);
      await setInstrumentOutcome(t.db, SYMBOL, "yes");
      const merchantBefore = await tokenBalance(t.env, t.env.accounts.merchant.address);
      const finalizer = new FakeHedgeFinalizer();

      // First process: crashes right after the chosen step.
      const firstSender = await t.startSender();
      let crashed = false;
      const recorder = stepRecorder((event) => {
        if (event.step === step && event.phase === phase && !crashed) {
          crashed = true;
          first.controller.abort();
          throw new InjectedCrash(`${step} ${phase}`);
        }
      });
      const first = t.startWatcher({
        txSender: firstSender,
        hedgeFinalizer: finalizer,
        onStep: recorder.onStep,
      });
      await waitFor(async () => crashed, `the crash after ${step} ${phase}`, 20_000);
      await first.settlement.stopped;
      await firstSender.stop();

      // Second process, same database and chain.
      const secondSender = await t.startSender();
      t.startWatcher({ txSender: secondSender, hedgeFinalizer: finalizer });
      await waitFor(async () => {
        const onchain = await t.driver.getCampaign(campaign.onchainId);
        return (
          onchain.status === 2 &&
          onchain.released &&
          onchain.merchantDue === 0n &&
          onchain.lockedRefunds === 0n
        );
      }, "the restarted watcher to finish the campaign");
      // The chain can be final a moment before the sender has recorded the last receipt.
      await waitForIdleOutbox(t.db);

      // The same final state as an uninterrupted run.
      for (const buyer of buyers) expect(await tokenBalance(t.env, buyer)).toBe(REFUNDABLE);
      expect(await tokenBalance(t.env, t.env.accounts.merchant.address)).toBe(
        merchantBefore + EXPOSURE + (BUDGET - HEDGE_SPENT),
      );
      expect(await tokenBalance(t.env, t.env.escrow)).toBe(0n);
      expect((await t.driver.getCampaign(campaign.onchainId)).hedgeSpent).toBe(HEDGE_SPENT);

      // Every step ran once on-chain, counted from the escrow's logs.
      const charged = await eventCounts(t.env, "HedgeCharged");
      const refunded = await eventCounts(t.env, "TicketRefunded");
      for (const ticketId of campaign.ticketIds) {
        expect(charged.get(ticketId), `HedgeCharged of ticket ${ticketId.toString()}`).toBe(1);
        expect(refunded.get(ticketId), `TicketRefunded of ticket ${ticketId.toString()}`).toBe(1);
      }
      expect((await eventCounts(t.env, "CampaignSettled")).get(campaign.onchainId)).toBe(1);
      expect((await eventCounts(t.env, "MerchantPaid")).get(campaign.onchainId)).toBe(1);
      expect((await eventCounts(t.env, "CampaignReleased")).get(campaign.onchainId)).toBe(1);
      expect((await eventCounts(t.env, "RefundFailed")).size).toBe(0);

      // And one transaction per step: nothing was sent twice, nothing reverted or failed.
      const rows = await t.db<{ kind: string; status: string }[]>`
        select kind, status from chain_txs where idempotency_key like 'settlement:%'
      `;
      for (const row of rows) expect(row.status).toBe("mined");
      expect(rows.map((row) => row.kind).sort()).toEqual([
        "chargeHedge",
        "payMerchant",
        "refundBatch",
        "release",
        "settle",
      ]);
    },
    60_000,
  );
});
