/**
 * The earliest unmined transaction of a window on the fake chain (`fake-chain.ts`): the
 * replacement timer of a transaction that becomes the earliest after waiting behind a stalled
 * one, a real fee spike, and the re-broadcast of the stored bytes at a restart.
 */
import type { Logger } from "pino";
import type { Address, Hex } from "viem";
import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it } from "vitest";

import { capturingLogger } from "./ingest-test-support";
import { FAKE_OK, FakeChain, fakeCallData } from "./fake-chain";
import { ChainTxStore } from "./store";
import { readChainTxs, rowInconsistency, waitUntil, type ChainTxSnapshot } from "./test-support";
import { TxSender } from "./tx-sender";
import type { SignerAccounts, TxSenderConfig } from "./types";
import { createTestDatabase, type TestDatabase } from "../testing/postgres";

const CHAIN_ID = 5_042_002;
const ESCROW: Address = "0x00000000000000000000000000000000000e5c20";
const GWEI = 1_000_000_000n;
const accounts: SignerAccounts = {
  relayer: privateKeyToAccount(`0x${"11".repeat(32)}`),
  oracle: privateKeyToAccount(`0x${"22".repeat(32)}`),
};

/** Fast timings on the fake chain; nothing is replaced or checked unless a test says so. */
const FAKE_CONFIG = {
  chainId: CHAIN_ID,
  escrowAddress: ESCROW,
  receiptPollMs: 10,
  idlePollMs: 20,
  replaceAfterMs: 60_000,
  resendCheckMs: 60_000,
  maxPrepareMs: 0,
  maxPrepareAttempts: 1_000,
  retryBaseMs: 5,
  retryMaxMs: 40,
  waitPollMs: 10,
  defaultWaitTimeoutMs: 20_000,
} satisfies TxSenderConfig;

const databases: TestDatabase[] = [];
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  await Promise.allSettled(databases.splice(0).map((database) => database.drop()));
});

async function database(): Promise<TestDatabase> {
  const created = await createTestDatabase();
  databases.push(created);
  return created;
}

function sender(
  database: TestDatabase,
  chain: FakeChain,
  logger: Logger,
  config: Partial<TxSenderConfig> = {},
): TxSender {
  const created = new TxSender({
    db: database.db,
    client: chain,
    accounts,
    logger,
    config: { ...FAKE_CONFIG, ...config },
  });
  cleanups.push(() => created.stop());
  return created;
}

function mining(chain: FakeChain, intervalMs: number): void {
  chain.startMining(intervalMs);
  cleanups.push(() => {
    chain.stopMining();
    return Promise.resolve();
  });
}

function range(count: number, from = 0n): bigint[] {
  return Array.from({ length: count }, (_, index) => from + BigInt(index));
}

async function pause(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function enqueueBurst(s: TxSender, label: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const { id } = await s.enqueue({
      idempotencyKey: `${label}-${index.toString()}`,
      signer: "relayer",
      kind: "buyFor",
      to: ESCROW,
      data: fakeCallData({ outcome: FAKE_OK, barrier: false, id: index }),
    });
    ids.push(id);
  }
  return ids;
}

function byNonce(rows: readonly ChainTxSnapshot[]): ChainTxSnapshot[] {
  return rows
    .filter((row) => row.signer === "relayer" && row.nonce !== null)
    .sort((a, b) => ((a.nonce as bigint) < (b.nonce as bigint) ? -1 : 1));
}

function attemptsOf(row: ChainTxSnapshot): number {
  return row.senderState?.attempts.length ?? 0;
}

