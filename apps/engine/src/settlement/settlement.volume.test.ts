/**
 * SPEC success criterion 6 on a local chain: a campaign of 300 tickets settled YES is fully
 * refunded in under 10 seconds of wall-clock time from the moment `settle` is mined, in 6 batches
 * of 50 enqueued at once. Reports the measured time and the gas of each batch.
 */
import { afterAll, describe, expect, it } from "vitest";
import type { Hex } from "viem";

import type { TxRequest } from "../chain";

import {
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
  type SettlementEnv,
} from "./test-support";
import type { SettlementTxSender } from "./types";

const TICKETS = 300;
const UNIT_PRICE = 4n * USDC;
const REFUNDABLE = 2n * USDC;
/** Arc's block gas limit (SPEC section 8). */
const BLOCK_GAS_LIMIT = 30_000_000n;

let current: SettlementEnv | undefined;

afterAll(async () => {
  await current?.close();
});

describe("300 tickets settled YES (success criterion 6)", () => {
  it("are refunded in under 10 seconds after settle is mined, in 6 batches that fit a block", async () => {
    const t = await createSettlementEnv();
    current = t;
    const buyers = Array.from({ length: TICKETS }, (_, index) => buyerAddress(index + 1));
    const campaign = await t.createCampaign({
      buyers,
      unitPrice: UNIT_PRICE,
      budget: 100n * USDC,
      maxHedgeCost: 100_000n,
    });
    expect(campaign.ticketIds).toHaveLength(TICKETS);
    await t.env.advanceTime(HOUR + 1n);
    await setInstrumentOutcome(t.db, SYMBOL, "yes");

    const sender = await t.startSender();
    // What the watcher asks of the sender, in order: refund batches enqueued, refund batches waited.
    const calls: ("enqueue" | "wait")[] = [];
    const refundTxIds = new Set<string>();
    const watched: SettlementTxSender = {
      enqueue: async (request: TxRequest) => {
        const result = await sender.enqueue(request);
        if (request.kind === "refundBatch") {
          refundTxIds.add(result.id);
          calls.push("enqueue");
        }
        return result;
      },
      waitFor: (id, options) => {
        if (refundTxIds.has(id)) calls.push("wait");
        return sender.waitFor(id, options);
      },
    };
    const marks: Partial<Record<"settled" | "refunded", number>> = {};
    /** Refund transactions in the outbox, and how many were mined, when the step said "enqueued". */
    let atEnqueue: { rows: number; mined: number } | undefined;
    const recorder = stepRecorder(async (event) => {
      if (event.step === "settle" && event.phase === "done") marks.settled = performance.now();
      if (event.step === "refund" && event.phase === "done") marks.refunded = performance.now();
      if (event.step === "refund" && event.phase === "enqueued") {
        const [row] = await t.db<{ rows: bigint; mined: bigint }[]>`
          select count(*) as rows, count(*) filter (where status = 'mined') as mined
          from chain_txs where kind = 'refundBatch'
        `;
        atEnqueue = { rows: Number(row?.rows ?? 0n), mined: Number(row?.mined ?? 0n) };
      }
    });
    t.startWatcher({
      txSender: watched,
      hedgeFinalizer: new FakeHedgeFinalizer(),
      onStep: recorder.onStep,
      txWaitTimeoutMs: 30_000,
    });
    await waitFor(
      async () =>
        marks.refunded !== undefined &&
        (await t.driver.getCampaign(campaign.onchainId)).lockedRefunds === 0n,
      "every ticket to be refunded",
      60_000,
    );
    expect(marks.settled).toBeDefined();
    const elapsedMs = (marks.refunded ?? 0) - (marks.settled ?? 0);
    expect(elapsedMs).toBeLessThan(10_000);

    const refunded = await eventCounts(t.env, "TicketRefunded");
    expect(refunded.size).toBe(TICKETS);
    for (const ticketId of campaign.ticketIds) expect(refunded.get(ticketId)).toBe(1);
    for (const buyer of [buyers[0], buyers[149], buyers[299]]) {
      if (buyer !== undefined) expect(await tokenBalance(t.env, buyer)).toBe(REFUNDABLE);
    }

    // Six batches of 50, all in the outbox before the watcher waited for any of them.
    expect(atEnqueue?.rows).toBe(6);
    expect(atEnqueue?.mined).toBeLessThan(6);
    expect(calls.slice(0, 6)).toEqual(Array.from({ length: 6 }, () => "enqueue"));
    expect(calls.filter((call) => call === "enqueue")).toHaveLength(6);

    // The safety net charged the 300 tickets (the finalizer did nothing): 6 chargeHedge of 50.
    const charges = await t.db<{ signer: string; payload: { ticketIds: string[] } }[]>`
      select signer, payload from chain_txs
      where kind = 'chargeHedge' and idempotency_key like 'settlement:%'
    `;
    expect(charges).toHaveLength(6);
    for (const charge of charges) {
      expect(charge.signer).toBe("oracle");
      expect(charge.payload.ticketIds).toHaveLength(50);
    }
    const batches = await t.db<{ tx_hash: string; payload: { ticketIds: string[] } }[]>`
      select tx_hash, payload from chain_txs where kind = 'refundBatch' order by nonce
    `;
    expect(batches).toHaveLength(6);
    for (const batch of batches) expect(batch.payload.ticketIds).toHaveLength(50);
    const gas: bigint[] = [];
    for (const batch of batches) {
      const receipt = await t.env.publicClient.getTransactionReceipt({
        hash: batch.tx_hash as Hex,
      });
      expect(receipt.status).toBe("success");
      gas.push(receipt.gasUsed);
      // Comfortably inside a 30 M gas block: under a third of it.
      expect(receipt.gasUsed).toBeLessThan(BLOCK_GAS_LIMIT / 3n);
    }
    const largest = gas.reduce((a, b) => (a > b ? a : b), 0n);
    process.stdout.write(
      `[settlement volume] ${TICKETS.toString()} tickets refunded in ${elapsedMs.toFixed(0)} ms ` +
        `after settle was mined, in ${batches.length.toString()} batches; gas per batch: ` +
        `${gas.map(String).join(", ")}; the largest uses ` +
        `${((Number(largest) / Number(BLOCK_GAS_LIMIT)) * 100).toFixed(1)} % of a 30 M gas block; ` +
        `when the 6th batch was enqueued, ${(atEnqueue?.mined ?? 0).toString()} batch(es) were mined\n`,
    );
  }, 180_000);
});
