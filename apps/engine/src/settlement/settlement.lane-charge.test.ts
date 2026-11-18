/**
 * The safety net and a charge of the hedging lane still in flight (SPEC 9.5, ST-3): once the
 * hedge finalizer has failed, the safety net charges the tickets the chain shows uncharged. With
 * the pipelined sender a `chargeHedge` it sends while the lane's charge of the same ticket is in
 * flight passes its simulation and reverts on-chain with `HedgeAlreadyCharged`, gas paid. On a
 * chain with a block time (anvil interval mining at 0.5 s), the lane's charge is in flight when
 * the safety net runs: nothing reverts, every ticket is charged once, the settlement finishes.
 *
 * Twice: anvil as it is, which estimates gas on the pending block (the overlap then shows as a
 * preparation refused with `HedgeAlreadyCharged`, an attempt of the step used for nothing), and
 * a node that estimates gas on the latest block, as the simulation does (the overlap then reverts
 * on-chain, gas paid).
 */
import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { wrapClient } from "../chain/test-support";
import { chargeHedgeTxRequest } from "../hedging/allocation";
import {
  allocateLot,
  buyerAddress,
  createSettlementEnv,
  escrowEvents,
  FakeHedgeFinalizer,
  HOUR,
  setInstrumentOutcome,
  SYMBOL,
  USDC,
  waitFor,
  type SettlementEnv,
} from "./test-support";

let current: SettlementEnv | undefined;

afterEach(async () => {
  await current?.close();
  current = undefined;
});

/** The hedging lane failing after it queued its charge (an outage, a timeout). */
class TestHedgingLaneDownError extends Error {
  constructor() {
    super("the hedging lane is down");
    this.name = "TestHedgingLaneDownError";
  }
}

/** The `HedgeCharged` amounts of the chain, by ticket id, one entry per charge. */
async function hedgeCharges(t: SettlementEnv): Promise<Map<bigint, bigint[]>> {
  const charges = new Map<bigint, bigint[]>();
  for (const event of await escrowEvents(t.env)) {
    if (event.eventName !== "HedgeCharged") continue;
    const { ticketId, amount } = event.args as { ticketId: bigint; amount: bigint };
    charges.set(ticketId, [...(charges.get(ticketId) ?? []), amount]);
  }
  return charges;
}