describe("a transaction that becomes the earliest after waiting behind a stalled one", () => {
  it("is not fee-bumped when it would be mined in the next block: attempts per nonce are the earliest's own, then 1 each, all mined in order", async () => {
    const REPLACE_AFTER_MS = 400;
    // Longer than a block (150 ms) plus a receipt lookup: once a transaction becomes the earliest,
    // the next block mines it before its timer can run out.
    const RESEND_CHECK_MS = 300;
    const db = await database();
    const chain = new FakeChain({ chainId: CHAIN_ID, maxPerBlock: 1 });
    const { logger } = capturingLogger();
    const s = sender(db, chain, logger, {
      maxInFlight: 8,
      replaceAfterMs: REPLACE_AFTER_MS,
      resendCheckMs: RESEND_CHECK_MS,
    });
    await s.start();
    const ids = await enqueueBurst(s, "stalled", 4);
    await waitUntil(() => chain.accepted.length >= 4, "four broadcasts");
    // The earliest is stalled for 1.5 s: nothing is mined, it is replaced every replaceAfterMs.
    await pause(1_500);
    const stalled = byNonce(await readChainTxs(db.db));
    // Positive control: the stall did make the earliest be replaced, and only the earliest.
    expect(attemptsOf(stalled[0] as ChainTxSnapshot)).toBeGreaterThanOrEqual(3);
    for (const row of stalled.slice(1)) expect(attemptsOf(row)).toBe(1);

    // Then one transaction is mined every 150 ms.
    mining(chain, 150);
    const outcomes = await Promise.all(ids.map((id) => s.waitFor(id, { timeoutMs: 10_000 })));
    chain.stopMining();
    expect(outcomes.map((outcome) => outcome.status)).toEqual(Array(4).fill("mined"));
    const rows = byNonce(await readChainTxs(db.db));
    const attempts = rows.map(attemptsOf);
    process.stdout.write(
      `[earliest after a stall] attempts per nonce: ${attempts.join(", ")} (window 8, replaceAfterMs ${REPLACE_AFTER_MS.toString()}, resendCheckMs ${RESEND_CHECK_MS.toString()}, a block of one every 150 ms)\n`,
    );
    expect(attempts).toEqual([attemptsOf(stalled[0] as ChainTxSnapshot), 1, 1, 1]);
    expect(rows.map(rowInconsistency).filter(Boolean)).toEqual([]);
    expect(ids.map((id) => rows.find((row) => row.id === id)?.nonce)).toEqual(range(4));
    // Mined in nonce order, one per block, each as the row's own transaction.
    expect(chain.mined.map((tx) => tx.nonce)).toEqual(range(4));
    expect(new Set(chain.mined.map((tx) => tx.blockNumber)).size).toBe(4);
    for (const tx of chain.mined) {
      expect(rows.find((row) => row.nonce === tx.nonce)?.txHash).toBe(tx.hash);
    }
    expect(chain.violations).toEqual([]);
  }, 30_000);

  it("under a real fee spike, bumps each one only once it was the earliest for resendCheckMs, and mines the whole window far within window x replaceAfterMs", async () => {
    const REPLACE_AFTER_MS = 2_000;
    const RESEND_CHECK_MS = 100;
    const WINDOW = 6;
    const db = await database();
    const chain = new FakeChain({ chainId: CHAIN_ID });
    // First attempts offer 25 gwei (the node's suggestion); one bump of 25 % offers 31.25.
    chain.minMaxFeePerGasToMine = 30n * GWEI;
    const { logger } = capturingLogger();
    const s = sender(db, chain, logger, {
      maxInFlight: WINDOW,
      replaceAfterMs: REPLACE_AFTER_MS,
      resendCheckMs: RESEND_CHECK_MS,
      feeBumpPercent: 25,
    });
    mining(chain, 20);
    await s.start();
    const startedAt = Date.now();
    const ids = await enqueueBurst(s, "spike", WINDOW);
    const outcomes = await Promise.all(ids.map((id) => s.waitFor(id, { timeoutMs: 20_000 })));
    const elapsed = Date.now() - startedAt;
    chain.stopMining();
    expect(outcomes.map((outcome) => outcome.status)).toEqual(Array(WINDOW).fill("mined"));

    const rows = byNonce(await readChainTxs(db.db));
    expect(rows.map(rowInconsistency).filter(Boolean)).toEqual([]);
    expect(rows.map((row) => row.nonce)).toEqual(range(WINDOW));
    // Every one needed exactly one bump to get in, and was mined as its bumped attempt.
    expect(rows.map(attemptsOf)).toEqual(Array(WINDOW).fill(2));
    expect(chain.mined.map((tx) => tx.nonce)).toEqual(range(WINDOW));
    const minedAt = (nonce: bigint): number =>
      chain.mined.find((tx) => tx.nonce === nonce)?.minedAt ?? Number.NaN;
    const waits: number[] = [];
    for (const row of rows) {
      const [first, bumped] = row.senderState?.attempts ?? [];
      expect(row.txHash).toBe(bumped?.hash);
      const bumpedAt = Date.parse(bumped?.signedAt ?? "");
      const nonce = row.nonce as bigint;
      if (nonce === 0n) {
        // The earliest from the start: the whole replaceAfterMs from its broadcast.
        const broadcastAt =
          chain.accepted.find((tx) => tx.hash === first?.hash)?.acceptedAt ?? Number.NaN;
        expect(bumpedAt - broadcastAt).toBeGreaterThanOrEqual(REPLACE_AFTER_MS);
        waits.push(bumpedAt - broadcastAt);
        continue;
      }
      // The earliest only once the one before it was mined: at least resendCheckMs after that.
      const earliestSince = minedAt(nonce - 1n);
      expect(bumpedAt - earliestSince).toBeGreaterThanOrEqual(RESEND_CHECK_MS);
      waits.push(bumpedAt - earliestSince);
    }
    // The window recovers one transaction per resendCheckMs (plus a block and a lookup), not one
    // per replaceAfterMs.
    const bound = REPLACE_AFTER_MS + WINDOW * (RESEND_CHECK_MS + 200);
    process.stdout.write(
      `[fee spike] window of ${WINDOW.toString()} mined in ${elapsed.toString()} ms (bound ${bound.toString()}, window x replaceAfterMs ${(WINDOW * REPLACE_AFTER_MS).toString()}); bumped after being the earliest for ${waits.join(", ")} ms\n`,
    );
    expect(elapsed).toBeLessThanOrEqual(bound);
    expect(chain.violations).toEqual([]);
  }, 30_000);
});

