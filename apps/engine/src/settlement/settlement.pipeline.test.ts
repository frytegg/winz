/**
 * SPEC criterion 6 with the pipelined sender, on a chain with a block time (anvil interval
 * mining at 0.5 s, Arc makes a block about every 0.46 s): the six refund batches of 300 tickets,
 * enqueued together by the settlement sequence, are mined within two blocks of the first one.
 * With one transaction at a time they take a block each, which is what Arc testnet showed.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { Hex } from "viem";

import {
  buyerAddress,
  createSettlementEnv,
  eventCounts,
  FakeHedgeFinalizer,
  HOUR,
  setInstrumentOutcome,
  stepRecorder,
  SYMBOL,
  USDC,
  waitFor,
  type SettlementEnv,
} from "./test-support";

const TICKETS = 300;

let current: SettlementEnv | undefined;

afterEach(async () => {
  await current?.close();
  current = undefined;
});

interface Run {
  refundBlocks: bigint[];
  chargeBlocks: bigint[];
  settleBlock: bigint;
  elapsedMs: number;
}

async function settleAndRefund(maxInFlight: number): Promise<Run> {
  const t = await createSettlementEnv({ blockTime: 0.5, sender: { maxInFlight } });
  current = t;
  const buyers = Array.from({ length: TICKETS }, (_, index) => buyerAddress(index + 1));
  const campaign = await t.createCampaign({
    buyers,
    unitPrice: 4n * USDC,
    budget: 100n * USDC,
    maxHedgeCost: 100_000n,
  });
  expect(campaign.ticketIds).toHaveLength(TICKETS);
  await t.env.advanceTime(HOUR + 1n);
  await setInstrumentOutcome(t.db, SYMBOL, "yes");

  const sender = await t.startSender();
  const marks: Partial<Record<"settled" | "refunded", number>> = {};
  const recorder = stepRecorder((event) => {
    if (event.step === "settle" && event.phase === "done") marks.settled = performance.now();
    if (event.step === "refund" && event.phase === "done") marks.refunded = performance.now();
  });
  t.startWatcher({
    txSender: sender,
    hedgeFinalizer: new FakeHedgeFinalizer(),
    onStep: recorder.onStep,
    txWaitTimeoutMs: 60_000,
  });
  await waitFor(
    async () =>
      marks.refunded !== undefined &&
      (await t.driver.getCampaign(campaign.onchainId)).lockedRefunds === 0n,
    "every ticket to be refunded",
    90_000,
  );
  const refunded = await eventCounts(t.env, "TicketRefunded");
  expect(refunded.size).toBe(TICKETS);
  for (const ticketId of campaign.ticketIds) expect(refunded.get(ticketId)).toBe(1);

  const blocksOf = async (kind: string): Promise<bigint[]> => {
    const rows = await t.db<{ status: string; block_number: bigint; tx_hash: string }[]>`
      select status, block_number, tx_hash from chain_txs where kind = ${kind} order by nonce
    `;
    for (const row of rows) {
      expect(row.status).toBe("mined");
      const receipt = await t.env.publicClient.getTransactionReceipt({ hash: row.tx_hash as Hex });
      expect(receipt.status).toBe("success");
    }
    return rows.map((row) => row.block_number);
  };
  const refundBlocks = await blocksOf("refundBatch");
  const chargeBlocks = await blocksOf("chargeHedge");
  const [settleBlock] = await blocksOf("settle");
  expect(refundBlocks).toHaveLength(6);
  expect(chargeBlocks).toHaveLength(6);
  return {
    refundBlocks,
    chargeBlocks,
    settleBlock: settleBlock ?? -1n,
    elapsedMs: (marks.refunded ?? 0) - (marks.settled ?? 0),
  };
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

describe("300 tickets settled YES on a chain with a block time", () => {
  it("are refunded in six batches mined within two blocks of the first, after settle", async () => {
    const run = await settleAndRefund(8);
    process.stdout.write(
      `[settlement pipeline] window 8: charges in blocks ${run.chargeBlocks.join(", ")}, settle in ` +
        `${run.settleBlock.toString()}, refunds in blocks ${run.refundBlocks.join(", ")}; refunded ` +
        `${run.elapsedMs.toFixed(0)} ms after settle was mined\n`,
    );
    expect(spread(run.refundBlocks)).toBeLessThanOrEqual(1n);
    // The six charges of the oracle travel together too, and settle (a barrier) comes after them.
    expect(spread(run.chargeBlocks)).toBeLessThanOrEqual(1n);
    for (const block of run.chargeBlocks) expect(block).toBeLessThan(run.settleBlock);
    for (const block of run.refundBlocks) expect(block).toBeGreaterThan(run.settleBlock);
    expect(run.elapsedMs).toBeLessThan(10_000);
  }, 180_000);

  it("take a block per batch with one transaction at a time (the behaviour measured on Arc)", async () => {
    const run = await settleAndRefund(1);
    process.stdout.write(
      `[settlement pipeline] window 1: refunds in blocks ${run.refundBlocks.join(", ")}; refunded ` +
        `${run.elapsedMs.toFixed(0)} ms after settle was mined\n`,
    );
    expect(new Set(run.refundBlocks).size).toBe(6);
    expect(spread(run.refundBlocks)).toBeGreaterThanOrEqual(5n);
  }, 180_000);
});
