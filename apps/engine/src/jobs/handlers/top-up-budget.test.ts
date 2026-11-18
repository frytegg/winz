/**
 * The budget top-up job (SPEC CA-6, task A-08) on the real contract: a local chain with the real
 * escrow, a real Postgres with every migration, the real transaction sender and projector, and a
 * fake payment gateway. Every branch of the job, and the money invariant after each scenario:
 * a paid top-up ends credited on-chain exactly once, or refunded exactly once, never both.
 */
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { encodeFunctionData } from "viem";

import {
  JOB_KINDS,
  STRIPE_PAYMENT_KINDS,
  jobIdempotencyKey,
  winzEscrowAbi,
  type BookLevel,
  type TopUpBudgetJob,
} from "@winz/shared";

import type { TxOutcome, TxSender } from "../../chain";
import { waitFor } from "../../chain/ingest-test-support";
import { permanentGatewayError, transientGatewayError } from "../../payments";
import { enqueueJob } from "../enqueue";
import { PermanentJobError, RetryLaterError } from "../errors";
import { finishPauseJobs, saleStateRunner } from "./campaign-actions.test-support";
import type { JobHandlerOptions } from "./deps";
import { createPurchaseHandler } from "./purchase";
import { startJobs } from "./register";
import { createBudgetTopUpHandler, topUpRefundKey, topUpTxKey } from "./top-up-budget";
import { createCampaignCreationHandler } from "./create-campaign";
import {
  CONTRACT,
  USDC,
  createJobsHarness,
  createLiveCampaign,
  getCampaign,
  onchainTickets,
  runHandler,
  seedFundedCampaign,
  seedInstrument,
  seedMerchant,
  seedPayment,
  treasuryBalance,
  txRows,
  type JobsHarness,
  type LiveCampaign,
} from "./test-support";

let harness: JobsHarness;

/** Top-ups of the current test, checked by the money invariant after it. */
let scenario: { pi: string; onchainId: bigint }[] = [];

beforeAll(async () => {
  harness = await createJobsHarness();
});

afterAll(async () => {
  await harness?.close();
});

afterEach(async () => {
  for (const { pi, onchainId } of scenario) {
    const [row] = await harness.db<{ status: string }[]>`
      select status from budget_top_ups where stripe_pi = ${pi}
    `;
    const mined = (await txRows(harness, topUpTxKey(pi))).filter((tx) => tx.status === "mined");
    const events = await harness.db`
      select 1 from chain_events c
      join chain_txs t on t.tx_hash = c.tx_hash
      where c.name = 'BudgetToppedUp' and c.args ->> 'id' = ${onchainId.toString()}
        and starts_with(t.idempotency_key, ${topUpTxKey(pi)})
    `;
    const refunds = harness.gateway.effectsOf(pi).refunds;
    // Never both, never more than once.
    expect(mined.length, `mined top-ups of ${pi}`).toBeLessThanOrEqual(1);
    expect(events.length, `BudgetToppedUp of ${pi}`).toBe(mined.length);
    expect(refunds, `refunds of ${pi}`).toBeLessThanOrEqual(1);
    expect(mined.length + refunds, `credited and refunded ${pi}`).toBeLessThanOrEqual(1);
    // A final row says which one happened.
    if (row?.status === "credited") expect([mined.length, refunds]).toEqual([1, 0]);
    if (row?.status === "refunded") expect([mined.length, refunds]).toEqual([0, 1]);
  }
  scenario = [];
  harness.gateway.clearFailures();
  harness.outage.active = false;
  harness.clock.skewMs = 0;
});

function handler(
  options: JobHandlerOptions = {},
  sender?: Pick<TxSender, "enqueue" | "waitFor">,
): ReturnType<typeof createBudgetTopUpHandler> {
  return createBudgetTopUpHandler(
    harness.deps(sender === undefined ? {} : { txSender: sender }, options),
  );
}

/**
 * A top-up as the web app leaves it once its card payment succeeded: the `budget_top_ups` row
 * `processing`, the PaymentIntent paid at the gateway. Returns the job's payload.
 */
