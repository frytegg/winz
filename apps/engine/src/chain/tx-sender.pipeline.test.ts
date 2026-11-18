/**
 * The sender broadcasts a signer's independent transactions without waiting for the previous one
 * to be mined (SPEC ST-3, task R-02), on a local chain with a block time (interval mining, never
 * automine: with automine everything is serial by construction), or with mining under the test's
 * hand where a scenario needs transactions to wait in the pool.
 */
import {
  LimitExceededRpcError,
  RpcRequestError,
  keccak256,
  parseTransaction,
  type Hex,
} from "viem";
import { afterEach, describe, expect, it } from "vitest";

import { TxSenderStoppedError } from "./errors";
import { ChainTxStore } from "./store";
import {
  createChainHarness,
  FEE_FLOOR_WEI,
  REVERTING_CALL_DATA,
  receiptOf,
  rowInconsistency,
  sendDirect,
  TEST_REVERT_ERROR,
  transientError,
  waitUntil,
  wrapClient,
  type ChainHarness,
  type ChainTxSnapshot,
} from "./test-support";
import type { ChainClient, TxRequest } from "./types";

/** Arc testnet makes a block about every 0.46 s; anvil takes 0.5. */
const BLOCK_TIME_S = 0.5;

let harness: ChainHarness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

async function chain(options: { blockTime?: number; noMining?: boolean }): Promise<ChainHarness> {
  harness = await createChainHarness(options);
  return harness;
}

/** A call to the test contract under an independent kind (any of `INDEPENDENT_TX_KINDS`). */
function independent(h: ChainHarness, key: string, kind = "buyFor"): TxRequest {
  return { ...h.bumpRequest("relayer", key), kind };
}

function range(count: number, from = 0n): bigint[] {
  return Array.from({ length: count }, (_, index) => from + BigInt(index));
}

async function head(h: ChainHarness): Promise<bigint> {
  return BigInt((await h.anvil.rpc("eth_blockNumber")) as string);
}

interface Broadcast {
  nonce: number;
  hash: Hex;
  at: number;
  /** Latest block when the node answered. */
  head: bigint;
  ok: boolean;
}

/** Records every broadcast and when each receipt was first seen; `refuse` may refuse one. */
function recording(
  h: ChainHarness,
  refuse: (nonce: number) => Error | undefined = () => undefined,
  overrides: Partial<ChainClient> = {},
): { client: ChainClient; sends: Broadcast[]; receiptSeen: Map<Hex, number> } {
  const sends: Broadcast[] = [];
  const receiptSeen = new Map<Hex, number>();
  const client = wrapClient(h.client, {
    sendRawTransaction: async (request) => {
      const raw = request.serializedTransaction;
      const nonce = parseTransaction(raw).nonce ?? -1;
      const refusal = refuse(nonce);
      if (refusal) {
        sends.push({ nonce, hash: keccak256(raw), at: Date.now(), head: await head(h), ok: false });
        throw refusal;
      }
      try {
        const hash = await h.client.sendRawTransaction(request);
        sends.push({ nonce, hash, at: Date.now(), head: await head(h), ok: true });
        return hash;
      } catch (error: unknown) {
        // "already imported", "nonce too low": the node had it; the sender reads these itself.
        sends.push({ nonce, hash: keccak256(raw), at: Date.now(), head: await head(h), ok: true });
        throw error;
      }
    },
    getTransactionReceipt: async (request) => {
      const receipt = await h.client.getTransactionReceipt(request);
      if (!receiptSeen.has(request.hash)) receiptSeen.set(request.hash, Date.now());
      return receipt;
    },
    ...overrides,
  });
  return { client, sends, receiptSeen };
}

async function enqueueAll(
  sender: { enqueue: (request: TxRequest) => Promise<{ id: string }> },
  requests: readonly TxRequest[],
): Promise<string[]> {
  const ids: string[] = [];
  // One after the other, so that the order of enqueue is the outbox's order.
  for (const request of requests) ids.push((await sender.enqueue(request)).id);
  return ids;
}

function rowsOf(rows: readonly ChainTxSnapshot[], ids: readonly string[]): ChainTxSnapshot[] {
  return ids.map((id) => {
    const row = rows.find((candidate) => candidate.id === id);
    if (!row) throw new Error(`no row ${id}`);
    return row;
  });
}

