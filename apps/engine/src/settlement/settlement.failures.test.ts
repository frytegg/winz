/**
 * What goes wrong around a settlement (brief R-02, SPEC EC-7): tickets the hedging never charged,
 * a buyer blocked on the token, a treasury that cannot pay, a hedging lane or a node that fails,
 * and a transaction that reverts every time. The contract is real, so is every transaction.
 */
import { afterEach, describe, expect, it } from "vitest";
import { encodeFunctionData, maxUint256, type Address } from "viem";

import { winzEscrowAbi } from "@winz/shared";

import type { TxRequest } from "../chain";
import type { SettlementReadClient, SettlementTxSender } from "./types";
import {
  allocateLot,
  buyerAddress,
  chargeThroughSender,
  createSettlementEnv,
  errorLogs,
  escrowEvents,
  eventCounts,
  FakeHedgeFinalizer,
  HOUR,
  projectedLots,
  setInstrumentOutcome,
  setTreasuryAllowance,
  SYMBOL,
  OTHER_SYMBOL,
  tokenBalance,
  USDC,
  waitFor,
  waitForIdleOutbox,
  type SettlementEnv,
} from "./test-support";

const UNIT_PRICE = 10n * USDC;
const REFUNDABLE = 5n * USDC;
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

/** The `HedgeCharged` amounts of the chain, by ticket id, with how many times each was charged. */
async function hedgeCharges(t: SettlementEnv): Promise<Map<bigint, bigint[]>> {
  const charges = new Map<bigint, bigint[]>();
  for (const event of await escrowEvents(t.env)) {
    if (event.eventName !== "HedgeCharged") continue;
    const { ticketId, amount } = event.args as { ticketId: bigint; amount: bigint };
    charges.set(ticketId, [...(charges.get(ticketId) ?? []), amount]);
  }
  return charges;
}

describe("the hedge safety net", () => {
  it("charges what the hedging left uncharged: the lot cost capped at the guarantee, zero (logged) when never allocated", async () => {
    const t = await freshEnv();
    const guarantees = [USDC, USDC, USDC, 0n, USDC];
    const campaign = await t.createCampaign({
      buyers: guarantees.map((_, index) => buyerAddress(index + 1)),
      unitPrice: UNIT_PRICE,
      budget: BUDGET,
      maxHedgeCost: (index) => guarantees[index] ?? 0n,
    });
    const [t1, t2, t3, t4, t5] = campaign.ticketIds as [bigint, bigint, bigint, bigint, bigint];
    // The hedging lane allocated two lots and charged a third one itself; nothing else.
    await allocateLot(t.db, t1, 300_000n, 1_000_000n);
    await allocateLot(t.db, t2, 1_500_000n, 1_000_000n);
    const sender = await t.startSender();
    await chargeThroughSender(sender, t.env, "hedging-lane:t5", [t5], [200_000n]);
    await waitFor(
      async () => (await projectedLots(t.db, campaign.id)).get(t5)?.charged === true,
      "t5 projected",
    );

    await t.env.advanceTime(HOUR + 1n);
    await setInstrumentOutcome(t.db, SYMBOL, "yes");
    const finalizer = new FakeHedgeFinalizer();
    t.startWatcher({ txSender: sender, hedgeFinalizer: finalizer });
    await waitFor(async () => {
      const onchain = await t.driver.getCampaign(campaign.onchainId);
      return onchain.released && onchain.merchantDue === 0n && onchain.lockedRefunds === 0n;
    }, "the campaign to be finished");

    const charges = await hedgeCharges(t);
    expect(charges.get(t1)).toEqual([300_000n]);
    expect(charges.get(t2)).toEqual([USDC]); // 1.5 USDC of cost, capped at the guarantee
    expect(charges.get(t3)).toEqual([0n]); // lot never allocated
    expect(charges.get(t4)).toEqual([0n]); // zero guarantee, never allocated
    expect(charges.get(t5)).toEqual([200_000n]); // charged by the hedging lane, not again
    expect((await t.driver.getCampaign(campaign.onchainId)).hedgeSpent).toBe(1_500_000n);
    expect(finalizer.calls.length).toBeGreaterThanOrEqual(1);

    const zeroCharges = errorLogs(t.logs, "hedge never allocated");
    expect(zeroCharges.map((entry) => entry.ticketId).sort()).toEqual([
      t3.toString(),
      t4.toString(),
    ]);
    for (const entry of zeroCharges) {
      expect(entry).toMatchObject({ step: "charge", onchainId: campaign.onchainId.toString() });
    }

    // At most 50 tickets per chargeHedge, all sent by the oracle.
    const sent = await t.db<{ signer: string; payload: { ticketIds: string[] } }[]>`
      select signer, payload from chain_txs where kind = 'chargeHedge' and idempotency_key like 'settlement:%'
    `;
    expect(sent).toHaveLength(1);
    expect(sent[0]?.signer).toBe("oracle");
    expect(sent[0]?.payload.ticketIds).toEqual([t1, t2, t3, t4].map(String));
  });
});

