/**
 * The safety net and a charge of the hedging lane that does not become final (SPEC 9.5, ST-3):
 * `waitForOtherCharges` waits for it at most `txWaitTimeoutMs`, says so once, and the safety net
 * goes on as without the wait. It never stops the run for it: a lane charge that stays in the
 * outbox must not hold back the charges, `settle`, the refunds or the release for ever.
 *
 * Twice:
 *
 * - The lane's charge is refused by the node at every broadcast (a wrapped client), as on a real
 *   outage of that one transaction. It holds the oracle key's next nonce, so the sender signs
 *   nothing else of the oracle until a node takes it: the safety net, after its one timeout,
 *   queues its own batch behind it, and the run then stops at that batch ("hedge charges are not
 *   all final"), which is the oracle queue, not the safety net, waiting. That is not a stall of
 *   the settlement: nothing of the oracle (`settle` included) could be mined meanwhile whatever
 *   the watcher did, and once the node takes the lane's charge, the next passes go on and finish.
 * - The lane's charge is a `sent` row of another key, which the running sender does not drive
 *   (written by the test: the engine refuses to start a sender while such a row exists, so it
 *   stands for any charge that never becomes final without holding the oracle queue). The
 *   settlement finishes while it is still in the outbox.
 */
import { createHash } from "node:crypto";

import { parseTransaction, type Hex } from "viem";
import { afterEach, describe, expect, it } from "vitest";

import { transientError, wrapClient } from "../chain/test-support";
import { chargeHedgeTxRequest } from "../hedging/allocation";
import { ESCROW_STATUS } from "./plan";
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
  type CampaignFixture,
  type SettlementEnv,
} from "./test-support";

let current: SettlementEnv | undefined;

afterEach(async () => {
  await current?.close();
  current = undefined;
});

/** The safety net's wait, short so that the lane's charge outlasts it within the test. */
const TX_WAIT_TIMEOUT_MS = 1_000;

/** The message of the safety net's warning when the charges it waited for are not final. */
const TIMEOUT_WARNING = "are not final within the wait: the safety net charges without them";

/** The hedging lane failing after it queued its charge (an outage, a timeout). */
class TestHedgingLaneDownError extends Error {
  constructor() {
    super("the hedging lane is down");
    this.name = "TestHedgingLaneDownError";
  }
}

/** A finalizer that always fails, as the lane does once its charge is queued. */
function failingFinalizer(): FakeHedgeFinalizer {
  return new FakeHedgeFinalizer(() => Promise.reject(new TestHedgingLaneDownError()));
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

interface Lane {
  campaign: CampaignFixture;
  laneTickets: bigint[];
  laneAmounts: bigint[];
  request: ReturnType<typeof chargeHedgeTxRequest>;
}

/**
 * Six tickets, four of them with an allocated lot (costs 0.3, 0.4, 0.5 and 0.6 USDC); the
 * lane's own charge of the first two, at their lot costs (`chargeHedgeTxRequest`, key
 * `chargeHedge:rt:<hash>:<n>`: its row names no campaign, only tickets). Sales closed, result NO.
 */
async function setUpCampaign(t: SettlementEnv): Promise<Lane> {
  const campaign = await t.createCampaign({
    buyers: Array.from({ length: 6 }, (_, index) => buyerAddress(index + 1)),
    unitPrice: 10n * USDC,
    budget: 100n * USDC,
    maxHedgeCost: USDC,
  });
  const [t1, t2, t3, t4] = campaign.ticketIds as [bigint, bigint, bigint, bigint];
  await allocateLot(t.db, t1, 300_000n, 1_000_000n);
  await allocateLot(t.db, t2, 400_000n, 1_000_000n);
  await allocateLot(t.db, t3, 500_000n, 1_000_000n);
  await allocateLot(t.db, t4, 600_000n, 1_000_000n);
  const laneTickets = [t1, t2];
  const laneAmounts = [300_000n, 400_000n];
  const hash = createHash("sha256");
  laneTickets.forEach((ticketId, index) => {
    hash.update(`${ticketId.toString()}:${String(laneAmounts[index])};`);
  });
  const request = chargeHedgeTxRequest(
    {
      isolated: false,
      ticketIds: laneTickets,
      amounts: laneAmounts,
      lots: [],
      idempotencyKey: `chargeHedge:rt:${hash.digest("hex")}:0`,
    },
    t.env.escrow,
  );
  await t.env.advanceTime(HOUR + 1n);
  await setInstrumentOutcome(t.db, SYMBOL, "no");
  return { campaign, laneTickets, laneAmounts, request };
}

interface ChargeRow {
  id: string;
  status: string;
  error: string | null;
  source: string | null;
  tickets: string[];
}

async function chargeRows(t: SettlementEnv): Promise<ChargeRow[]> {
  const rows = await t.db<
    {
      id: string;
      status: string;
      last_error: string | null;
      source: string | null;
      ticket_ids: string[];
    }[]
  >`
    select id, status, last_error, payload ->> 'source' as source,
           payload -> 'ticketIds' as ticket_ids
    from chain_txs where kind = 'chargeHedge' order by created_at, id
  `;
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    error: row.last_error,
    source: row.source,
    tickets: row.ticket_ids,
  }));
}

