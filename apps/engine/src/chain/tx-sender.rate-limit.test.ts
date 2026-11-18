/**
 * What a rate-limit answer does to a transaction, call site by call site: it must leave the
 * transaction as it was (not failed, not signed again under another nonce, no nonce burnt) and
 * be asked again after a pause.
 */
import {
  EstimateGasExecutionError,
  LimitExceededRpcError,
  parseTransaction,
  RpcRequestError,
  type Hex,
} from "viem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RpcLimiterClosedError } from "./rpc-limiter";
import {
  createChainHarness,
  REVERTING_CALL_DATA,
  rowInconsistency,
  TEST_REVERT_ERROR,
  waitUntil,
  wrapClient,
  type ChainHarness,
} from "./test-support";
import type { ChainClient } from "./types";

/** What viem throws when Arc's public RPC answers HTTP 429 with -32005. */
function rateLimited(method: string): Error {
  return new LimitExceededRpcError(
    new RpcRequestError({
      body: { method },
      error: { code: -32005, message: "rate limit exceeded" },
      url: "https://rpc.testnet.arc.io",
      status: 429,
      headers: new Headers(),
    }),
  );
}

/** A call that is refused `times` times, then forwarded; counts both. */
function refusing<Args extends unknown[], Result>(
  times: number,
  method: string,
  forward: (...args: Args) => Promise<Result>,
  when: (...args: Args) => boolean = () => true,
): { call: (...args: Args) => Promise<Result>; refused: () => number; forwarded: () => number } {
  let refused = 0;
  let forwarded = 0;
  return {
    call: (...args: Args): Promise<Result> => {
      if (when(...args) && refused < times) {
        refused += 1;
        return Promise.reject(rateLimited(method));
      }
      forwarded += 1;
      return forward(...args);
    },
    refused: () => refused,
    forwarded: () => forwarded,
  };
}