describe("a refund that fails (EC-7)", () => {
  it("refunds the others, pays the merchant and releases; the blocked ticket stays owed and is refunded once after unblocking", async () => {
    const t = await freshEnv();
    const buyers = [buyerAddress(1), buyerAddress(2), buyerAddress(3)];
    const campaign = await t.createCampaign({ buyers, unitPrice: UNIT_PRICE, budget: BUDGET });
    const [t1, t2, t3] = campaign.ticketIds as [bigint, bigint, bigint];
    const blocked = buyers[1] as Address;
    await t.driver.setBlocked(blocked, true);

    const sender = await t.startSender();
    await t.env.advanceTime(HOUR + 1n);
    await setInstrumentOutcome(t.db, SYMBOL, "yes");
    const merchantBefore = await tokenBalance(t.env, t.env.accounts.merchant.address);
    const { settlement } = t.startWatcher({
      txSender: sender,
      hedgeFinalizer: new FakeHedgeFinalizer(),
    });

    await waitFor(async () => {
      const onchain = await t.driver.getCampaign(campaign.onchainId);
      const failed = await eventCounts(t.env, "RefundFailed");
      return onchain.released && onchain.merchantDue === 0n && (failed.get(t2) ?? 0) >= 1;
    }, "the others refunded, the merchant paid and the campaign released");

    const refunded = await eventCounts(t.env, "TicketRefunded");
    expect(refunded.get(t1)).toBe(1);
    expect(refunded.get(t3)).toBe(1);
    expect(refunded.get(t2)).toBeUndefined();
    expect((await t.driver.getTicket(t2)).paidOut).toBe(false);
    expect((await t.driver.getCampaign(campaign.onchainId)).lockedRefunds).toBe(REFUNDABLE);
    expect(await tokenBalance(t.env, blocked)).toBe(0n);
    // The merchant got its exposure (all three tickets) and the whole budget (nothing charged).
    expect(await tokenBalance(t.env, t.env.accounts.merchant.address)).toBe(
      merchantBefore + 3n * REFUNDABLE + BUDGET,
    );
    const result = await settlement.settleCampaignNow(campaign.id);
    expect(result.status).toBe("finished");
    expect(result.owedTickets).toEqual([t2]);
    expect(errorLogs(t.logs, "refund transfer failed").length).toBeGreaterThanOrEqual(1);

    await t.driver.setBlocked(blocked, false);
    await waitFor(
      async () => (await t.driver.getTicket(t2)).paidOut,
      "the blocked ticket to be refunded after unblocking",
    );
    expect((await eventCounts(t.env, "TicketRefunded")).get(t2)).toBe(1);
    expect(await tokenBalance(t.env, blocked)).toBe(REFUNDABLE);
    expect((await t.driver.getCampaign(campaign.onchainId)).lockedRefunds).toBe(0n);
    await waitFor(async () => {
      const [row] = await t.db<{ status: string }[]>`
        select status from tickets where onchain_id = ${t2.toString()}::bigint
      `;
      return row?.status === "refunded";
    }, "the projection to mark the ticket refunded");
    // Refunds came from the relayer, and every batch was mined.
    await waitForIdleOutbox(t.db);
    const refunds = await t.db<{ signer: string; status: string }[]>`
      select signer, status from chain_txs where kind = 'refundBatch'
    `;
    for (const row of refunds) expect(row).toEqual({ signer: "relayer", status: "mined" });
  });
});