describe("the safety net while a charge of the hedging lane is in flight", () => {
  it.each([
    { node: "anvil, gas estimated on the pending block", latestEstimate: false },
    { node: "gas estimated on the latest block", latestEstimate: true },
  ])(
    "$node: waits for it, no chargeHedge reverts or fails, every ticket is charged exactly once, the settlement finishes",
    async ({ node, latestEstimate }) => {
      const t = await createSettlementEnv({
        blockTime: 0.5,
        sender: { maxInFlight: 8 },
        ...(latestEstimate
          ? {
              senderClient: (client) =>
                wrapClient(client, {
                  estimateGas: (request) =>
                    t.env.publicClient.estimateGas({ ...request, blockTag: "latest" }),
                }),
            }
          : {}),
      });
      current = t;
      const campaign = await t.createCampaign({
        buyers: Array.from({ length: 6 }, (_, index) => buyerAddress(index + 1)),
        unitPrice: 10n * USDC,
        budget: 100n * USDC,
        maxHedgeCost: USDC,
      });
      const [t1, t2, t3, t4] = campaign.ticketIds as [bigint, bigint, bigint, bigint];
      // The lane covered four lots; it charges two of them itself, as its last act before failing.
      await allocateLot(t.db, t1, 300_000n, 1_000_000n);
      await allocateLot(t.db, t2, 400_000n, 1_000_000n);
      await allocateLot(t.db, t3, 500_000n, 1_000_000n);
      await allocateLot(t.db, t4, 600_000n, 1_000_000n);
      const laneTickets = [t1, t2];
      const laneAmounts = [300_000n, 400_000n];
      const sender = await t.startSender();
      await t.env.advanceTime(HOUR + 1n);
      await setInstrumentOutcome(t.db, SYMBOL, "no");

      // The hedging lane's own request (`chargeHedgeTxRequest`, key `chargeHedge:rt:<hash>:<n>`):
      // its row names no campaign, only tickets.
      const hash = createHash("sha256");
      laneTickets.forEach((ticketId, index) => {
        hash.update(`${ticketId.toString()}:${String(laneAmounts[index])};`);
      });
      const laneRequest = chargeHedgeTxRequest(
        {
          isolated: false,
          ticketIds: laneTickets,
          amounts: laneAmounts,
          lots: [],
          idempotencyKey: `chargeHedge:rt:${hash.digest("hex")}:0`,
        },
        t.env.escrow,
      );
      let laneTxId: string | undefined;
      const finalizer = new FakeHedgeFinalizer(async () => {
        if (laneTxId === undefined) {
          // Right after a block, so that the charge stays in flight for most of a block time.
          const head = await t.env.publicClient.getBlockNumber();
          await waitFor(
            async () => (await t.env.publicClient.getBlockNumber()) > head,
            "the next block",
          );
          laneTxId = (await sender.enqueue(laneRequest)).id;
          const id = laneTxId;
          await waitFor(async () => {
            const [row] = await t.db<{ status: string }[]>`
            select status from chain_txs where id = ${id}
          `;
            return row?.status === "sent";
          }, "the lane's charge to be broadcast");
        }
        throw new TestHedgingLaneDownError();
      });
      t.startWatcher({
        txSender: sender,
        hedgeFinalizer: finalizer,
        finalizeFailuresBeforeSafetyNet: 1,
      });
      await waitFor(async () => {
        const onchain = await t.driver.getCampaign(campaign.onchainId);
        return onchain.released && onchain.merchantDue === 0n && onchain.lockedRefunds === 0n;
      }, "the campaign to be finished");

      // No chargeHedge reverted or failed: the lane's and the safety net's are all mined.
      const charges = await t.db<
        { id: string; status: string; last_error: string | null; ticket_ids: string[] }[]
      >`
      select id, status, last_error, payload -> 'ticketIds' as ticket_ids
      from chain_txs where kind = 'chargeHedge' order by created_at
    `;
      process.stdout.write(
        `[safety net and lane charge, ${node}] chargeHedge rows: ${charges
          .map(
            (row) =>
              `${row.status}${row.last_error === null ? "" : ` (${row.last_error})`} [${row.ticket_ids.join(", ")}]`,
          )
          .join("; ")}\n`,
      );
      expect(charges.map((row) => ({ status: row.status, error: row.last_error }))).toEqual(
        charges.map(() => ({ status: "mined", error: null })),
      );
      expect(charges.find((row) => row.id === laneTxId)?.ticket_ids).toEqual(
        laneTickets.map(String),
      );
      // Positive control: the lane's charge was in the outbox when the safety net ran.
      expect(
        t.logs.some(
          (entry) =>
            typeof entry.msg === "string" &&
            entry.msg.includes("the safety net waits for them before cutting its batches"),
        ),
      ).toBe(true);
      // The safety net left the lane's tickets out.
      for (const row of charges.filter((candidate) => candidate.id !== laneTxId)) {
        for (const ticketId of laneTickets)
          expect(row.ticket_ids).not.toContain(ticketId.toString());
      }
      // Every ticket charged exactly once on-chain: the lane's at its amounts, the others by the
      // safety net (the lot cost, zero when never allocated).
      const onchain = await hedgeCharges(t);
      expect(onchain.size).toBe(campaign.ticketIds.length);
      expect(onchain.get(t1)).toEqual([300_000n]);
      expect(onchain.get(t2)).toEqual([400_000n]);
      expect(onchain.get(t3)).toEqual([500_000n]);
      expect(onchain.get(t4)).toEqual([600_000n]);
      for (const ticketId of campaign.ticketIds.slice(4))
        expect(onchain.get(ticketId)).toEqual([0n]);
      const final = await t.driver.getCampaign(campaign.onchainId);
      expect(final.hedgeSpent).toBe(1_800_000n);
      expect(final.hedgeReserved).toBe(0n);
      expect(finalizer.calls.length).toBeGreaterThanOrEqual(1);
    },
    120_000,
  );
});