describe("a restart with sent rows the node does not know", () => {
  /**
   * Stores `count` signed transactions of the relayer as `sent`, as a previous run would have
   * left them after a crash before their broadcast; the node never saw them.
   */
  async function sentRows(
    db: TestDatabase,
    count: number,
  ): Promise<{ id: string; hash: Hex; raw: Hex }[]> {
    const store = new ChainTxStore(db.db);
    const relayer = accounts.relayer;
    const signed: { id: string; hash: Hex; raw: Hex }[] = [];
    for (let nonce = 0; nonce < count; nonce += 1) {
      const data = fakeCallData({ outcome: FAKE_OK, barrier: false, id: nonce });
      const { tx } = await store.insertQueued({
        idempotencyKey: `resumed-${nonce.toString()}`,
        signer: "relayer",
        kind: "buyFor",
        to: ESCROW,
        data,
        value: 0n,
        payload: {},
      });
      const raw = await relayer.signTransaction({
        type: "eip1559",
        chainId: CHAIN_ID,
        nonce,
        gas: 100_000n,
        maxFeePerGas: 25n * GWEI,
        maxPriorityFeePerGas: GWEI,
        to: ESCROW,
        data,
      });
      const hash = keccak256(raw);
      const stored = await store.markSent({
        id: tx.id,
        nonce: BigInt(nonce),
        signerAddress: relayer.address,
        chainId: CHAIN_ID,
        txHash: hash,
        state: {
          gas: "100000",
          attempts: [
            {
              hash,
              raw,
              maxFeePerGas: (25n * GWEI).toString(),
              maxPriorityFeePerGas: GWEI.toString(),
              signedAt: new Date().toISOString(),
            },
          ],
        },
        sentAt: new Date(),
      });
      expect(stored).toBe(true);
      signed.push({ id: tx.id, hash, raw });
    }
    return signed;
  }

  it.each([
    { window: 1, label: "one at a time" },
    { window: 8, label: "a window, resendCheckMs far longer than the test" },
  ])(
    "$label: the stored bytes of each reach the node in the first pass after start(), in nonce order, before any count is read, nothing signed again",
    async ({ window }) => {
      const db = await database();
      const chain = new FakeChain({ chainId: CHAIN_ID });
      const { logger } = capturingLogger();
      const signed = await sentRows(db, 3);
      // Positive control: the node knows none of them.
      expect(chain.pending(accounts.relayer.address)).toEqual([]);
      // Neither the fee bump (replaceAfterMs) nor the pending-count check (resendCheckMs) can
      // send anything during the test: 60 s each.
      const s = sender(db, chain, logger, { maxInFlight: window });
      const before = chain.requests.length;
      const startedAt = Date.now();
      await s.start();
      await waitUntil(() => chain.accepted.length >= 3, "the three stored transactions", 2_000);
      const tookMs = Math.max(...chain.accepted.map((tx) => tx.acceptedAt)) - startedAt;
      process.stdout.write(
        `[restart, window ${window.toString()}] three stored transactions broadcast ${tookMs.toString()} ms after start()\n`,
      );

      // In nonce order, the stored bytes themselves.
      expect(chain.accepted.map((tx) => tx.nonce)).toEqual(range(3));
      expect(chain.accepted.map((tx) => tx.hash)).toEqual(signed.map((entry) => entry.hash));
      // In the first pass: before the worker looked up any receipt, and before it read any
      // transaction count (the pending-count check, the fee bump's mined count, a nonce).
      const since = chain.requests.slice(before).map((request) => request.method);
      const lastBroadcast = since.lastIndexOf("sendRawTransaction");
      expect(since.filter((method) => method === "sendRawTransaction")).toHaveLength(3);
      expect(since.slice(0, lastBroadcast)).not.toContain("getTransactionReceipt");
      expect(since.slice(0, lastBroadcast)).not.toContain("getTransactionCount");

      chain.mine();
      const outcomes = await Promise.all(
        signed.map((entry) => s.waitFor(entry.id, { timeoutMs: 5_000 })),
      );
      expect(outcomes.map((outcome) => outcome.status)).toEqual(Array(3).fill("mined"));
      expect(outcomes.map((outcome) => outcome.txHash)).toEqual(signed.map((entry) => entry.hash));
      const rows = byNonce(await readChainTxs(db.db));
      // Exactly one attempt each: nothing was signed again.
      expect(rows.map(attemptsOf)).toEqual([1, 1, 1]);
      expect(rows.map(rowInconsistency).filter(Boolean)).toEqual([]);
      expect(chain.mined.map((tx) => tx.hash)).toEqual(signed.map((entry) => entry.hash));
    },
    20_000,
  );
});