describe("a treasury that cannot pay", () => {
  it("lets refunds and release happen, and pays the merchant on a later pass once funded", async () => {
    const t = await freshEnv();
    const buyers = [buyerAddress(1), buyerAddress(2)];
    const campaign = await t.createCampaign({ buyers, unitPrice: UNIT_PRICE, budget: BUDGET });
    await setTreasuryAllowance(t.env, 0n);

    const sender = await t.startSender();
    await t.env.advanceTime(HOUR + 1n);
    await setInstrumentOutcome(t.db, SYMBOL, "yes");
    const merchantBefore = await tokenBalance(t.env, t.env.accounts.merchant.address);
    t.startWatcher({ txSender: sender, hedgeFinalizer: new FakeHedgeFinalizer() });

    await waitFor(async () => {
      const onchain = await t.driver.getCampaign(campaign.onchainId);
      return onchain.released && onchain.lockedRefunds === 0n;
    }, "refunds and release");
    await waitFor(
      async () => errorLogs(t.logs, "the treasury cannot pay the merchant").length >= 2,
      "payMerchant to be retried at least once",
    );
    const onchain = await t.driver.getCampaign(campaign.onchainId);
    expect(onchain.merchantDue).toBe(2n * REFUNDABLE);
    expect((await eventCounts(t.env, "MerchantPaid")).size).toBe(0);
    // Checked before sending: an empty treasury costs no transaction and no attempt.
    const [pays] = await t.db<{ n: bigint }[]>`
      select count(*) as n from chain_txs where kind = 'payMerchant'
    `;
    expect(pays?.n).toBe(0n);
    expect(errorLogs(t.logs, "the treasury cannot pay the merchant")[0]).toMatchObject({
      step: "pay-merchant",
      due: (2n * REFUNDABLE).toString(),
      allowance: "0",
    });

    await setTreasuryAllowance(t.env, maxUint256);
    await waitFor(
      async () => (await t.driver.getCampaign(campaign.onchainId)).merchantDue === 0n,
      "payMerchant once the treasury is funded",
    );
    expect((await eventCounts(t.env, "MerchantPaid")).get(campaign.onchainId)).toBe(1);
    expect(await tokenBalance(t.env, t.env.accounts.merchant.address)).toBe(
      merchantBefore + 2n * REFUNDABLE + BUDGET,
    );
  });
});