function spread(blocks: readonly bigint[]): bigint {
  const sorted = [...blocks].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return (sorted[sorted.length - 1] ?? 0n) - (sorted[0] ?? 0n);
}

function rateLimited(): Error {
  return new LimitExceededRpcError(
    new RpcRequestError({
      body: { method: "eth_sendRawTransaction" },
      error: { code: -32005, message: "rate limit exceeded" },
      url: "https://rpc.testnet.arc.io",
      status: 429,
      headers: new Headers(),
    }),
  );
}

describe("on a chain with a block time", () => {
  it("broadcasts six independent transactions before the first is mined, with consecutive nonces in the order of enqueue, mined within two blocks; one at a time they take a block each", async () => {
    const h = await chain({ blockTime: BLOCK_TIME_S });

    const run = async (
      maxInFlight: number,
      label: string,
    ): Promise<{ blocks: bigint[]; nonces: bigint[]; sends: Broadcast[] }> => {
      const { client, sends } = recording(h);
      const sender = h.createSender({ client, config: { maxInFlight } });
      await sender.start();
      const ids = await enqueueAll(
        sender,
        Array.from({ length: 6 }, (_, index) => independent(h, `${label}-${index.toString()}`)),
      );
      const outcomes = await Promise.all(
        ids.map((id) => sender.waitFor(id, { timeoutMs: 30_000 })),
      );
      await sender.stop();
      expect(outcomes.map((outcome) => outcome.status)).toEqual(Array(6).fill("mined"));
      const rows = rowsOf(await h.rows(), ids);
      return {
        blocks: outcomes.map((outcome) => outcome.blockNumber as bigint),
        nonces: rows.map((row) => row.nonce as bigint),
        sends,
      };
    };

    const together = await run(8, "window");
    const alone = await run(1, "serial");
    process.stdout.write(
      `[pipeline] six independent transactions: window of 8 mined in blocks ${together.blocks.join(", ")} ` +
        `(spread ${spread(together.blocks).toString()}); window of 1 in blocks ${alone.blocks.join(", ")} ` +
        `(spread ${spread(alone.blocks).toString()})\n`,
    );

    // Consecutive nonces in the order of enqueue, as a serial sender would give them.
    expect(together.nonces).toEqual(range(6));
    expect(alone.nonces).toEqual(range(6, 6n));
    // All six were broadcast, in nonce order, before the block that mined the first one.
    expect(together.sends.map((send) => send.nonce)).toEqual([0, 1, 2, 3, 4, 5]);
    const firstBlock = together.blocks[0] as bigint;
    for (const send of together.sends) expect(send.head).toBeLessThan(firstBlock);
    // Mined within two blocks of the first.
    expect(spread(together.blocks)).toBeLessThanOrEqual(1n);
    // One at a time: a block each.
    expect(new Set(alone.blocks).size).toBe(6);
    expect(spread(alone.blocks)).toBeGreaterThanOrEqual(5n);

    const rows = await h.rows();
    expect(rows.map(rowInconsistency).filter(Boolean)).toEqual([]);
    expect(await h.minedCount(h.accounts.relayer.address)).toBe(12);
    expect(await h.counter(h.escrow)).toBe(12n);
  }, 60_000);

  it.each(["settle", "test.no-such-kind"])(
    "lets a barrier (%s) in the middle of a burst go alone: the ones before it are mined first, the ones after it signed once it is mined",
    async (barrierKind) => {
      const h = await chain({ blockTime: BLOCK_TIME_S });
      const { client, receiptSeen } = recording(h);
      const sender = h.createSender({ client, config: { maxInFlight: 8 } });
      await sender.start();
      const requests: TxRequest[] = [
        independent(h, "before-0"),
        independent(h, "before-1", "refundBatch"),
        independent(h, "before-2", "chargeHedge"),
        { ...h.bumpRequest("relayer", "barrier"), kind: barrierKind },
        independent(h, "after-0"),
        independent(h, "after-1", "refundBatch"),
        independent(h, "after-2"),
      ];
      const ids = await enqueueAll(sender, requests);
      const outcomes = await Promise.all(
        ids.map((id) => sender.waitFor(id, { timeoutMs: 30_000 })),
      );
      expect(outcomes.map((outcome) => outcome.status)).toEqual(Array(7).fill("mined"));
      const rows = rowsOf(await h.rows(), ids);
      expect(rows.map((row) => row.nonce)).toEqual(range(7));
      const blocks = outcomes.map((outcome) => outcome.blockNumber as bigint);
      const barrierBlock = blocks[3] as bigint;
      const barrier = rows[3] as ChainTxSnapshot;

      // Before: mined in earlier blocks, and the barrier was signed after their receipts.
      for (const [index, row] of rows.slice(0, 3).entries()) {
        expect(blocks[index]).toBeLessThan(barrierBlock);
        expect(barrier.sentAt?.getTime()).toBeGreaterThanOrEqual(
          receiptSeen.get(row.txHash as Hex) ?? Number.POSITIVE_INFINITY,
        );
      }
      // After: signed only once the barrier's receipt was seen, mined in later blocks.
      const barrierMinedSeen = receiptSeen.get(barrier.txHash as Hex) ?? Number.POSITIVE_INFINITY;
      for (const [index, row] of rows.slice(4).entries()) {
        expect(blocks[index + 4]).toBeGreaterThan(barrierBlock);
        expect(row.sentAt?.getTime()).toBeGreaterThanOrEqual(barrierMinedSeen);
      }
      // Alone in its block.
      expect(blocks.filter((block) => block === barrierBlock)).toHaveLength(1);
      // The independent ones on each side travelled together.
      expect(spread(blocks.slice(0, 3))).toBeLessThanOrEqual(1n);
      expect(spread(blocks.slice(4))).toBeLessThanOrEqual(1n);
      process.stdout.write(
        `[pipeline] barrier ${barrierKind}: blocks ${blocks.join(", ")} (barrier in ${barrierBlock.toString()})\n`,
      );
    },
    60_000,
  );

  it("does not sign nonce n + 1 while the broadcast of n is refused (rate limit, then a transient refusal), then sends everything in order", async () => {
    const h = await chain({ blockTime: BLOCK_TIME_S });
    const refusals: number[] = [];
    let refused = 0;
    const { client, sends } = recording(h, (nonce) => {
      if (nonce !== 2 || refused >= 2) return undefined;
      refused += 1;
      refusals.push(Date.now());
      return refused === 1 ? rateLimited() : transientError();
    });
    const sender = h.createSender({ client, config: { maxInFlight: 8 } });
    await sender.start();
    const ids = await enqueueAll(
      sender,
      Array.from({ length: 5 }, (_, index) => independent(h, `refused-${index.toString()}`)),
    );
    const outcomes = await Promise.all(ids.map((id) => sender.waitFor(id, { timeoutMs: 30_000 })));
    expect(outcomes.map((outcome) => outcome.status)).toEqual(Array(5).fill("mined"));
    expect(refusals).toHaveLength(2);
    const rows = rowsOf(await h.rows(), ids);
    expect(rows.map((row) => row.nonce)).toEqual(range(5));
    // n + 1 was signed after the last refusal of n.
    expect(rows[3]?.sentAt?.getTime()).toBeGreaterThanOrEqual(refusals[1] as number);
    // The refused nonce went out again, then the others, in nonce order; never ahead of it.
    expect(sends.map((send) => `${send.nonce.toString()}:${send.ok ? "ok" : "refused"}`)).toEqual([
      "0:ok",
      "1:ok",
      "2:refused",
      "2:refused",
      "2:ok",
      "3:ok",
      "4:ok",
    ]);
    // The same signed bytes each time: nothing signed again.
    for (const row of rows) expect(row.senderState?.attempts).toHaveLength(1);
    expect(new Set(sends.filter((send) => send.nonce === 2).map((send) => send.hash)).size).toBe(1);
    expect(rows.map(rowInconsistency).filter(Boolean)).toEqual([]);
    expect(h.logLines.some((line) => line.includes("broadcast rate limited by the node"))).toBe(
      true,
    );
    expect(h.logLines.some((line) => line.includes("broadcast failed, retrying"))).toBe(true);
    expect(await h.counter(h.escrow)).toBe(5n);
  }, 60_000);

  it("records a transaction that reverts on-chain in the middle of a window as reverted, tells its waiter, mines the later ones, leaves no nonce gap", async () => {
    const h = await chain({ blockTime: BLOCK_TIME_S });
    // The simulation of the reverting call is bypassed so that it reaches the chain.
    const { client } = recording(h, () => undefined, {
      call: (request) =>
        request.blockNumber === undefined && request.data === REVERTING_CALL_DATA
          ? Promise.resolve({})
          : h.client.call(request),
      estimateGas: (request) =>
        request.data === REVERTING_CALL_DATA
          ? Promise.resolve(100_000n)
          : h.client.estimateGas(request),
    });
    const sender = h.createSender({ client, config: { maxInFlight: 8 } });
    await sender.start();
    const requests = Array.from({ length: 5 }, (_, index) =>
      index === 2
        ? { ...independent(h, "reverts-on-chain"), data: REVERTING_CALL_DATA }
        : independent(h, `around-${index.toString()}`),
    );
    const ids = await enqueueAll(sender, requests);
    const outcomes = await Promise.all(ids.map((id) => sender.waitFor(id, { timeoutMs: 30_000 })));
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      "mined",
      "mined",
      "reverted",
      "mined",
      "mined",
    ]);
    expect(outcomes[2]).toMatchObject({ status: "reverted", error: TEST_REVERT_ERROR, events: [] });
    const receipt = await h.client.getTransactionReceipt({ hash: outcomes[2]?.txHash as Hex });
    expect(receipt.status).toBe("reverted");
    const rows = rowsOf(await h.rows(), ids);
    expect(rows.map((row) => row.nonce)).toEqual(range(5));
    expect(rows.map(rowInconsistency).filter(Boolean)).toEqual([]);
    // It was in a window: the five travelled together.
    expect(spread(outcomes.map((outcome) => outcome.blockNumber as bigint))).toBeLessThanOrEqual(
      1n,
    );
    expect(await h.minedCount(h.accounts.relayer.address)).toBe(5);
    expect(await h.counter(h.escrow)).toBe(4n);
  }, 60_000);

  it("fails a call that reverts in simulation in the middle of a burst without a nonce; the next one takes it", async () => {
    const h = await chain({ blockTime: BLOCK_TIME_S });
    const sender = h.createSender({ config: { maxInFlight: 8 } });
    await sender.start();
    const requests = Array.from({ length: 5 }, (_, index) =>
      index === 2
        ? { ...independent(h, "reverts-in-simulation"), data: REVERTING_CALL_DATA }
        : independent(h, `burst-${index.toString()}`),
    );
    const ids = await enqueueAll(sender, requests);
    const outcomes = await Promise.all(ids.map((id) => sender.waitFor(id, { timeoutMs: 30_000 })));
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      "mined",
      "mined",
      "failed",
      "mined",
      "mined",
    ]);
    expect(outcomes[2]).toEqual({
      id: ids[2],
      status: "failed",
      events: [],
      error: TEST_REVERT_ERROR,
    });
    const rows = rowsOf(await h.rows(), ids);
    expect(rows.map((row) => row.nonce)).toEqual([0n, 1n, null, 2n, 3n]);
    expect(rows[2]).toMatchObject({ status: "failed", txHash: null, sentAt: null });
    expect(await h.minedCount(h.accounts.relayer.address)).toBe(4);
  }, 60_000);
});