function describeRows(rows: readonly ChargeRow[]): string {
  return rows
    .map(
      (row) =>
        `${row.source ?? "lane"} ${row.status}${row.error === null ? "" : ` (${row.error})`} [${row.tickets.join(", ")}]`,
    )
    .join("; ");
}

function timeoutWarnings(t: SettlementEnv): number {
  return t.logs.filter(
    (entry) =>
      entry.level === 40 && typeof entry.msg === "string" && entry.msg.includes(TIMEOUT_WARNING),
  ).length;
}

/** The details of the watcher's "campaign settlement pass" lines, in order. */
function passDetails(t: SettlementEnv): string[] {
  return t.logs
    .filter((entry) => entry.msg === "campaign settlement pass")
    .map((entry) => String(entry.detail));
}

async function finished(t: SettlementEnv, campaign: CampaignFixture): Promise<boolean> {
  const onchain = await t.driver.getCampaign(campaign.onchainId);
  return onchain.released && onchain.merchantDue === 0n && onchain.lockedRefunds === 0n;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("the safety net while a charge of the hedging lane never becomes final within its wait", () => {
  it("broadcast refused: one timeout warning, its own batch queued behind the lane's charge, and once the node takes that charge the settlement finishes, every ticket charged once", async () => {
    const refusal = { laneData: null as Hex | null };
    const t = await createSettlementEnv({
      senderClient: (client) =>
        wrapClient(client, {
          sendRawTransaction: (request) => {
            const { data } = parseTransaction(request.serializedTransaction);
            if (refusal.laneData !== null && data === refusal.laneData) {
              return Promise.reject(transientError());
            }
            return client.sendRawTransaction(request);
          },
        }),
    });
    current = t;
    const lane = await setUpCampaign(t);
    const { campaign } = lane;
    const [t1, t2, t3, t4] = campaign.ticketIds as [bigint, bigint, bigint, bigint];
    const sender = await t.startSender();

    // The lane queued its charge and failed; no node takes that charge.
    refusal.laneData = lane.request.data.toLowerCase() as Hex;
    const laneTxId = (await sender.enqueue(lane.request)).id;
    await waitFor(
      () =>
        Promise.resolve(
          t.logs.some(
            (entry) => entry.id === laneTxId && entry.msg === "broadcast failed, retrying",
          ),
        ),
      "the lane's charge to be refused by the node",
    );

    const finalizer = failingFinalizer();
    t.startWatcher({
      txSender: sender,
      hedgeFinalizer: finalizer,
      finalizeFailuresBeforeSafetyNet: 1,
      txWaitTimeoutMs: TX_WAIT_TIMEOUT_MS,
    });

    // The safety net waited for the lane's charge, gave up waiting once, and went on: its batch
    // is in the outbox while the lane's charge is still not final.
    await waitFor(async () => {
      const rows = await chargeRows(t);
      return timeoutWarnings(t) >= 1 && rows.some((row) => row.source === "settlement-safety-net");
    }, "the safety net to give up waiting and queue its own batch");
    // Where the run stops meanwhile: at the safety net's own batch, which the oracle queue holds
    // behind the lane's charge (its nonce comes first), pass after pass.
    await waitFor(
      () =>
        Promise.resolve(
          passDetails(t).includes("hedge charges of a previous run are not final yet"),
        ),
      "a pass stopped at the safety net's own batch",
    );
    // A few more passes: the timeout is not logged again, and nothing else of the oracle moves.
    await sleep(3 * TX_WAIT_TIMEOUT_MS);
    const blocked = await chargeRows(t);
    process.stdout.write(
      `[safety net, lane charge refused by the node] while refused: ${describeRows(blocked)}; passes: ${passDetails(t).join(" | ")}\n`,
    );
    expect(timeoutWarnings(t)).toBe(1);
    expect(blocked.find((row) => row.id === laneTxId)?.status).toBe("sent");
    const firstBatch = blocked.filter((row) => row.source === "settlement-safety-net");
    expect(firstBatch).toHaveLength(1);
    // It went on without the lane's charge: the lane's tickets were still uncharged when it read
    // them, so they are in its batch.
    expect(firstBatch[0]?.tickets).toEqual(campaign.ticketIds.map(String));
    expect(firstBatch[0]?.status).toBe("queued");
    const [settleRows] = await t.db<{ n: bigint }[]>`
      select count(*)::bigint as n from chain_txs where kind = 'settle'
    `;
    expect(settleRows?.n).toBe(0n);
    expect(await finished(t, campaign)).toBe(false);

    // The node takes the lane's charge: the next passes go on and finish.
    refusal.laneData = null;
    await waitFor(() => finished(t, campaign), "the campaign to be finished", 60_000);

    const rows = await chargeRows(t);
    process.stdout.write(
      `[safety net, lane charge refused by the node] at the end: ${describeRows(rows)}\n`,
    );
    expect(rows.find((row) => row.id === laneTxId)).toMatchObject({ status: "mined", error: null });
    const safetyNet = rows.filter((row) => row.source === "settlement-safety-net");
    // Its first batch held the lane's tickets: once the lane's charge is mined, it is refused
    // with HedgeAlreadyCharged (in simulation, no nonce, or on-chain), and the next pass charges
    // the tickets still uncharged.
    expect(safetyNet[0]?.id).toBe(firstBatch[0]?.id);
    expect(["failed", "reverted"]).toContain(safetyNet[0]?.status);
    expect(safetyNet[0]?.error).toBe("HedgeAlreadyCharged");
    expect(safetyNet.slice(1)).toEqual([
      expect.objectContaining({
        status: "mined",
        error: null,
        tickets: campaign.ticketIds.slice(2).map(String),
      }),
    ]);
    // Every ticket charged exactly once on-chain: the lane's at its amounts, the others by the
    // safety net (the lot cost, zero when never allocated).
    const onchain = await hedgeCharges(t);
    expect(onchain.size).toBe(campaign.ticketIds.length);
    expect(onchain.get(t1)).toEqual([300_000n]);
    expect(onchain.get(t2)).toEqual([400_000n]);
    expect(onchain.get(t3)).toEqual([500_000n]);
    expect(onchain.get(t4)).toEqual([600_000n]);
    for (const ticketId of campaign.ticketIds.slice(4)) expect(onchain.get(ticketId)).toEqual([0n]);
    const final = await t.driver.getCampaign(campaign.onchainId);
    expect(final.hedgeSpent).toBe(1_800_000n);
    expect(final.hedgeReserved).toBe(0n);
    expect(final.status).toBe(ESCROW_STATUS.settledNo);
    // The one timeout, no more.
    expect(timeoutWarnings(t)).toBe(1);
  }, 120_000);

  it("a lane charge the running sender does not drive: one timeout warning, and the settlement finishes while that charge is still in the outbox", async () => {
    const t = await createSettlementEnv();
    current = t;
    const lane = await setUpCampaign(t);
    const { campaign } = lane;
    const [t1, t2, t3, t4] = campaign.ticketIds as [bigint, bigint, bigint, bigint];
    const sender = await t.startSender();

    // The lane's charge, `sent` by a key this sender does not have: it is never final.
    const [laneRow] = await t.db<{ id: string }[]>`
      insert into chain_txs (idempotency_key, signer, kind, to_address, data, payload, status,
                             nonce, signer_address, chain_id, tx_hash, attempts, sent_at)
      values (${lane.request.idempotencyKey}, 'oracle', 'chargeHedge',
              ${t.env.escrow.toLowerCase()}, ${lane.request.data.toLowerCase()},
              ${t.db.json({ ticketIds: lane.laneTickets.map(String), amounts: lane.laneAmounts.map(String) })},
              'sent', 0, ${"0x" + "0d".repeat(20)}, ${t.env.chainId}, ${"0x" + "ab".repeat(32)},
              1, now())
      returning id
    `;
    const laneTxId = laneRow?.id as string;

    t.startWatcher({
      txSender: sender,
      hedgeFinalizer: failingFinalizer(),
      finalizeFailuresBeforeSafetyNet: 1,
      txWaitTimeoutMs: TX_WAIT_TIMEOUT_MS,
    });
    await waitFor(() => finished(t, campaign), "the campaign to be finished", 60_000);

    const rows = await chargeRows(t);
    process.stdout.write(
      `[safety net, lane charge never final] ${describeRows(rows)}; passes: ${passDetails(t).join(" | ")}\n`,
    );
    expect(timeoutWarnings(t)).toBe(1);
    // Still in the outbox, never final: the settlement did not wait for it.
    expect(rows.find((row) => row.id === laneTxId)?.status).toBe("sent");
    // The safety net charged every ticket itself, the lane's included, at the lot costs.
    const safetyNet = rows.filter((row) => row.source === "settlement-safety-net");
    expect(safetyNet).toEqual([
      expect.objectContaining({
        status: "mined",
        error: null,
        tickets: campaign.ticketIds.map(String),
      }),
    ]);
    const onchain = await hedgeCharges(t);
    expect(onchain.size).toBe(campaign.ticketIds.length);
    expect(onchain.get(t1)).toEqual([300_000n]);
    expect(onchain.get(t2)).toEqual([400_000n]);
    expect(onchain.get(t3)).toEqual([500_000n]);
    expect(onchain.get(t4)).toEqual([600_000n]);
    for (const ticketId of campaign.ticketIds.slice(4)) expect(onchain.get(ticketId)).toEqual([0n]);
    const final = await t.driver.getCampaign(campaign.onchainId);
    expect(final.status).toBe(ESCROW_STATUS.settledNo);
    expect(final.released).toBe(true);
  }, 120_000);
});
