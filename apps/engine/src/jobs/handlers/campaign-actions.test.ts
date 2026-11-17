/** The manual pause, resume and close jobs on the real contract. */
import { randomUUID } from "node:crypto";

import { encodeFunctionData } from "viem";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { JOB_KINDS, jobIdempotencyKey, winzEscrowAbi } from "@winz/shared";

import { enqueueJob } from "../enqueue";
import { RetryLaterError } from "../errors";
import { createCloseSalesHandler, createSetPausedHandler } from "./campaign-actions";
import {
  createJobsHarness,
  createLiveCampaign,
  getCampaign,
  logsAt,
  runHandler,
  txRows,
  type JobsHarness,
} from "./test-support";

let harness: JobsHarness;

beforeAll(async () => {
  harness = await createJobsHarness();
});

afterAll(async () => {
  await harness?.close();
});

afterEach(() => {
  harness.outage.active = false;
});

async function campaignRow(
  campaignId: string,
): Promise<{ status: string; sale_state: string; sales_close: Date }> {
  const [row] = await harness.db<{ status: string; sale_state: string; sales_close: Date }[]>`
    select status, sale_state, sales_close from campaigns where id = ${campaignId}
  `;
  if (row === undefined) throw new Error(`no campaign ${campaignId}`);
  return row;
}

async function liveRow(campaignId: string): Promise<string | undefined> {
  const [row] = await harness.db<{ sale_state: string }[]>`
    select l.sale_state from live_campaigns l join campaigns c on c.slug = l.slug
    where c.id = ${campaignId}
  `;
  return row?.sale_state;
}

function setPaused(
  options: Parameters<JobsHarness["deps"]>[1] = {},
): ReturnType<typeof createSetPausedHandler> {
  return createSetPausedHandler(harness.deps({}, options));
}

/** What POST /api/campaigns/:id/pause and /resume write: the sale state, then the job row. */
async function requestPause(campaignId: string, paused: boolean): Promise<string> {
  const requestId = randomUUID();
  if (paused) {
    await harness.db`update campaigns set sale_state = 'paused_manual' where id = ${campaignId}`;
  }
  await enqueueJob(harness.db, {
    kind: JOB_KINDS.setPaused,
    payload: { campaignId, paused, requestId },
    idempotencyKey: jobIdempotencyKey.setPaused(requestId),
  });
  return requestId;
}

function closeSales(): ReturnType<typeof createCloseSalesHandler> {
  return createCloseSalesHandler(harness.deps());
}

describe("manual pause and resume", () => {
  it("pauses and resumes on-chain, and the database follows", async () => {
    const live = await createLiveCampaign(harness, "pause");
    // The web app writes the manual pause first, then enqueues the job.
    await harness.db`update campaigns set sale_state = 'paused_manual' where id = ${live.campaignId}`;
    const pause = { campaignId: live.campaignId, paused: true, requestId: randomUUID() };
    await runHandler(harness, setPaused(), pause);

    expect((await getCampaign(harness, live.onchainId)).status).toBe(1); // Paused
    expect(await campaignRow(live.campaignId)).toMatchObject({
      status: "paused",
      sale_state: "paused_manual",
    });
    expect(await liveRow(live.campaignId)).toBe("paused_manual");

    // The same job again: no second transaction, nothing changes.
    await runHandler(harness, setPaused(), pause);
    expect(await txRows(harness, `setPaused:${pause.requestId}`)).toHaveLength(1);
    expect((await getCampaign(harness, live.onchainId)).status).toBe(1);

    // Another pause request while paused: the chain is already paused, so nothing is sent and
    // the job ends cleanly.
    const again = { campaignId: live.campaignId, paused: true, requestId: randomUUID() };
    await runHandler(harness, setPaused(), again);
    expect(await txRows(harness, `setPaused:${again.requestId}`)).toHaveLength(0);
    expect((await getCampaign(harness, live.onchainId)).status).toBe(1);

    const resume = { campaignId: live.campaignId, paused: false, requestId: randomUUID() };
    await runHandler(harness, setPaused(), resume);
    expect((await getCampaign(harness, live.onchainId)).status).toBe(0); // Live
    expect(await campaignRow(live.campaignId)).toMatchObject({
      status: "live",
      sale_state: "open",
    });
    expect(await liveRow(live.campaignId)).toBe("open");
  });
});