describe("robustness", () => {
  it("keeps settling the other campaigns while one hedge finalizer fails, then lets the safety net take over", async () => {
    const t = await freshEnv();
    const failing = await t.createCampaign({ buyers: [buyerAddress(1)], budget: BUDGET });
    const healthy = await t.createCampaign({
      symbol: OTHER_SYMBOL,
      buyers: [buyerAddress(2)],
      budget: BUDGET,
    });
    const sender = await t.startSender();
    await t.env.advanceTime(HOUR + 1n);
    await setInstrumentOutcome(t.db, SYMBOL, "no");
    await setInstrumentOutcome(t.db, OTHER_SYMBOL, "no");
    const finalizer = new FakeHedgeFinalizer(async (campaign) => {
      if (campaign.onchainId === failing.onchainId) throw new Error("hedging lane is down");
    });
    t.startWatcher({
      txSender: sender,
      hedgeFinalizer: finalizer,
      finalizeFailuresBeforeSafetyNet: 3,
    });

    await waitFor(
      async () => (await t.driver.getCampaign(healthy.onchainId)).released,
      "the healthy campaign to be settled and released",
    );
    await waitFor(
      async () => (await t.driver.getCampaign(failing.onchainId)).released,
      "the failing campaign to be settled by the safety net",
    );
    const failingCalls = finalizer.calls.filter((call) => call.onchainId === failing.onchainId);
    expect(failingCalls.length).toBeGreaterThanOrEqual(3);
    expect(errorLogs(t.logs, "the hedge finalizer failed").length).toBe(2);
    expect(errorLogs(t.logs, "the hedge finalizer keeps failing").length).toBeGreaterThanOrEqual(1);
  });

  it("retries a node outage with backoff and finishes once the node answers again", async () => {
    const t = await freshEnv();
    const campaign = await t.createCampaign({ buyers: [buyerAddress(1)], budget: BUDGET });
    const sender = await t.startSender();
    await t.env.advanceTime(HOUR + 1n);
    await setInstrumentOutcome(t.db, SYMBOL, "yes");
    let down = true;
    let refused = 0;
    const flaky: SettlementReadClient = {
      call: async (request) => {
        if (down) {
          refused += 1;
          throw new Error("fetch failed: connect ECONNREFUSED 127.0.0.1");
        }
        return t.env.publicClient.call(request);
      },
      getBlock: (request) => t.env.publicClient.getBlock(request),
    };
    t.startWatcher({
      txSender: sender,
      hedgeFinalizer: new FakeHedgeFinalizer(),
      publicClient: flaky,
    });
    await waitFor(async () => refused >= 3, "the watcher to retry the unreachable node");
    expect((await t.driver.getCampaign(campaign.onchainId)).status).toBe(0);
    expect(
      errorLogs(t.logs, "campaign settlement failed, retried with backoff").length,
    ).toBeGreaterThanOrEqual(2);
    down = false;
    await waitFor(async () => {
      const onchain = await t.driver.getCampaign(campaign.onchainId);
      return onchain.released && onchain.lockedRefunds === 0n && onchain.merchantDue === 0n;
    }, "the campaign to be finished after the outage");
  });

  it("gives a transaction that always reverts up after a bounded number of attempts, naming the campaign, the step and the error", async () => {
    const t = await freshEnv();
    const campaign = await t.createCampaign({ buyers: [buyerAddress(1)], budget: BUDGET });
    const sender = await t.startSender();
    // Every release is sent for a campaign that does not exist: it reverts CampaignNotFound.
    const breaking: SettlementTxSender = {
      enqueue: (request: TxRequest) =>
        sender.enqueue(
          request.kind === "release"
            ? {
                ...request,
                data: encodeFunctionData({
                  abi: winzEscrowAbi,
                  functionName: "release",
                  args: [999n],
                }),
              }
            : request,
        ),
      waitFor: (id, options) => sender.waitFor(id, options),
    };
    await t.env.advanceTime(HOUR + 1n);
    await setInstrumentOutcome(t.db, SYMBOL, "no");
    t.startWatcher({
      txSender: breaking,
      hedgeFinalizer: new FakeHedgeFinalizer(),
      maxAttempts: 3,
    });

    await waitFor(
      async () => errorLogs(t.logs, "settlement step given up").length > 0,
      "the release step to be given up",
    );
    // Let a few more passes run: nothing more is sent.
    await new Promise((resolve) => setTimeout(resolve, 600));
    const releases = await t.db<{ status: string; last_error: string | null }[]>`
      select status, last_error from chain_txs where kind = 'release' order by created_at
    `;
    expect(releases).toHaveLength(3);
    for (const row of releases)
      expect(row).toEqual({ status: "failed", last_error: "CampaignNotFound" });
    const givenUp = errorLogs(t.logs, "settlement step given up");
    expect(givenUp).toHaveLength(1);
    expect(givenUp[0]).toMatchObject({
      campaignId: campaign.id,
      onchainId: campaign.onchainId.toString(),
      step: "release",
      attempts: 3,
      error: "CampaignNotFound",
    });
    // The settlement itself went through; only the broken step is left.
    expect((await t.driver.getCampaign(campaign.onchainId)).status).toBe(3);
  });
});
