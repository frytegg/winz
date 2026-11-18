/**
 * The pause rule's "this request's own pause was seen on-chain" (`job_pause_projected`, store.ts)
 * reads the request's `setPaused` row of the outbox: its `payload ->> 'requestId'` and the hash it
 * records as mined. A fee bump rewrites that row (`replaceAttempt`: a new hash, the payload merged
 * with the signed attempts) before it is mined. Played here with the engine's real pieces: the
 * real job worker and set_paused handler, the real transaction sender on a local chain with the
 * real escrow, the handler projecting the receipt with the projector's own function. Whichever
 * attempt is mined, the request's pause must read as seen once it is projected.
 */
import { randomUUID } from "node:crypto";

import type { Hex } from "viem";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { JOB_KINDS, jobIdempotencyKey, setPausedJobSchema } from "@winz/shared";

import { TxSender } from "../chain";
import { TEST_SENDER_CONFIG, transientError, waitUntil, wrapClient } from "../chain/test-support";
import { SENDER_STATE_KEY, type SenderState, type TxSenderConfig } from "../chain/types";
import { enqueueJob } from "../jobs/enqueue";
import { createSetPausedHandler } from "../jobs/handlers/campaign-actions";
import {
  createJobsHarness,
  createLiveCampaign,
  getCampaign,
  type JobsHarness,
  type LiveCampaign,
} from "../jobs/handlers/test-support";
import { JobWorker } from "../jobs/worker";
import { isManuallyPaused } from "./manual-pause";
import { loadCampaignSaleRows, loadManualPauseInput } from "./store";

const ONCHAIN_PAUSED = 1;

/**
 * One fee bump, a second after the first attempt is broadcast without being mined: long enough
 * for the test to see the first attempt in the node's mempool before it is replaced.
 */
const ONE_BUMP: Partial<TxSenderConfig> = {
  replaceAfterMs: 1_000,
  maxFeeBumps: 1,
  feeBumpPercent: 25,
};

let harness: JobsHarness;
const stops: (() => Promise<void>)[] = [];

beforeAll(async () => {
  harness = await createJobsHarness({ sender: ONE_BUMP });
}, 60_000);

afterAll(async () => {
  await harness?.close();
});

afterEach(async () => {
  while (stops.length > 0) await stops.pop()?.();
  await harness.anvil.rpc("evm_setAutomine", [true]);
});

/** What POST /api/campaigns/:id/pause writes: the sale state, then the job row. */
async function requestPause(campaignId: string): Promise<string> {
  const requestId = randomUUID();
  await harness.db.begin(async (tx) => {
    await tx`update campaigns set sale_state = 'paused_manual' where id = ${campaignId}`;
    await enqueueJob(tx, {
      kind: JOB_KINDS.setPaused,
      payload: { campaignId, paused: true, requestId },
      idempotencyKey: jobIdempotencyKey.setPaused(requestId),
    });
  });
  return requestId;
}

/** The real worker with the real set_paused handler, sending through `txSender`. */
function startWorker(txSender: TxSender): void {
  const handler = createSetPausedHandler(harness.deps({ txSender }));
  const worker = new JobWorker({
    db: harness.db,
    logger: harness.logger,
    config: {
      concurrency: 1,
      pollIntervalMs: 10,
      visibilityTimeoutMs: 30_000,
      workerId: `fee-bump-worker-${randomUUID().slice(0, 8)}`,
      backoff: () => 20,
      shutdownGraceMs: 5_000,
    },
  });
  worker.register(JOB_KINDS.setPaused, setPausedJobSchema, handler);
  worker.start();
  stops.push(() => worker.stop());
}

interface SetPausedRow {
  status: string;
  tx_hash: string | null;
  payload: Record<string, unknown>;
}

async function setPausedRows(requestId: string): Promise<SetPausedRow[]> {
  return harness.db<SetPausedRow[]>`
    select status, tx_hash, payload from chain_txs
    where kind = 'setPaused' and payload ->> 'requestId' = ${requestId}
    order by created_at
  `;
}

function attemptHashes(row: SetPausedRow | undefined): string[] {
  const state = row?.payload[SENDER_STATE_KEY] as SenderState | undefined;
  return state?.attempts.map((attempt) => attempt.hash) ?? [];
}

async function jobStatus(requestId: string): Promise<string | undefined> {
  const [row] = await harness.db<{ status: string }[]>`
    select status from jobs
    where kind = ${JOB_KINDS.setPaused} and payload ->> 'requestId' = ${requestId}
  `;
  return row?.status;
}

/**
 * Pauses `campaign` with the chain not mining: waits for the first attempt in the node's mempool,
 * then for the sender to replace it once, then mines one block and waits for the job to end done.
 * Returns the request id and the two attempts' hashes, in order.
 */