describe("manual pause and resume: the merchant's last request wins", () => {
  it("does not let a pause handled after the resume that followed it pause the promo", async () => {
    const live = await createLiveCampaign(harness, "late-pause");
    const pause = await requestPause(live.campaignId, true);
    const resume = await requestPause(live.campaignId, false);

    // The resume job runs first (the pause job was deferred, or simply slower).
    await runHandler(harness, setPaused(), {
      campaignId: live.campaignId,
      paused: false,
      requestId: resume,
    });
    await runHandler(harness, setPaused(), {
      campaignId: live.campaignId,
      paused: true,
      requestId: pause,
    });

    expect((await getCampaign(harness, live.onchainId)).status).toBe(0); // Live
    expect(await campaignRow(live.campaignId)).toMatchObject({
      status: "live",
      sale_state: "open",
    });
    expect(await txRows(harness, `setPaused:${pause}`)).toHaveLength(0);
    expect(await txRows(harness, `setPaused:${resume}`)).toHaveLength(0);
  });

  it("waits for a pause in flight before resuming, and the late pause does not undo the resume", async () => {
    const live = await createLiveCampaign(harness, "inflight-pause");
    const pause = await requestPause(live.campaignId, true);
    const pauseJob = { campaignId: live.campaignId, paused: true, requestId: pause };

    // The pause is signed and sent, but the node is down: its outcome is unknown.
    harness.outage.active = true;
    await expect(
      runHandler(harness, setPaused({ waitTimeoutMs: 500 }), pauseJob),
    ).rejects.toBeInstanceOf(RetryLaterError);
    expect((await txRows(harness, `setPaused:${pause}`)).map((tx) => tx.status)).toEqual(["sent"]);

    // The merchant resumes meanwhile. The resume job waits for the pause, it sends nothing yet.
    const resume = await requestPause(live.campaignId, false);
    const resumeJob = { campaignId: live.campaignId, paused: false, requestId: resume };
    await expect(
      runHandler(harness, setPaused({ waitTimeoutMs: 500 }), resumeJob),
    ).rejects.toBeInstanceOf(RetryLaterError);
    expect(await txRows(harness, `setPaused:${resume}`)).toHaveLength(0);

    // The node is back: the pause is mined, then the resume undoes it.
    harness.outage.active = false;
    await runHandler(harness, setPaused(), resumeJob);
    expect((await txRows(harness, `setPaused:${pause}`)).map((tx) => tx.status)).toEqual(["mined"]);
    expect((await txRows(harness, `setPaused:${resume}`)).map((tx) => tx.status)).toEqual([
      "mined",
    ]);
    // The pause job's retry projects its receipt and must not put the manual pause back.
    await runHandler(harness, setPaused(), pauseJob);

    expect((await getCampaign(harness, live.onchainId)).status).toBe(0); // Live
    expect(await campaignRow(live.campaignId)).toMatchObject({
      status: "live",
      sale_state: "open",
    });
    expect(await liveRow(live.campaignId)).toBe("open");
  });
});

describe("closing sales", () => {
  it("sends a new attempt when an earlier one failed for a reason that no longer holds", async () => {
    const live = await createLiveCampaign(harness, "close-retry");
    // An earlier attempt failed: the key was not the relayer's (Unauthorized), as when the
    // relayer is not authorised yet. Nothing was mined.
    const { id } = await harness.sender.enqueue({
      idempotencyKey: `closeSales:${live.campaignId}`,
      signer: "oracle",
      kind: "closeSales",
      to: harness.escrow.escrow,
      data: encodeFunctionData({
        abi: winzEscrowAbi,
        functionName: "closeSales",
        args: [live.onchainId],
      }),
      payload: { campaignId: live.campaignId },
    });
    const failed = await harness.sender.waitFor(id, { timeoutMs: 20_000 });
    expect([failed.status, failed.error]).toEqual(["failed", "Unauthorized"]);

    await runHandler(harness, closeSales(), { campaignId: live.campaignId });

    const rows = await txRows(harness, `closeSales:${live.campaignId}`);
    expect(rows.map((tx) => [tx.idempotency_key, tx.status, tx.last_error])).toEqual([
      [`closeSales:${live.campaignId}`, "failed", "Unauthorized"],
      [`closeSales:${live.campaignId}:2`, "mined", null],
    ]);
    expect(await campaignRow(live.campaignId)).toMatchObject({
      status: "sales_closed",
      sale_state: "closed",
    });
  });

  it("closes sales on-chain, the database follows, and a repeated job is harmless", async () => {
    const live = await createLiveCampaign(harness, "close");
    const before = await getCampaign(harness, live.onchainId);
    await runHandler(harness, closeSales(), { campaignId: live.campaignId });

    const after = await getCampaign(harness, live.onchainId);
    expect(after.salesClose).toBeLessThan(before.salesClose);
    expect(after.salesClose).toBeLessThanOrEqual(await harness.escrow.latestTimestamp());
    const row = await campaignRow(live.campaignId);
    expect(row.status).toBe("sales_closed");
    expect(row.sale_state).toBe("closed");
    expect(BigInt(Math.floor(row.sales_close.getTime() / 1000))).toBe(after.salesClose);
    expect(await liveRow(live.campaignId)).toBe("closed");

    await runHandler(harness, closeSales(), { campaignId: live.campaignId });
    expect(await txRows(harness, `closeSales:${live.campaignId}`)).toHaveLength(1);
    expect((await getCampaign(harness, live.onchainId)).salesClose).toBe(after.salesClose);
  });

  it("ends a pause of an already closed campaign cleanly, with a warning", async () => {
    const live = await createLiveCampaign(harness, "closed-pause");
    await runHandler(harness, closeSales(), { campaignId: live.campaignId });
    const warningsBefore = logsAt(harness, 40, "setPaused no longer possible").length;

    const pause = { campaignId: live.campaignId, paused: true, requestId: randomUUID() };
    await runHandler(harness, setPaused(), pause);

    const rows = await txRows(harness, `setPaused:${pause.requestId}`);
    expect(rows.map((tx) => [tx.status, tx.last_error])).toEqual([["failed", "SalesAreClosed"]]);
    expect((await getCampaign(harness, live.onchainId)).status).toBe(0);
    expect(await campaignRow(live.campaignId)).toMatchObject({
      status: "sales_closed",
      sale_state: "closed",
    });
    expect(logsAt(harness, 40, "setPaused no longer possible").length).toBe(warningsBefore + 1);
  });

  it("refuses a campaign that is not on-chain", async () => {
    const { campaignId } = await (async () => {
      const live = await createLiveCampaign(harness, "offchain");
      await harness.db`update campaigns set onchain_id = null where id = ${live.campaignId}`;
      return live;
    })();
    await expect(runHandler(harness, closeSales(), { campaignId })).rejects.toThrow(
      /is not on-chain/,
    );
  });
});