describe("with mining under the test's hand", () => {
  it("broadcasts the earliest again from its stored bytes when the node drops it, and mines the later ones after it", async () => {
    const h = await chain({ noMining: true });
    const { client, sends } = recording(h);
    const sender = h.createSender({ client, config: { maxInFlight: 8, resendCheckMs: 150 } });
    await sender.start();
    const ids = await enqueueAll(
      sender,
      Array.from({ length: 4 }, (_, index) => independent(h, `dropped-${index.toString()}`)),
    );
    await waitUntil(() => sends.filter((send) => send.ok).length === 4, "four broadcasts");
    const [earliest] = rowsOf(await h.rows(), ids);
    const storedHash = earliest?.txHash as Hex;
    await h.anvil.rpc("anvil_dropTransaction", [storedHash]);
    // Positive control: the node no longer has it, and nothing of the signer can be mined (anvil
    // drops the later ones with it: they can never run without it).
    expect(
      await h.client.getTransactionCount({
        address: h.accounts.relayer.address,
        blockTag: "pending",
      }),
    ).toBe(0);
    expect(await h.anvil.rpc("txpool_status", [])).toMatchObject({ pending: "0x0" });

    // The earliest, then the later ones the node no longer knows, go out again from their bytes.
    const stored = rowsOf(await h.rows(), ids).map((row) => row.txHash as Hex);
    await waitUntil(
      () =>
        stored.every((hash) => sends.filter((send) => send.hash === hash && send.ok).length >= 2),
      "the four broadcast again",
    );
    const again = sends
      .slice(4)
      .filter((send) => send.ok)
      .map((send) => send.nonce);
    expect(again.slice(0, 4)).toEqual([0, 1, 2, 3]);
    await h.anvil.rpc("evm_mine", []);
    const outcomes = await Promise.all(ids.map((id) => sender.waitFor(id, { timeoutMs: 10_000 })));
    expect(outcomes.map((outcome) => outcome.status)).toEqual(Array(4).fill("mined"));
    expect(outcomes[0]?.txHash).toBe(storedHash);
    const rows = rowsOf(await h.rows(), ids);
    expect(rows.map((row) => row.nonce)).toEqual(range(4));
    // Never signed again.
    for (const row of rows) expect(row.senderState?.attempts).toHaveLength(1);
    // Mined after it: same block, later positions.
    const receipts = await Promise.all(
      rows.map((row) => h.client.getTransactionReceipt({ hash: row.txHash as Hex })),
    );
    const positions = receipts.map((receipt) => [receipt.blockNumber, receipt.transactionIndex]);
    expect(positions).toEqual(
      [...positions].sort((a, b) =>
        (a[0] as bigint) === (b[0] as bigint)
          ? Number(a[1]) - Number(b[1])
          : (a[0] as bigint) < (b[0] as bigint)
            ? -1
            : 1,
      ),
    );
    expect(h.logLines.some((line) => line.includes("the node no longer knows transactions"))).toBe(
      true,
    );
    expect(await h.counter(h.escrow)).toBe(4n);
  }, 30_000);

  it("bumps the fee of the earliest with the same nonce while later ones are pending, never signing those again", async () => {
    const h = await chain({ noMining: true });
    const { client, sends } = recording(h);
    const sender = h.createSender({
      client,
      config: { maxInFlight: 8, replaceAfterMs: 300, maxFeeBumps: 1, feeBumpPercent: 25 },
    });
    await sender.start();
    const ids = await enqueueAll(
      sender,
      Array.from({ length: 4 }, (_, index) => independent(h, `bumped-${index.toString()}`)),
    );
    await waitUntil(
      async () => rowsOf(await h.rows(), ids)[0]?.senderState?.attempts.length === 2,
      "the replacement of the earliest",
    );
    // Several more timeouts pass: the later ones are left as they are.
    await new Promise((resolve) => setTimeout(resolve, 900));
    const pending = rowsOf(await h.rows(), ids);
    const [first, ...later] = pending;
    const attempts = first?.senderState?.attempts ?? [];
    expect(attempts.map((attempt) => parseTransaction(attempt.raw).nonce)).toEqual([0, 0]);
    expect(BigInt(attempts[1]?.maxFeePerGas ?? "0") * 100n).toBeGreaterThanOrEqual(
      BigInt(attempts[0]?.maxFeePerGas ?? "0") * 125n,
    );
    for (const row of later) {
      expect(row.senderState?.attempts).toHaveLength(1);
      expect(sends.filter((send) => send.hash === row.txHash)).toHaveLength(1);
    }
    expect(BigInt(attempts[0]?.maxFeePerGas ?? "0")).toBe(FEE_FLOOR_WEI);

    await h.anvil.rpc("evm_mine", []);
    const outcomes = await Promise.all(ids.map((id) => sender.waitFor(id, { timeoutMs: 10_000 })));
    expect(outcomes.map((outcome) => outcome.status)).toEqual(Array(4).fill("mined"));
    expect(outcomes[0]?.txHash).toBe(attempts[1]?.hash);
    const rows = rowsOf(await h.rows(), ids);
    expect(rows.map((row) => row.nonce)).toEqual(range(4));
    expect(rows.map(rowInconsistency).filter(Boolean)).toEqual([]);
    expect(await h.minedCount(h.accounts.relayer.address)).toBe(4);
    expect(await h.counter(h.escrow)).toBe(4n);
  }, 30_000);

  it("resumes four sent rows after a restart (mined, reverted, pending, unknown to the node), each ending right, nothing signed again", async () => {
    const h = await chain({ noMining: true });
    const store = new ChainTxStore(h.db);
    const relayer = h.accounts.relayer;
    const signed: { id: string; hash: Hex; raw: Hex }[] = [];
    for (const [nonce, data] of (["0x", REVERTING_CALL_DATA, "0x", "0x"] as Hex[]).entries()) {
      const { tx } = await store.insertQueued({
        idempotencyKey: `restart-${nonce.toString()}`,
        signer: "relayer",
        kind: "buyFor",
        to: h.escrow,
        data,
        value: 0n,
        payload: {},
      });
      const raw = await relayer.signTransaction({
        type: "eip1559",
        chainId: h.chainId,
        nonce,
        gas: 100_000n,
        maxFeePerGas: FEE_FLOOR_WEI,
        maxPriorityFeePerGas: 1_000_000_000n,
        to: h.escrow,
        data,
      });
      const hash = keccak256(raw);
      expect(
        await store.markSent({
          id: tx.id,
          nonce: BigInt(nonce),
          signerAddress: relayer.address,
          chainId: h.chainId,
          txHash: hash,
          state: {
            gas: "100000",
            attempts: [
              {
                hash,
                raw,
                maxFeePerGas: FEE_FLOOR_WEI.toString(),
                maxPriorityFeePerGas: "1000000000",
                signedAt: new Date().toISOString(),
              },
            ],
          },
          sentAt: new Date(),
        }),
      ).toBe(true);
      signed.push({ id: tx.id, hash, raw });
    }
    // What the previous run left: 0 and 1 mined (1 reverted), 2 pending, 3 never broadcast.
    for (const entry of signed.slice(0, 2)) {
      await h.client.sendRawTransaction({ serializedTransaction: entry.raw });
    }
    await h.anvil.rpc("evm_mine", []);
    await h.client.sendRawTransaction({ serializedTransaction: signed[2]?.raw as Hex });
    expect(await h.minedCount(relayer.address)).toBe(2);
    expect(
      await h.client.getTransactionCount({ address: relayer.address, blockTag: "pending" }),
    ).toBe(3);
    expect((await h.rows()).map((row) => row.status)).toEqual(Array(4).fill("sent"));
    await h.anvil.rpc("evm_setIntervalMining", [1]);

    const sender = h.createSender({ config: { maxInFlight: 8 } });
    await sender.start();
    const outcomes = await Promise.all(
      signed.map((entry) => sender.waitFor(entry.id, { timeoutMs: 20_000 })),
    );
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      "mined",
      "reverted",
      "mined",
      "mined",
    ]);
    expect(outcomes[1]?.error).toBe(TEST_REVERT_ERROR);
    expect(outcomes.map((outcome) => outcome.txHash)).toEqual(signed.map((entry) => entry.hash));
    const rows = await h.rows();
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.nonce)).toEqual(range(4));
    for (const row of rows) expect(row.senderState?.attempts).toHaveLength(1);
    expect(rows.map(rowInconsistency).filter(Boolean)).toEqual([]);
    expect(await h.minedCount(relayer.address)).toBe(4);
    expect(await h.counter(h.escrow)).toBe(3n);

    // The sequence goes on at 4.
    const next = await sender.sendAndWait(independent(h, "after-restart"), { timeoutMs: 20_000 });
    expect(next.status).toBe("mined");
    expect((await h.rows()).find((row) => row.id === next.id)?.nonce).toBe(4n);
  }, 60_000);

  it("fails the one transaction whose nonce a foreign transaction took while a window is in flight; the later ones are mined on their own nonces", async () => {
    const h = await chain({ noMining: true });
    const sender = h.createSender({ config: { maxInFlight: 8, replaceAfterMs: 300 } });
    await sender.start();
    const ids = await enqueueAll(
      sender,
      Array.from({ length: 4 }, (_, index) => independent(h, `window-${index.toString()}`)),
    );
    await waitUntil(
      async () => rowsOf(await h.rows(), ids).every((row) => row.status === "sent"),
      "four signed transactions",
    );
    await waitUntil(
      async () =>
        (await h.client.getTransactionCount({
          address: h.accounts.relayer.address,
          blockTag: "pending",
        })) === 4,
      "four broadcasts",
    );
    // Someone else uses the relayer key with nonce 1, at a better fee: it replaces ours.
    const foreign = await sendDirect(h.client, h.accounts.relayer, h.chainId, {
      nonce: 1,
      to: h.bystander.address,
      gas: 21_000n,
    });
    await h.anvil.rpc("evm_mine", []);
    expect((await receiptOf(h.client, foreign)).status).toBe("success");

    const outcomes = await Promise.all(ids.map((id) => sender.waitFor(id, { timeoutMs: 15_000 })));
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      "mined",
      "failed",
      "mined",
      "mined",
    ]);
    expect(outcomes[1]?.error).toMatch(/^NonceConsumedElsewhere: nonce 1 /);
    const rows = rowsOf(await h.rows(), ids);
    expect(rows.map((row) => row.nonce)).toEqual([0n, null, 2n, 3n]);
    expect(rows.map(rowInconsistency).filter(Boolean)).toEqual([]);
    expect(await h.counter(h.escrow)).toBe(3n);

    await h.anvil.rpc("evm_setAutomine", [true]);
    const next = await sender.sendAndWait(independent(h, "after-foreign"), { timeoutMs: 15_000 });
    expect(next.status).toBe("mined");
    expect((await h.rows()).find((row) => row.id === next.id)?.nonce).toBe(4n);
  }, 30_000);

  it("stops with a window in flight, leaves it sent and the rest queued, and a new start finishes it all in order, nothing signed twice", async () => {
    const h = await chain({ noMining: true });
    const first = h.createSender({ config: { maxInFlight: 3 } });
    await first.start();
    const ids = await enqueueAll(
      first,
      Array.from({ length: 6 }, (_, index) => independent(h, `stop-${index.toString()}`)),
    );
    await waitUntil(
      async () =>
        (await h.client.getTransactionCount({
          address: h.accounts.relayer.address,
          blockTag: "pending",
        })) === 3,
      "a full window broadcast",
    );
    await first.stop();
    const stopped = rowsOf(await h.rows(), ids);
    expect(stopped.map((row) => row.status)).toEqual([
      "sent",
      "sent",
      "sent",
      "queued",
      "queued",
      "queued",
    ]);
    expect(stopped.map((row) => row.nonce)).toEqual([0n, 1n, 2n, null, null, null]);
    expect(stopped.map(rowInconsistency).filter(Boolean)).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(rowsOf(await h.rows(), ids).map((row) => row.status)).toEqual(
      stopped.map((row) => row.status),
    );
    await expect(first.waitFor(ids[4] as string, { timeoutMs: 5_000 })).rejects.toBeInstanceOf(
      TxSenderStoppedError,
    );

    await h.anvil.rpc("evm_mine", []);
    await h.anvil.rpc("evm_setIntervalMining", [1]);
    const second = h.createSender({ config: { maxInFlight: 3 } });
    await second.start();
    const outcomes = await Promise.all(ids.map((id) => second.waitFor(id, { timeoutMs: 20_000 })));
    expect(outcomes.map((outcome) => outcome.status)).toEqual(Array(6).fill("mined"));
    const rows = rowsOf(await h.rows(), ids);
    expect(rows.map((row) => row.nonce)).toEqual(range(6));
    for (const [index, row] of rows.entries()) {
      expect(row.senderState?.attempts).toHaveLength(1);
      if (index < 3) expect(row.txHash).toBe(stopped[index]?.txHash);
    }
    expect(await h.minedCount(h.accounts.relayer.address)).toBe(6);
    expect(await h.counter(h.escrow)).toBe(6n);
  }, 30_000);
});