async function paidTopUp(
  live: Pick<LiveCampaign, "campaignId" | "onchainId">,
  amount: bigint,
  intent: { status?: "succeeded" | "processing"; campaignId?: string } = {},
): Promise<TopUpBudgetJob> {
  const pi = `pi_top_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const requestId = randomUUID();
  await harness.db`
    insert into budget_top_ups (request_id, campaign_id, stripe_pi, amount, status)
    values (${requestId}, ${live.campaignId}, ${pi}, ${amount.toString()}::bigint, 'processing')
  `;
  harness.gateway.setIntent({
    id: pi,
    status: intent.status ?? "succeeded",
    amount,
    currency: "usd",
    metadata: {
      kind: STRIPE_PAYMENT_KINDS.campaignBudgetTopUp,
      campaignId: intent.campaignId ?? live.campaignId,
      requestId,
    },
    payerEmail: null,
  });
  scenario.push({ pi, onchainId: live.onchainId });
  return { campaignId: live.campaignId, amount: amount.toString(), paymentIntentId: pi, requestId };
}

interface TopUpDbRow {
  status: string;
  message: string | null;
  tx_hash: string | null;
  refunded_at: Date | null;
}

async function topUpRow(pi: string): Promise<TopUpDbRow> {
  const [row] = await harness.db<TopUpDbRow[]>`
    select status, message, tx_hash, refunded_at from budget_top_ups where stripe_pi = ${pi}
  `;
  if (row === undefined) throw new Error(`no top-up ${pi}`);
  return row;
}

async function campaignBudget(campaignId: string): Promise<bigint> {
  const [row] = await harness.db<{ budget: bigint }[]>`
    select budget from campaigns where id = ${campaignId}
  `;
  if (row === undefined) throw new Error(`no campaign ${campaignId}`);
  return row.budget;
}

/** What the close route writes: the request to close sales early (the job itself not run). */
async function requestClose(campaignId: string): Promise<void> {
  await harness.db`
    insert into jobs (kind, payload, idempotency_key)
    values (${JOB_KINDS.closeSales}, ${JSON.stringify({ campaignId })}::text::jsonb,
            ${jobIdempotencyKey.closeSales(campaignId)})
  `;
}

describe("campaign.top_up: credited", () => {
  it("adds the top-ups to the escrow: the budget is the first one plus the top-ups, to the micro-USDC", async () => {
    const live = await createLiveCampaign(harness, "credit");
    const treasuryBefore = await treasuryBalance(harness);
    // One top-up of a campaign at a time: the second is paid once the first is credited.
    const first = await paidTopUp(live, 25_370_000n);
    await runHandler(harness, handler(), first);
    const second = await paidTopUp(live, 500_000n);
    await runHandler(harness, handler(), second);

    const expected = live.terms.budget + 25_370_000n + 500_000n;
    expect((await getCampaign(harness, live.onchainId)).hedgeBudget).toBe(expected);
    // The treasury paid exactly the top-ups, nothing more.
    expect(treasuryBefore - (await treasuryBalance(harness))).toBe(25_370_000n + 500_000n);
    // The projection raised the stored budget to the same figure.
    expect(await campaignBudget(live.campaignId)).toBe(expected);
    for (const payload of [first, second]) {
      const txs = await harness.db<{ status: string; tx_hash: string; kind: string }[]>`
        select status, tx_hash, kind from chain_txs
        where idempotency_key = ${topUpTxKey(payload.paymentIntentId)}
      `;
      expect(txs.map((tx) => [tx.status, tx.kind])).toEqual([["mined", "topUpBudgetFor"]]);
      const row = await topUpRow(payload.paymentIntentId);
      expect(row).toMatchObject({ status: "credited", message: null, refunded_at: null });
      expect(row.tx_hash).toBe(txs[0]?.tx_hash);
      expect(harness.gateway.effectsOf(payload.paymentIntentId).refunds).toBe(0);
    }
    // The receipts' events are processed: the chain projector will not apply them again.
    const unprocessed = await harness.db`
      select 1 from chain_events where name = 'BudgetToppedUp'
        and args ->> 'id' = ${live.onchainId.toString()} and processed_at is null
    `;
    expect(unprocessed).toHaveLength(0);
    // Nothing else of the campaign changed.
    const onchain = await getCampaign(harness, live.onchainId);
    expect(onchain).toMatchObject({
      unitPrice: live.terms.unitPrice,
      refundBps: live.terms.refundBps,
      status: 0,
      hedgeSpent: 0n,
      hedgeReserved: 0n,
    });
  });

  it("sends one transaction and refunds nothing when the job runs twice, and twice at once", async () => {
    const live = await createLiveCampaign(harness, "twice");
    const payload = await paidTopUp(live, 10n * USDC);
    const results = await Promise.allSettled([
      runHandler(harness, handler(), payload),
      runHandler(harness, handler(), payload),
    ]);
    for (const result of results) {
      if (result.status === "rejected") expect(result.reason).toBeInstanceOf(RetryLaterError);
    }
    await runHandler(harness, handler(), payload);
    await runHandler(harness, handler(), payload);

    expect(await txRows(harness, topUpTxKey(payload.paymentIntentId))).toHaveLength(1);
    expect((await getCampaign(harness, live.onchainId)).hedgeBudget).toBe(
      live.terms.budget + 10n * USDC,
    );
    expect(await campaignBudget(live.campaignId)).toBe(live.terms.budget + 10n * USDC);
    expect((await topUpRow(payload.paymentIntentId)).status).toBe("credited");
    expect(harness.gateway.callsOf(payload.paymentIntentId, "refund")).toEqual([]);
  });

  it("a job retried after its transaction was mined sends nothing more and only credits it", async () => {
    const live = await createLiveCampaign(harness, "after-mined");
    const payload = await paidTopUp(live, 7n * USDC);
    // The first run queued the transaction, which was mined, then the run was lost before it
    // could project the receipt (a crash): the transaction is mined, the top-up still processing.
    const { id } = await harness.sender.enqueue({
      idempotencyKey: topUpTxKey(payload.paymentIntentId),
      signer: "relayer",
      kind: "topUpBudgetFor",
      to: harness.escrow.escrow,
      data: encodeFunctionData({
        abi: winzEscrowAbi,
        functionName: "topUpBudgetFor",
        args: [live.onchainId, 7n * USDC],
      }),
      payload: { campaignId: live.campaignId },
    });
    expect((await harness.sender.waitFor(id, { timeoutMs: 20_000 })).status).toBe("mined");
    expect((await topUpRow(payload.paymentIntentId)).status).toBe("processing");
    const treasuryBefore = await treasuryBalance(harness);

    // Sales closed meanwhile by the handler's clock: the mined transaction still wins.
    harness.clock.skewMs = 3 * 24 * 3_600_000;
    await runHandler(harness, handler(), payload);
    await runHandler(harness, handler(), payload);

    expect(await txRows(harness, topUpTxKey(payload.paymentIntentId))).toHaveLength(1);
    expect(await treasuryBalance(harness)).toBe(treasuryBefore);
    expect((await getCampaign(harness, live.onchainId)).hedgeBudget).toBe(
      live.terms.budget + 7n * USDC,
    );
    expect((await topUpRow(payload.paymentIntentId)).status).toBe("credited");
    expect(await campaignBudget(live.campaignId)).toBe(live.terms.budget + 7n * USDC);
    expect(harness.gateway.callsOf(payload.paymentIntentId, "refund")).toEqual([]);
  });

  it("retries later through a node outage, then credits once", async () => {
    const live = await createLiveCampaign(harness, "outage");
    const payload = await paidTopUp(live, 3n * USDC);
    harness.outage.active = true;
    await expect(
      runHandler(harness, handler({ waitTimeoutMs: 500 }), payload),
    ).rejects.toBeInstanceOf(RetryLaterError);
    expect((await topUpRow(payload.paymentIntentId)).status).toBe("processing");
    expect(harness.gateway.callsOf(payload.paymentIntentId, "refund")).toEqual([]);

    harness.outage.active = false;
    await runHandler(harness, handler(), payload);
    expect(
      (await txRows(harness, topUpTxKey(payload.paymentIntentId))).map((tx) => tx.status),
    ).toEqual(["mined"]);
    expect((await getCampaign(harness, live.onchainId)).hedgeBudget).toBe(
      live.terms.budget + 3n * USDC,
    );
    expect((await topUpRow(payload.paymentIntentId)).status).toBe("credited");
  });

  it("waits for a payment that is not settled yet at the gateway", async () => {
    const live = await createLiveCampaign(harness, "not-settled");
    const payload = await paidTopUp(live, 2n * USDC, { status: "processing" });
    await expect(runHandler(harness, handler(), payload)).rejects.toBeInstanceOf(RetryLaterError);
    expect(await txRows(harness, topUpTxKey(payload.paymentIntentId))).toHaveLength(0);
    harness.gateway.setStatus(payload.paymentIntentId, "succeeded");
    await runHandler(harness, handler(), payload);
    expect((await topUpRow(payload.paymentIntentId)).status).toBe("credited");
  });

  it("runs from the queue: startJobs takes the job the webhook enqueues and ends it done", async () => {
    const live = await createLiveCampaign(harness, "queued");
    const payload = await paidTopUp(live, 4n * USDC);
    await harness.clock.sync(harness.escrow);
    const stop = new AbortController();
    const service = startJobs({
      ...harness.deps(),
      signal: stop.signal,
      worker: { pollIntervalMs: 20, visibilityTimeoutMs: 5_000, shutdownGraceMs: 2_000 },
    });
    try {
      const { id } = await enqueueJob(harness.db, {
        kind: JOB_KINDS.topUpBudget,
        payload,
        idempotencyKey: jobIdempotencyKey.topUpBudget(payload.paymentIntentId),
      });
      await waitFor(
        async () => {
          const [job] = await harness.db<{ status: string }[]>`
            select status from jobs where id = ${id}
          `;
          return job?.status === "done";
        },
        "top-up job done",
        30_000,
      );
    } finally {
      stop.abort();
      await service.stopped;
    }
    expect((await topUpRow(payload.paymentIntentId)).status).toBe("credited");
    expect((await getCampaign(harness, live.onchainId)).hedgeBudget).toBe(
      live.terms.budget + 4n * USDC,
    );
  });
});

describe("campaign.top_up: refunded", () => {
  it("refunds once, sending nothing, when the merchant closed sales meanwhile", async () => {
    const live = await createLiveCampaign(harness, "closed-meanwhile");
    const payload = await paidTopUp(live, 6n * USDC);
    await requestClose(live.campaignId);
    const treasuryBefore = await treasuryBalance(harness);

    await runHandler(harness, handler(), payload);
    await runHandler(harness, handler(), payload);

    expect(await txRows(harness, topUpTxKey(payload.paymentIntentId))).toHaveLength(0);
    expect(harness.gateway.effectsOf(payload.paymentIntentId).refunds).toBe(1);
    expect(
      harness.gateway.callsOf(payload.paymentIntentId, "refund").map((call) => call.idempotencyKey),
    ).toEqual([topUpRefundKey(payload.paymentIntentId)]);
    const row = await topUpRow(payload.paymentIntentId);
    expect(row).toMatchObject({ status: "refunded", message: "sales are closed", tx_hash: null });
    expect(row.refunded_at).not.toBeNull();
    expect((await getCampaign(harness, live.onchainId)).hedgeBudget).toBe(live.terms.budget);
    expect(await campaignBudget(live.campaignId)).toBe(live.terms.budget);
    expect(await treasuryBalance(harness)).toBe(treasuryBefore);
  });

  it("refunds once when sales close has passed by the job's clock", async () => {
    const live = await createLiveCampaign(harness, "close-passed");
    const payload = await paidTopUp(live, 6n * USDC);
    harness.clock.skewMs = 3 * 24 * 3_600_000;
    await runHandler(harness, handler(), payload);
    expect(await txRows(harness, topUpTxKey(payload.paymentIntentId))).toHaveLength(0);
    expect(await topUpRow(payload.paymentIntentId)).toMatchObject({
      status: "refunded",
      message: "sales close has passed",
    });
    expect(harness.gateway.effectsOf(payload.paymentIntentId).refunds).toBe(1);
  });

  it("refunds once when a mined top-up reverted on-chain (AlreadyReleased)", async () => {
    const live = await createLiveCampaign(harness, "reverted");
    const payload = await paidTopUp(live, 6n * USDC);
    // A sender whose transaction was mined and reverted: the escrow released the campaign's budget
    // (emergencyReleaseBudget, seven days without settlement) between the check and the call.
    const sent: string[] = [];
    const reverting: Pick<TxSender, "enqueue" | "waitFor"> = {
      enqueue: (request) => {
        sent.push(request.idempotencyKey);
        return Promise.resolve({ id: randomUUID(), created: true });
      },
      waitFor: (id): Promise<TxOutcome> =>
        Promise.resolve({
          id,
          status: "reverted",
          txHash: `0x${"ee".repeat(32)}`,
          events: [],
          error: "AlreadyReleased",
        }),
    };
    await runHandler(harness, handler({}, reverting), payload);
    // A retry finds the decision and only makes sure of the refund.
    await runHandler(harness, handler({}, reverting), payload);

    expect(sent).toEqual([topUpTxKey(payload.paymentIntentId)]);
    expect(await topUpRow(payload.paymentIntentId)).toMatchObject({
      status: "refunded",
      message: "the escrow refused the top-up (AlreadyReleased)",
    });
    expect(harness.gateway.effectsOf(payload.paymentIntentId).refunds).toBe(1);
  });

  it("finishes a refund whose call failed on a later run, never sending a transaction", async () => {
    const live = await createLiveCampaign(harness, "refund-retry");
    const payload = await paidTopUp(live, 6n * USDC);
    await requestClose(live.campaignId);
    harness.gateway.failNext("refund", transientGatewayError());
    await expect(runHandler(harness, handler(), payload)).rejects.toBeInstanceOf(RetryLaterError);
    expect(await topUpRow(payload.paymentIntentId)).toMatchObject({ status: "refunding" });
    expect(harness.gateway.effectsOf(payload.paymentIntentId).refunds).toBe(0);

    // Even if the campaign looked open again, the decision is written: only the refund runs.
    await harness.db`delete from jobs where idempotency_key = ${jobIdempotencyKey.closeSales(live.campaignId)}`;
    await runHandler(harness, handler(), payload);

    expect(await txRows(harness, topUpTxKey(payload.paymentIntentId))).toHaveLength(0);
    expect(harness.gateway.effectsOf(payload.paymentIntentId).refunds).toBe(1);
    const keys = harness.gateway
      .callsOf(payload.paymentIntentId, "refund")
      .map((call) => call.idempotencyKey);
    expect(keys).toEqual([
      topUpRefundKey(payload.paymentIntentId),
      topUpRefundKey(payload.paymentIntentId),
    ]);
    expect((await topUpRow(payload.paymentIntentId)).status).toBe("refunded");
    expect((await getCampaign(harness, live.onchainId)).hedgeBudget).toBe(live.terms.budget);
  });

  it("ends dead, loudly, when the gateway refuses the refund for good, and stays refunding", async () => {
    const live = await createLiveCampaign(harness, "refund-refused");
    const payload = await paidTopUp(live, 6n * USDC);
    await requestClose(live.campaignId);
    harness.gateway.failNext("refund", permanentGatewayError("charge disputed", "charge_disputed"));
    await expect(runHandler(harness, handler(), payload)).rejects.toBeInstanceOf(PermanentJobError);
    expect(await topUpRow(payload.paymentIntentId)).toMatchObject({ status: "refunding" });
    expect(await txRows(harness, topUpTxKey(payload.paymentIntentId))).toHaveLength(0);
  });

  it("refuses a payload or a payment that is not this top-up's, crediting and refunding nothing", async () => {
    const live = await createLiveCampaign(harness, "mismatch");
    const payload = await paidTopUp(live, 6n * USDC);
    await expect(
      runHandler(harness, handler(), { ...payload, amount: (7n * USDC).toString() }),
    ).rejects.toBeInstanceOf(PermanentJobError);
    await expect(
      runHandler(harness, handler(), { ...payload, requestId: randomUUID() }),
    ).rejects.toBeInstanceOf(PermanentJobError);
    const other = await createLiveCampaign(harness, "mismatch-other");
    const foreign = await paidTopUp(other, 6n * USDC, { campaignId: randomUUID() });
    await expect(runHandler(harness, handler(), foreign)).rejects.toBeInstanceOf(PermanentJobError);
    for (const pi of [payload.paymentIntentId, foreign.paymentIntentId]) {
      expect(await txRows(harness, topUpTxKey(pi))).toHaveLength(0);
      expect(harness.gateway.callsOf(pi, "refund")).toEqual([]);
      expect((await topUpRow(pi)).status).toBe("processing");
    }
    // Positive control: the right payload goes through.
    await runHandler(harness, handler(), payload);
    expect((await topUpRow(payload.paymentIntentId)).status).toBe("credited");
  });

  it("refunds once when the escrow refuses it because the campaign is settled (AlreadySettled)", async () => {
    // A campaign whose sales close in a minute, settled on-chain while the database still says
    // live (the settlement event not ingested yet), and a job that believes the campaign open.
    const symbol = await seedInstrument(harness, "settled");
    const { merchantId } = await seedMerchant(harness, "Settled Bar");
    const funded = await seedFundedCampaign(harness, {
      merchantId,
      symbol,
      terms: { salesClose: new Date(harness.clock.chainNow() + 60_000) },
    });
    await runHandler(harness, createCampaignCreationHandler(harness.deps()), {
      campaignId: funded.campaignId,
    });
    const [created] = await harness.db<{ onchain_id: bigint }[]>`
      select onchain_id from campaigns where id = ${funded.campaignId}
    `;
    const onchainId = created?.onchain_id ?? 0n;
    await harness.escrow.advanceTime(120);
    const hash = await harness.escrow.wallets.oracle.writeContract({
      address: harness.escrow.escrow,
      abi: winzEscrowAbi,
      functionName: "settle",
      args: [onchainId, 1],
    });
    expect((await harness.escrow.publicClient.waitForTransactionReceipt({ hash })).status).toBe(
      "success",
    );
    const payload = await paidTopUp({ campaignId: funded.campaignId, onchainId }, 6n * USDC);
    const treasuryBefore = await treasuryBalance(harness);

    // The job's clock runs ten minutes behind the chain: it believes sales are still open.
    harness.clock.skewMs = -600_000;
    await runHandler(harness, handler(), payload);

    expect(
      (await txRows(harness, topUpTxKey(payload.paymentIntentId))).map((tx) => [
        tx.status,
        tx.last_error,
      ]),
    ).toEqual([["failed", "AlreadySettled"]]);
    expect(await topUpRow(payload.paymentIntentId)).toMatchObject({
      status: "refunded",
      message: "the escrow refused the top-up (AlreadySettled)",
    });
    expect(harness.gateway.effectsOf(payload.paymentIntentId).refunds).toBe(1);
    expect((await getCampaign(harness, onchainId)).hedgeBudget).toBe(funded.terms.budget);
    expect(await treasuryBalance(harness)).toBe(treasuryBefore);
  });
});

describe("a committed top-up never dies on an outage, even on its last attempt", () => {
  interface JobRow {
    status: string;
    attempts: number;
    max_attempts: number;
    last_error: string | null;
  }

  async function jobRow(id: string): Promise<JobRow> {
    const [row] = await harness.db<JobRow[]>`
      select status, attempts, max_attempts, last_error from jobs where id = ${id}
    `;
    if (row === undefined) throw new Error(`no job ${id}`);
    return row;
  }

  /** Logged by `runUntilSettled` when it keeps a job's last attempt retrying inside the run. */
  function keptInRun(pi: string): boolean {
    return harness.logs.some(
      (entry) =>
        entry.level === 50 &&
        typeof entry.msg === "string" &&
        entry.msg.includes("last attempt of a committed job") &&
        (entry as Record<string, unknown>).paymentIntentId === pi,
    );
  }

  /**
   * The job of `payload` enqueued with ONE attempt (attempts reach max_attempts at its first
   * run) and run by the real worker; `outage` runs once the worker holds it, while the outage
   * lasts. Returns the job's row once it ended.
   */
  async function lastAttemptThroughQueue(
    payload: TopUpBudgetJob,
    options: JobHandlerOptions,
    duringOutage: (jobId: string) => Promise<void>,
  ): Promise<JobRow> {
    await harness.clock.sync(harness.escrow);
    const stop = new AbortController();
    const service = startJobs({
      ...harness.deps({}, options),
      signal: stop.signal,
      worker: { pollIntervalMs: 20, visibilityTimeoutMs: 5_000, shutdownGraceMs: 2_000 },
    });
    try {
      const { id } = await enqueueJob(harness.db, {
        kind: JOB_KINDS.topUpBudget,
        payload,
        idempotencyKey: jobIdempotencyKey.topUpBudget(payload.paymentIntentId),
        maxAttempts: 1,
      });
      await duringOutage(id);
      await waitFor(
        async () => ["done", "dead"].includes((await jobRow(id)).status),
        "top-up job to end",
        30_000,
      );
      return await jobRow(id);
    } finally {
      stop.abort();
      await service.stopped;
    }
  }

  it("a node outage on the last attempt: the job stays alive, then credits once the node is back", async () => {
    const live = await createLiveCampaign(harness, "last-node");
    const payload = await paidTopUp(live, 5n * USDC);
    const pi = payload.paymentIntentId;
    harness.outage.active = true;
    const job = await lastAttemptThroughQueue(payload, { waitTimeoutMs: 300 }, async (id) => {
      try {
        await waitFor(
          async () => keptInRun(pi) || (await jobRow(id)).status === "dead",
          "the last attempt to meet the outage",
          30_000,
        );
        // The outage outlasts the attempt the job was enqueued with: it must not be dead.
        expect((await jobRow(id)).status).toBe("running");
        expect((await topUpRow(pi)).status).toBe("processing");
      } finally {
        harness.outage.active = false;
      }
    });

    expect(job).toMatchObject({ status: "done", attempts: 1 });
    expect(keptInRun(pi)).toBe(true);
    expect((await txRows(harness, topUpTxKey(pi))).map((tx) => tx.status)).toEqual(["mined"]);
    expect((await topUpRow(pi)).status).toBe("credited");
    expect((await getCampaign(harness, live.onchainId)).hedgeBudget).toBe(
      live.terms.budget + 5n * USDC,
    );
    expect(await campaignBudget(live.campaignId)).toBe(live.terms.budget + 5n * USDC);
    expect(harness.gateway.callsOf(pi, "refund")).toEqual([]);
  });

  it("a gateway outage on the refund of the last attempt: the job stays alive, then refunds once", async () => {
    const live = await createLiveCampaign(harness, "last-refund");
    const payload = await paidTopUp(live, 6n * USDC);
    const pi = payload.paymentIntentId;
    await requestClose(live.campaignId);
    // The gateway refuses the refund four times for a passing reason, then takes it.
    harness.gateway.failNext("refund", transientGatewayError(), 4);
    const job = await lastAttemptThroughQueue(payload, {}, async (id) => {
      await waitFor(
        async () => keptInRun(pi) || (await jobRow(id)).status === "dead",
        "the last attempt to meet the outage",
        30_000,
      );
      expect((await jobRow(id)).status).not.toBe("dead");
    });

    expect(job).toMatchObject({ status: "done", attempts: 1 });
    expect(keptInRun(pi)).toBe(true);
    expect(harness.gateway.effectsOf(pi).refunds).toBe(1);
    expect(harness.gateway.callsOf(pi, "refund").map((call) => call.idempotencyKey)).toEqual(
      Array.from({ length: 5 }, () => topUpRefundKey(pi)),
    );
    expect(await topUpRow(pi)).toMatchObject({ status: "refunded", message: "sales are closed" });
    expect(await txRows(harness, topUpTxKey(pi))).toHaveLength(0);
    expect((await getCampaign(harness, live.onchainId)).hedgeBudget).toBe(live.terms.budget);
  });
});

describe("a top-up payment the web app recorded for a refund (paid after its request ended)", () => {
  it("is refunded once, and nothing is sent to the chain", async () => {
    const live = await createLiveCampaign(harness, "paid-unused");
    const payload = await paidTopUp(live, 4n * USDC);
    const pi = payload.paymentIntentId;
    // What the webhook writes for a paid intent no open top-up expected (`handleTopUpPaid`).
    await harness.db`
      update budget_top_ups
      set status = 'refunding', message = 'Paid after its request had ended: refunded'
      where stripe_pi = ${pi}
    `;
    const treasuryBefore = await treasuryBalance(harness);
    await runHandler(harness, handler(), payload);
    await runHandler(harness, handler(), payload);

    expect(await txRows(harness, topUpTxKey(pi))).toHaveLength(0);
    expect(harness.gateway.effectsOf(pi).refunds).toBe(1);
    expect((await topUpRow(pi)).status).toBe("refunded");
    expect((await getCampaign(harness, live.onchainId)).hedgeBudget).toBe(live.terms.budget);
    expect(await treasuryBalance(harness)).toBe(treasuryBefore);
  });
});

describe("a campaign whose budget is used up sells again once topped up (CA-5, CA-6)", () => {
  const ASKS: BookLevel[] = [
    { priceBps: 3_000n, qty: 200n * CONTRACT },
    { priceBps: 3_100n, qty: 300n * CONTRACT },
  ];
  const BIDS: BookLevel[] = [{ priceBps: 2_900n, qty: 100n * CONTRACT }];

  async function saleState(campaignId: string): Promise<string> {
    const [row] = await harness.db<{ sale_state: string }[]>`
      select sale_state from campaigns where id = ${campaignId}
    `;
    return row?.sale_state ?? "missing";
  }

  async function sell(live: LiveCampaign, email: string): Promise<string> {
    const pi = await seedPayment(harness, {
      campaignId: live.campaignId,
      qty: 1,
      unitPrice: live.terms.unitPrice,
      email,
    });
    await runHandler(harness, createPurchaseHandler(harness.deps()), { paymentIntentId: pi });
    const [row] = await harness.db<{ status: string }[]>`
      select status from payments where stripe_pi = ${pi}
    `;
    return row?.status ?? "missing";
  }

  it("exhausted: paused_budget and a purchase refused; topped up: open, quoted and ticketed", async () => {
    // $5 a unit, all of it back on YES: one sale reserves about $1.60 of guarantee, so a $2
    // budget holds exactly one sale.
    const live = await createLiveCampaign(harness, "exhausted", { budget: 2n * USDC });
    harness.books.set(live.symbol, { asks: ASKS, bids: BIDS });
    const runner = saleStateRunner(harness);
    await harness.clock.sync(harness.escrow);
    await runner.runPass([live.symbol]);
    expect(await saleState(live.campaignId)).toBe("open");

    expect(await sell(live, "first-fan@example.com")).toBe("ticketed");
    await harness.clock.sync(harness.escrow);
    await runner.runPass([live.symbol]);
    expect(await saleState(live.campaignId)).toBe("paused_budget");
    // Negative control: no quote while the budget is used up.
    expect(await sell(live, "refused-fan@example.com")).toBe("cancelled_paused");

    const payload = await paidTopUp(live, 20n * USDC);
    await runHandler(harness, handler(), payload);
    expect((await getCampaign(harness, live.onchainId)).hedgeBudget).toBe(22n * USDC);

    // No other action: the sale state service sees the new budget, and after its ten-second
    // hysteresis (SPEC CA-5) the promo sells again.
    await finishPauseJobs(harness, live.campaignId);
    await harness.clock.sync(harness.escrow);
    await runner.runPass([live.symbol]);
    await harness.escrow.advanceTime(11);
    await harness.clock.sync(harness.escrow);
    await runner.runPass([live.symbol]);
    expect(await saleState(live.campaignId)).toBe("open");
    const [publicRow] = await harness.db<{ sale_state: string }[]>`
      select lc.sale_state from live_campaigns lc join campaigns c on c.slug = lc.slug
      where c.id = ${live.campaignId}
    `;
    expect(publicRow?.sale_state).toBe("open");

    expect(await sell(live, "second-fan@example.com")).toBe("ticketed");
    const tickets = (await onchainTickets(harness)).filter(
      (ticket) => ticket.campaignId === live.onchainId,
    );
    expect(tickets).toHaveLength(2);
    // R, the price and the close time are those of the creation.
    expect(await getCampaign(harness, live.onchainId)).toMatchObject({
      unitPrice: live.terms.unitPrice,
      refundBps: live.terms.refundBps,
    });
  });
});