async function pauseThroughOneFeeBump(
  campaign: LiveCampaign,
  txSender: TxSender,
): Promise<{ requestId: string; attempts: string[] }> {
  await harness.anvil.rpc("evm_setAutomine", [false]);
  const requestId = await requestPause(campaign.campaignId);
  startWorker(txSender);
  // `sent` is stored before the broadcast: wait until the node holds the first attempt.
  await waitUntil(
    async () => {
      const [first] = attemptHashes((await setPausedRows(requestId))[0]);
      if (first === undefined) return false;
      return (await harness.anvil.rpc("eth_getTransactionByHash", [first])) !== null;
    },
    "the first attempt broadcast",
    15_000,
  );
  await waitUntil(
    async () => attemptHashes((await setPausedRows(requestId))[0]).length === 2,
    "one fee bump",
    15_000,
  );
  const attempts = attemptHashes((await setPausedRows(requestId))[0]);
  await harness.anvil.rpc("evm_mine", []);
  await waitUntil(async () => (await jobStatus(requestId)) === "done", "the job done", 15_000);
  return { requestId, attempts };
}

/** The request's row is mined under `minedHash`, which carries its projected CampaignPaused. */
async function expectMinedUnder(requestId: string, minedHash: string | undefined): Promise<void> {
  const rows = await setPausedRows(requestId);
  // The outbox kept the request id through the bump: still one row, found by it.
  expect(rows).toHaveLength(1);
  expect(rows[0]?.status).toBe("mined");
  expect(minedHash).toBeDefined();
  expect(rows[0]?.tx_hash).toBe(minedHash);
  const events = await harness.db<{ name: string; args: unknown; processed: boolean }[]>`
    select name, args, processed_at is not null as processed from chain_events
    where tx_hash = ${minedHash ?? ""}
  `;
  expect(events).toEqual([{ name: "CampaignPaused", args: expect.anything(), processed: true }]);
}

async function expectOwnPauseSeen(campaign: LiveCampaign): Promise<void> {
  expect((await getCampaign(harness, campaign.onchainId)).status).toBe(ONCHAIN_PAUSED);
  const input = await loadManualPauseInput(harness.db, campaign.campaignId);
  expect(input).toEqual({
    status: "paused",
    pauseJobInFlight: false,
    pauseEventUnprojected: false,
    latestPauseJob: { paused: true, pauseProjected: true },
  });
  expect(input === null ? null : isManuallyPaused(input)).toBe(true);
  const { rows } = await loadCampaignSaleRows(harness.db, [campaign.symbol]);
  expect(rows.find((row) => row.id === campaign.campaignId)?.latestPauseJob).toEqual({
    paused: true,
    pauseProjected: true,
  });
}

describe("a pause whose setPaused transaction is fee-bumped once before it is mined", () => {
  it("the replacement is mined: the request's own pause reads as seen", async () => {
    const campaign = await createLiveCampaign(harness, "bump-replacement");
    const { requestId, attempts } = await pauseThroughOneFeeBump(campaign, harness.sender);
    expect(new Set(attempts).size).toBe(2);
    await expectMinedUnder(requestId, attempts[1]);
    await expectOwnPauseSeen(campaign);
  });

  it("the first attempt is mined after its replacement was stored: the row records the first hash, the pause reads as seen", async () => {
    const campaign = await createLiveCampaign(harness, "bump-first-wins");
    // A sender whose replacements never reach the node (lost on the way): only the first attempt
    // is in the mempool when the block is mined, while the row holds the replacement's hash. The
    // harness's own sender is stopped meanwhile, so one sender serves the relayer key.
    await harness.sender.stop();
    stops.push(() => harness.sender.start());
    const broadcast = new Set<Hex>();
    const client = wrapClient(harness.escrow.publicClient, {
      sendRawTransaction: (request) => {
        broadcast.add(request.serializedTransaction);
        return broadcast.size === 1
          ? harness.escrow.publicClient.sendRawTransaction(request)
          : Promise.reject(transientError());
      },
    });
    const sender = new TxSender({
      db: harness.db,
      client,
      accounts: {
        relayer: harness.escrow.accounts.relayer,
        oracle: harness.escrow.accounts.oracle,
      },
      logger: harness.logger.child({ module: "tx-sender" }),
      config: {
        chainId: harness.escrow.chainId,
        escrowAddress: harness.escrow.escrow,
        ...TEST_SENDER_CONFIG,
        ...ONE_BUMP,
      },
    });
    await sender.start();
    stops.push(() => sender.stop());

    const { requestId, attempts } = await pauseThroughOneFeeBump(campaign, sender);
    expect(new Set(attempts).size).toBe(2);
    expect(broadcast.size).toBe(2);
    await expectMinedUnder(requestId, attempts[0]);
    await expectOwnPauseSeen(campaign);
  });
});