describe("TxSender when the node rate-limits it", () => {
  let h: ChainHarness;

  beforeEach(async () => {
    h = await createChainHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  /** Sends one bump through a sender on `client`, and checks the row is the clean outcome. */
  async function sendThrough(
    client: ChainClient,
    key: string,
    config: Parameters<ChainHarness["createSender"]>[0] extends infer O
      ? O extends { config?: infer C }
        ? C
        : never
      : never = {},
  ): Promise<void> {
    const sender = h.createSender({ client, config });
    await sender.start();
    const outcome = await sender.sendAndWait(h.bumpRequest("relayer", key));
    expect(outcome.status).toBe("mined");
    const [row] = await h.rows();
    expect(row).toMatchObject({ status: "mined", nonce: 0n, lastError: null });
    expect(row && rowInconsistency(row)).toBeUndefined();
    // Signed once, with nonce 0: nothing signed again, no nonce burnt.
    expect(row?.senderState?.attempts).toHaveLength(1);
    expect(await h.minedCount(h.accounts.relayer.address)).toBe(1);
    expect(await h.counter(h.escrow)).toBe(1n);
  }

  it("nonce: retries the pending count, then signs with the right nonce", async () => {
    const count = refusing(
      3,
      "eth_getTransactionCount",
      (request: { address: `0x${string}`; blockTag: "latest" | "pending" }) =>
        h.client.getTransactionCount(request),
    );
    await sendThrough(wrapClient(h.client, { getTransactionCount: count.call }), "nonce");
    expect(count.refused()).toBe(3);
    const [row] = await h.rows();
    // Preparation ran again after each refusal, but none of them counted as a failure.
    expect(row?.attempts).toBe(1);
    const warned = h.logLines.filter((line) =>
      line.includes("node rate limited the transaction worker, retrying after a pause"),
    );
    expect(warned).toHaveLength(3);
    expect(h.logLines.some((line) => line.includes("transaction worker failed"))).toBe(false);
  });

  it("fees: is never given up for rate limits, whatever the preparation budget", async () => {
    const fees = refusing(5, "eth_feeHistory", () => h.client.estimateFeesPerGas());
    await sendThrough(wrapClient(h.client, { estimateFeesPerGas: fees.call }), "fees", {
      maxPrepareAttempts: 1,
      maxPrepareMs: 0,
    });
    expect(fees.refused()).toBe(5);
    const [row] = await h.rows();
    expect(row?.attempts).toBe(1);
  });

  it("gas estimate and simulation: retried, the row untouched", async () => {
    const estimate = refusing(
      3,
      "eth_estimateGas",
      (request: Parameters<ChainClient["estimateGas"]>[0]) => h.client.estimateGas(request),
    );
    const call = refusing(2, "eth_call", (request: Parameters<ChainClient["call"]>[0]) =>
      h.client.call(request),
    );
    await sendThrough(
      wrapClient(h.client, { estimateGas: estimate.call, call: call.call }),
      "estimate",
      { maxPrepareAttempts: 1, maxPrepareMs: 0 },
    );
    expect(estimate.refused()).toBe(3);
    expect(call.refused()).toBe(2);
    expect((await h.rows())[0]?.attempts).toBe(1);
  });

  it("send: the same signed bytes go out again, without the blocked-queue alert", async () => {
    const seen: Hex[] = [];
    // More refusals than the five that raise the alert for a broadcast the node refuses.
    const send = refusing(
      7,
      "eth_sendRawTransaction",
      (request: { serializedTransaction: Hex }) => {
        return h.client.sendRawTransaction(request);
      },
    );
    const client = wrapClient(h.client, {
      sendRawTransaction: (request) => {
        seen.push(request.serializedTransaction);
        return send.call(request);
      },
    });
    await sendThrough(client, "send");
    expect(send.refused()).toBe(7);
    expect(seen).toHaveLength(8);
    expect(new Set(seen).size).toBe(1);
    expect(parseTransaction(seen[0] as Hex).nonce).toBe(0);
    expect(h.logLines.some((line) => line.includes("the signer's queue is blocked"))).toBe(false);
    // But a refusal that lasts is said once, at error level, where an operator looks.
    const lasting = h.logLines.filter((line) =>
      line.includes("broadcast still rate limited by the node, the signer's queue waits behind it"),
    );
    expect(lasting).toHaveLength(1);
    expect(JSON.parse(lasting[0] ?? "{}")).toMatchObject({ level: 50, rateLimited: 5 });
  });

  it("a request the closed RPC limiter released unsent: the queued row is left untouched", async () => {
    // At shutdown, index.ts closes the limiter: a preparation still waiting for its turn gets
    // RpcLimiterClosedError (wrapped by viem). That is not a failure of the transaction: no
    // attempt counted, no error recorded, never given up, whatever the preparation budget.
    let estimates = 0;
    const client = wrapClient(h.client, {
      estimateGas: () => {
        estimates += 1;
        return Promise.reject(
          new EstimateGasExecutionError(new RpcLimiterClosedError("eth_estimateGas"), {}),
        );
      },
    });
    const sender = h.createSender({ client, config: { maxPrepareAttempts: 1, maxPrepareMs: 0 } });
    await sender.start();
    await sender.enqueue(h.bumpRequest("relayer", "limiter-closed"));
    await waitUntil(() => estimates >= 2, "the preparation asked again");
    await sender.stop();
    const [row] = await h.rows();
    expect(row).toMatchObject({ status: "queued", nonce: null, attempts: 0, lastError: null });
    expect(
      h.logLines.filter((line) => line.includes("node request not sent, the RPC limiter is closed"))
        .length,
    ).toBeGreaterThanOrEqual(2);
    expect(h.logLines.some((line) => line.includes("given up before any nonce"))).toBe(false);
  });

  it("receipt: looked up again until it is found", async () => {
    const receipt = refusing(4, "eth_getTransactionReceipt", (request: { hash: Hex }) =>
      h.client.getTransactionReceipt(request),
    );
    await sendThrough(wrapClient(h.client, { getTransactionReceipt: receipt.call }), "receipt");
    expect(receipt.refused()).toBe(4);
  });

  it("block time: the receipt is recorded with its block's time, not without it", async () => {
    const block = refusing(3, "eth_getBlockByNumber", (request: { blockNumber: bigint }) =>
      h.client.getBlock(request),
    );
    await sendThrough(wrapClient(h.client, { getBlock: block.call }), "block-time");
    expect(block.refused()).toBe(3);
    const [row] = await h.rows();
    const mined = await h.client.getBlock({ blockNumber: row?.blockNumber ?? 0n });
    expect(row?.minedAt?.getTime()).toBe(Number(mined.timestamp) * 1000);
    expect(h.logLines.some((line) => line.includes("block time could not be read"))).toBe(false);
  });

  it("revert reason: asked again, so that the reverted transaction names its error", async () => {
    const replay = refusing(
      2,
      "eth_call",
      (request: Parameters<ChainClient["call"]>[0]) => h.client.call(request),
      (request) => request.blockNumber !== undefined,
    );
    // The simulation is bypassed so that a reverting call reaches the chain.
    const client = wrapClient(h.client, {
      call: (request) =>
        request.blockNumber === undefined ? Promise.resolve({}) : replay.call(request),
      estimateGas: () => Promise.resolve(100_000n),
    });
    const sender = h.createSender({ client });
    await sender.start();
    const outcome = await sender.sendAndWait({
      idempotencyKey: "revert-reason",
      signer: "relayer",
      kind: "test.revert",
      to: h.escrow,
      data: REVERTING_CALL_DATA,
    });
    expect(outcome).toMatchObject({ status: "reverted", error: TEST_REVERT_ERROR });
    expect(replay.refused()).toBe(2);
    const [row] = await h.rows();
    expect(row).toMatchObject({ status: "reverted", nonce: 0n, lastError: TEST_REVERT_ERROR });
  });

  it("replacement: the nonce check and the fee read are retried; one bump, same nonce", async () => {
    await h.anvil.rpc("evm_setAutomine", [false]);
    let replacing = false;
    const latest = refusing(
      2,
      "eth_getTransactionCount",
      (request: { address: `0x${string}`; blockTag: "latest" | "pending" }) =>
        h.client.getTransactionCount(request),
      (request) => request.blockTag === "latest",
    );
    const fees = refusing(
      2,
      "eth_feeHistory",
      () => h.client.estimateFeesPerGas(),
      () => replacing,
    );
    const sender = h.createSender({
      client: wrapClient(h.client, {
        getTransactionCount: (request) => {
          if (request.blockTag === "latest") replacing = true;
          return latest.call(request);
        },
        estimateFeesPerGas: fees.call,
      }),
      config: { replaceAfterMs: 120, maxFeeBumps: 1 },
    });
    await sender.start();
    const { id } = await sender.enqueue(h.bumpRequest("relayer", "replace"));
    await waitUntil(
      async () => (await h.rows())[0]?.senderState?.attempts.length === 2,
      "one replacement",
    );
    expect(latest.refused()).toBe(2);
    expect(fees.refused()).toBe(2);
    await h.anvil.rpc("evm_mine", []);
    const outcome = await sender.waitFor(id, { timeoutMs: 10_000 });
    expect(outcome.status).toBe("mined");
    const [row] = await h.rows();
    const attempts = row?.senderState?.attempts ?? [];
    // One replacement, as configured: the rate limits signed nothing more.
    expect(attempts).toHaveLength(2);
    expect(attempts.map((attempt) => parseTransaction(attempt.raw).nonce)).toEqual([0, 0]);
    expect(row).toMatchObject({ status: "mined", nonce: 0n });
    expect(await h.counter(h.escrow)).toBe(1n);
  });
});
