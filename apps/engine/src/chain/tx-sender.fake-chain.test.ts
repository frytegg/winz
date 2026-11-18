/**
 * The pipelined sender against an in-process chain that misbehaves on request (`fake-chain.ts`):
 * the request budget of a full window, a node that caps pending transactions per account, and a
 * seeded property test of random bursts, refusals, drops, reverts and restarts.
 */
import type { Logger } from "pino";
import { privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";
import { afterEach, describe, expect, it } from "vitest";

import { capturingLogger } from "./ingest-test-support";
import {
  FAKE_CHAIN_REVERT,
  FAKE_OK,
  FAKE_REVERT_REASON,
  FAKE_SIMULATION_REVERT,
  FakeChain,
  fakeCallData,
  fakeRateLimit,
  fakeTransient,
} from "./fake-chain";
import { readChainTxs, rowInconsistency, waitUntil, type ChainTxSnapshot } from "./test-support";
import { TxSender } from "./tx-sender";
import type { SignerAccounts, SignerName, TxSenderConfig } from "./types";
import { createTestDatabase, type TestDatabase } from "../testing/postgres";

const CHAIN_ID = 5_042_002;
const ESCROW: Address = "0x00000000000000000000000000000000000e5c20";
const accounts: SignerAccounts = {
  relayer: privateKeyToAccount(`0x${"11".repeat(32)}`),
  oracle: privateKeyToAccount(`0x${"22".repeat(32)}`),
};

/** Fast timings on the fake chain. */
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

function sortBigint(values: readonly bigint[]): bigint[] {
  return [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function range(count: number, from = 0n): bigint[] {
  return Array.from({ length: count }, (_, index) => from + BigInt(index));
}

/** Requests per second over [from, to), and the busiest one-second window inside it. */
function rates(chain: FakeChain, from: number, to: number): { perSecond: number; peak: number } {
  const times = chain.requests.map((request) => request.at).filter((at) => at >= from && at < to);
  let peak = 0;
  for (const start of times) {
    peak = Math.max(peak, times.filter((at) => at >= start && at < start + 1_000).length);
  }
  return { perSecond: (times.length * 1_000) / (to - from), peak };
}

async function pause(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("the request budget of a full window", () => {
  /**
   * Requests made while `window` transactions wait to be mined on a chain that mines nothing,
   * measured over three seconds once the burst is out.
   */
  async function idleRate(window: number): Promise<{ perSecond: number; peak: number }> {
    const db = await database();
    const chain = new FakeChain({ chainId: CHAIN_ID });
    const { logger } = capturingLogger();
    const s = sender(db, chain, logger, {
      maxInFlight: window,
      receiptPollMs: 100,
      resendCheckMs: 1_000,
      idlePollMs: 200,
    });
    await s.start();
    for (let index = 0; index < 8; index += 1) {
      await s.enqueue({
        idempotencyKey: `idle-${window.toString()}-${index.toString()}`,
        signer: "relayer",
        kind: "refundBatch",
        to: ESCROW,
        data: fakeCallData({ outcome: FAKE_OK, barrier: false, id: index }),
      });
    }
    await waitUntil(() => chain.accepted.length === window, `${window.toString()} broadcasts`);
    await pause(300);
    const from = Date.now();
    await pause(3_000);
    const measured = rates(chain, from, Date.now());
    await s.stop();
    return measured;
  }

  it("costs the same polling with 8 transactions in flight as with 1, and a burst costs 3 requests per transaction plus one fee read", async () => {
    // A burst of 8 into an empty window on a chain that mines on demand.
    const db = await database();
    const chain = new FakeChain({ chainId: CHAIN_ID });
    const { logger } = capturingLogger();
    const s = sender(db, chain, logger, {
      maxInFlight: 8,
      receiptPollMs: 100,
      resendCheckMs: 1_000,
      idlePollMs: 200,
    });
    await s.start();
    const before = chain.requests.length;
    const ids: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      const { id } = await s.enqueue({
        idempotencyKey: `burst-${index.toString()}`,
        signer: "relayer",
        kind: "refundBatch",
        to: ESCROW,
        data: fakeCallData({ outcome: FAKE_OK, barrier: false, id: index }),
      });
      ids.push(id);
    }
    await waitUntil(() => chain.accepted.length === 8, "8 broadcasts");
    const burst = chain.requests.slice(before);
    const count = (method: string): number => burst.filter((r) => r.method === method).length;
    // Per transaction: one simulation, one gas estimate, one broadcast.
    expect(count("call")).toBe(8);
    expect(count("estimateGas")).toBe(8);
    expect(count("sendRawTransaction")).toBe(8);
    // Shared by the burst: one fee suggestion, one nonce read.
    expect(count("estimateFeesPerGas")).toBe(1);
    expect(count("getTransactionCount")).toBe(1);

    // All 8 mined in one block: 8 receipts, and one block time read for all of them.
    const beforeMining = chain.requests.length;
    chain.mine();
    await Promise.all(ids.map((id) => s.waitFor(id, { timeoutMs: 5_000 })));
    const mining = chain.requests.slice(beforeMining);
    expect(mining.filter((r) => r.method === "getTransactionReceipt")).toHaveLength(8);
    expect(mining.filter((r) => r.method === "getBlock")).toHaveLength(1);
    const rows = await readChainTxs(db.db);
    expect(rows.map((row) => row.status)).toEqual(Array(8).fill("mined"));
    await s.stop();

    // The steady polling while transactions wait does not grow with the window: the earliest
    // unmined receipt every receiptPollMs (100 ms) and the pending count every resendCheckMs
    // (1 s), whatever the number in flight.
    // A window of 1 is the one-at-a-time sender and asks no pending count; from 2 in flight on,
    // the count is asked every resendCheckMs, whatever the number in flight.
    const one = await idleRate(1);
    const two = await idleRate(2);
    const eight = await idleRate(8);
    const bound = 1_000 / 100 + 1_000 / 1_000 + 1;
    process.stdout.write(
      `[request budget] waiting with 1 in flight: ${one.perSecond.toFixed(1)} requests/s (peak ${one.peak.toString()}); ` +
        `with 2 in flight: ${two.perSecond.toFixed(1)} requests/s (peak ${two.peak.toString()}); ` +
        `with 8 in flight: ${eight.perSecond.toFixed(1)} requests/s (peak ${eight.peak.toString()}); bound ${bound.toString()}\n`,
    );
    expect(eight.peak).toBeLessThanOrEqual(bound);
    expect(two.peak).toBeLessThanOrEqual(bound);
    expect(one.peak).toBeLessThanOrEqual(bound);
    expect(eight.perSecond).toBeLessThanOrEqual(two.perSecond + 1);
    // Positive control: the window did hold 8 in flight (the window of 1 held one).
    expect(eight.perSecond).toBeGreaterThan(5);
  }, 30_000);
});

describe("a node that caps the pending transactions of an account", () => {
  it("waits for room when the node refuses the fifth, without signing past it, and sends everything in order", async () => {
    const db = await database();
    const chain = new FakeChain({ chainId: CHAIN_ID, maxPendingPerAccount: 4, maxPerBlock: 2 });
    const { logger, entries } = capturingLogger();
    const s = sender(db, chain, logger, { maxInFlight: 8 });
    // Wall time of the last refusal of each nonce the node turned away for want of room.
    const lastRefusal = new Map<bigint, number>();
    chain.refuseBroadcast = (tx): Error | undefined => {
      const pool = chain.pending(tx.from);
      if (pool.length >= 4 && !pool.some((pending) => pending.nonce === tx.nonce)) {
        lastRefusal.set(tx.nonce, Date.now());
      }
      return undefined;
    };
    await s.start();
    const ids: string[] = [];
    for (let index = 0; index < 10; index += 1) {
      const { id } = await s.enqueue({
        idempotencyKey: `cap-${index.toString()}`,
        signer: "relayer",
        kind: "buyFor",
        to: ESCROW,
        data: fakeCallData({ outcome: FAKE_OK, barrier: false, id: index }),
      });
      ids.push(id);
    }
    await waitUntil(() => chain.pending(accounts.relayer.address).length === 4, "a full pool");
    await pause(100);
    chain.startMining(60);
    const outcomes = await Promise.all(ids.map((id) => s.waitFor(id, { timeoutMs: 15_000 })));
    chain.stopMining();
    expect(outcomes.map((outcome) => outcome.status)).toEqual(Array(10).fill("mined"));
    const rows = await readChainTxs(db.db);
    expect(rows.map(rowInconsistency).filter(Boolean)).toEqual([]);
    expect(sortBigint(rows.map((row) => row.nonce ?? -1n))).toEqual(range(10));
    // Nonces follow the order of enqueue.
    expect(ids.map((id) => rows.find((row) => row.id === id)?.nonce)).toEqual(range(10));
    // The node did refuse, and the nonce after a refused one was signed only once the node had
    // taken it: never while it was being refused.
    expect(lastRefusal.size).toBeGreaterThan(0);
    for (const [nonce, at] of lastRefusal) {
      const next = rows.find((row) => row.nonce === nonce + 1n);
      if (next !== undefined) expect(next.sentAt?.getTime()).toBeGreaterThanOrEqual(at);
    }
    expect(entries.some((entry) => String(entry.msg).includes("broadcast failed, retrying"))).toBe(
      true,
    );
    // Every block mined at most two of them, in nonce order.
    const mined = chain.mined.filter((tx) => !tx.foreign).map((tx) => tx.nonce);
    expect(mined).toEqual(range(10));
    expect(chain.violations).toEqual([]);
  }, 30_000);
});

describe("random bursts, refusals, drops, reverts and restarts (seeded)", () => {
  /** mulberry32: a small seeded generator, so that a failing seed can be run again. */
  function generator(seed: number): () => number {
    let state = seed >>> 0;
    return (): number => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
  }

  // The test's own list, not `isIndependentTxKind`: a sender that let a barrier travel with others
  // must be caught even if the declaration itself were wrong.
  const INDEPENDENT_KINDS: readonly string[] = ["buyFor", "chargeHedge", "refundBatch"];
  const isBarrier = (kind: string): boolean => !INDEPENDENT_KINDS.includes(kind);
  const BARRIER_KINDS = [
    "settle",
    "setPaused",
    "createCampaignFor",
    "release",
    "payMerchant",
  ] as const;

  interface Planned {
    key: string;
    signer: SignerName;
    kind: string;
    outcome: number;
    id: number;
  }

  async function runSeed(seed: number): Promise<void> {
    const random = generator(seed);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    const db = await database();
    const chain = new FakeChain({ chainId: CHAIN_ID, maxPerBlock: 1 + Math.floor(random() * 6) });
    const { logger } = capturingLogger();
    const maxInFlight = 1 + Math.floor(random() * 8);
    const config: Partial<TxSenderConfig> = {
      maxInFlight,
      resendCheckMs: 40,
      replaceAfterMs: 1_500,
    };
    const rateLimited = random() * 0.15;
    const transient = random() * 0.15;
    chain.refuseBroadcast = (): Error | undefined => {
      const roll = random();
      if (roll < rateLimited) return fakeRateLimit();
      if (roll < rateLimited + transient) return fakeTransient();
      return undefined;
    };
    const blockMs = 10 + Math.floor(random() * 30);
    chain.startMining(blockMs);
    const drops = setInterval(() => {
      if (random() >= 0.2) return;
      const pending = [
        ...chain.pending(accounts.relayer.address),
        ...chain.pending(accounts.oracle.address),
      ];
      if (pending.length > 0) chain.drop(pick(pending).hash);
    }, 25);
    cleanups.push(() => {
      clearInterval(drops);
      chain.stopMining();
      return Promise.resolve();
    });

    const total = 8 + Math.floor(random() * 24);
    const planned: Planned[] = Array.from({ length: total }, (_, index) => {
      const roll = random();
      const kindRoll = random();
      return {
        key: `seed-${seed.toString()}-${index.toString()}`,
        signer: random() < 0.6 ? "relayer" : "oracle",
        kind:
          kindRoll < 0.65
            ? pick(INDEPENDENT_KINDS)
            : kindRoll < 0.9
              ? pick(BARRIER_KINDS)
              : "test.unknown-kind",
        outcome: roll < 0.1 ? FAKE_SIMULATION_REVERT : roll < 0.2 ? FAKE_CHAIN_REVERT : FAKE_OK,
        id: index,
      };
    });
    const restarts = Math.floor(random() * 3);
    const restartAt = new Set(Array.from({ length: restarts }, () => Math.floor(random() * total)));

    let current = sender(db, chain, logger, config);
    await current.start();
    const ids: string[] = [];
    let index = 0;
    while (index < total) {
      const burst = 1 + Math.floor(random() * 6);
      for (let n = 0; n < burst && index < total; n += 1, index += 1) {
        const item = planned[index] as Planned;
        const { id } = await current.enqueue({
          idempotencyKey: item.key,
          signer: item.signer,
          kind: item.kind,
          to: ESCROW,
          data: fakeCallData({
            outcome: item.outcome,
            barrier: isBarrier(item.kind),
            id: item.id,
          }),
        });
        ids.push(id);
        if (restartAt.has(index)) {
          await pause(Math.floor(random() * 40));
          await current.stop();
          current = sender(db, chain, logger, config);
          await current.start();
        }
      }
      await pause(Math.floor(random() * 50));
    }
    await waitUntil(
      async () =>
        (await readChainTxs(db.db)).every((row) =>
          ["mined", "reverted", "failed"].includes(row.status),
        ),
      `seed ${seed.toString()}: every transaction final`,
      30_000,
    );
    await current.stop();
    clearInterval(drops);
    chain.stopMining();

    const rows = await readChainTxs(db.db);
    const label = `seed ${seed.toString()} (window ${maxInFlight.toString()}, ${total.toString()} transactions)`;
    expect(rows, label).toHaveLength(total);
    expect(rows.map(rowInconsistency).filter(Boolean), label).toEqual([]);
    expect(chain.violations, label).toEqual([]);
    const byKey = new Map(rows.map((row) => [row.idempotencyKey, row]));
    for (const item of planned) {
      const row = byKey.get(item.key) as ChainTxSnapshot;
      const expected =
        item.outcome === FAKE_SIMULATION_REVERT
          ? "failed"
          : item.outcome === FAKE_CHAIN_REVERT
            ? "reverted"
            : "mined";
      expect(row.status, `${label}: ${item.key}`).toBe(expected);
      // Executed on-chain exactly once, or never.
      expect(chain.executions.get(item.id) ?? 0, `${label}: ${item.key}`).toBe(
        expected === "failed" ? 0 : 1,
      );
      if (expected === "failed") expect(row.lastError).toBe(FAKE_REVERT_REASON);
      if (expected === "reverted") expect(row.lastError).toBe(FAKE_REVERT_REASON);
    }
    for (const signer of ["relayer", "oracle"] as const) {
      const address = accounts[signer].address;
      // Nonces in the order of enqueue, consecutive from 0, and what the chain counts.
      const inOrder = ids
        .map((id) => rows.find((row) => row.id === id) as ChainTxSnapshot)
        .filter((row) => row.signer === signer && row.nonce !== null)
        .map((row) => row.nonce as bigint);
      expect(inOrder, `${label}: ${signer}`).toEqual(range(inOrder.length));
      expect(chain.minedCount(address), `${label}: ${signer}`).toBe(BigInt(inOrder.length));
      // Each nonce was mined as the row's own transaction.
      const minedTxs = chain.mined.filter((tx) => tx.from === address.toLowerCase());
      expect(
        minedTxs.every((tx) => !tx.foreign),
        label,
      ).toBe(true);
      for (const tx of minedTxs) {
        const row = rows.find(
          (candidate) => candidate.signer === signer && candidate.nonce === tx.nonce,
        );
        expect(row?.txHash, `${label}: nonce ${tx.nonce.toString()}`).toBe(tx.hash);
      }
      // Barriers: signed only once everything before them was mined, and nothing after them was
      // signed before they were mined.
      const signed = rows.filter((row) => row.signer === signer && row.nonce !== null);
      const minedAt = (row: ChainTxSnapshot): number =>
        chain.mined.find((tx) => tx.hash === row.txHash)?.minedAt ?? Number.NaN;
      for (const barrier of signed.filter((row) => isBarrier(row.kind))) {
        for (const other of signed) {
          if (other.id === barrier.id) continue;
          if ((other.nonce as bigint) < (barrier.nonce as bigint)) {
            expect(
              minedAt(other),
              `${label}: before barrier ${String(barrier.nonce)}`,
            ).toBeLessThanOrEqual(barrier.sentAt?.getTime() ?? 0);
          } else {
            expect(
              other.sentAt?.getTime(),
              `${label}: after barrier ${String(barrier.nonce)}`,
            ).toBeGreaterThanOrEqual(minedAt(barrier));
          }
        }
      }
    }
  }

  it("ends every transaction exactly once, with consecutive nonces in the order of enqueue, barriers alone", async () => {
    const seeds = Array.from({ length: 24 }, (_, index) => 1_000 + index * 7_919);
    for (const seed of seeds) {
      await runSeed(seed);
      for (const cleanup of cleanups.splice(0)) await cleanup();
      await Promise.allSettled(databases.splice(0).map((created) => created.drop()));
    }
  }, 300_000);
});

/**
 * A node whose pending count does not include what its pool holds: one that answers the
 * `pending` tag as `latest`, or a load-balanced RPC whose count comes from a backend that has
 * not seen the transaction. Every check of the pending count says the transactions in flight
 * are lost, and their re-broadcasts come back "already known". `lying: false` is the honest
 * fake chain (the positive control). Counts the pending-count reads.
 */
class PendingCountChain extends FakeChain {
  pendingCountReads = 0;

  constructor(
    options: ConstructorParameters<typeof FakeChain>[0],
    private readonly lying: boolean,
  ) {
    super(options);
  }

  override async getTransactionCount(request: {
    address: Address;
    blockTag: "latest" | "pending";
  }): Promise<number> {
    if (request.blockTag === "pending") this.pendingCountReads += 1;
    return super.getTransactionCount(
      this.lying ? { address: request.address, blockTag: "latest" } : request,
    );
  }
}

describe("the earliest transaction stuck behind a pending count that does not show it", () => {
  const REPLACE_AFTER_MS = 400;
  const RESEND_CHECK_MS = 100;

  /**
   * `lying`: the pending count never shows what the pool holds; re-broadcasts come back "already
   * known". `evicting`: the node keeps evicting the earliest (priced too low) and takes the same
   * bytes again when they are re-sent; its count is honest. `honest`: the positive control.
   */
  it.each([
    { window: 1, node: "lying" },
    { window: 8, node: "lying" },
    { window: 1, node: "evicting" },
    { window: 8, node: "evicting" },
    { window: 1, node: "honest" },
    { window: 8, node: "honest" },
  ] as const)(
    "window $window, $node node: bumps the fee after replaceAfterMs, raises the stuck alert, and re-broadcasts within the stated bound",
    async ({ window, node }) => {
      const db = await database();
      const chain = new PendingCountChain({ chainId: CHAIN_ID }, node === "lying");
      const { logger, entries } = capturingLogger();
      const s = sender(db, chain, logger, {
        maxInFlight: window,
        replaceAfterMs: REPLACE_AFTER_MS,
        resendCheckMs: RESEND_CHECK_MS,
        maxFeeBumps: 1,
      });
      const relayer = accounts.relayer.address;
      const evictions =
        node === "evicting"
          ? setInterval(() => {
              const earliest = chain.pending(relayer)[0];
              if (earliest?.nonce === chain.minedCount(relayer)) chain.drop(earliest.hash);
            }, 30)
          : undefined;
      cleanups.push(() => {
        clearInterval(evictions);
        return Promise.resolve();
      });
      await s.start();
      const ids: string[] = [];
      for (let index = 0; index < 4; index += 1) {
        const { id } = await s.enqueue({
          idempotencyKey: `stuck-${index.toString()}`,
          signer: "relayer",
          kind: "buyFor",
          to: ESCROW,
          data: fakeCallData({ outcome: FAKE_OK, barrier: false, id: index }),
        });
        ids.push(id);
      }
      const inFlight = Math.min(window, 4);
      await waitUntil(() => chain.accepted.length >= inFlight, `${inFlight.toString()} broadcasts`);
      // Nothing is mined for three seconds.
      await pause(2_000);
      const lastSecondFrom = Date.now();
      await pause(1_000);
      const lastSecond = chain.count("sendRawTransaction", lastSecondFrom);

      const rows = await readChainTxs(db.db);
      const head = rows.find((row) => row.nonce === 0n);
      // One fee bump (maxFeeBumps = 1), then the alert, on the row and in the error log.
      expect(head?.senderState?.attempts).toHaveLength(2);
      expect(head?.lastError).toMatch(/still pending after 1 fee bump/);
      expect(
        entries.some(
          (entry) =>
            entry.level === 50 && String(entry.msg).includes("signer's queue is blocked behind it"),
        ),
      ).toBe(true);
      // The later ones were never signed again.
      for (const row of rows.filter((candidate) => (candidate.nonce ?? 0n) > 0n)) {
        expect(row.senderState?.attempts).toHaveLength(1);
      }
      // Re-broadcasts in the last second: the stuck head every replaceAfterMs (its latest
      // attempt again), plus the pending-count check's. That check re-sends what the count does
      // not show: every resendCheckMs while the node really loses transactions, backing off to
      // once per replaceAfterMs while the node answers that it knew everything it was sent again.
      // One window makes no such check, as the one-at-a-time sender did not.
      const perReplace = Math.ceil(1_000 / REPLACE_AFTER_MS);
      const perCheck = Math.ceil(
        1_000 / (node === "evicting" ? RESEND_CHECK_MS : REPLACE_AFTER_MS),
      );
      const bound = perReplace + (window === 1 ? 0 : inFlight * perCheck);
      process.stdout.write(
        `[stuck head, window ${window.toString()}, ${node} node] sendRawTransaction in the last second: ${lastSecond.toString()} (bound ${bound.toString()}), pending-count reads: ${chain.pendingCountReads.toString()}\n`,
      );
      expect(lastSecond).toBeLessThanOrEqual(bound);
      if (window === 1) {
        // One read at start (the nonce), none to look for lost transactions.
        expect(chain.pendingCountReads).toBe(1);
      }

      // The node stops evicting and mining resumes: everything is mined once, in the order of
      // enqueue, no gap.
      clearInterval(evictions);
      chain.startMining(20);
      const outcomes = await Promise.all(ids.map((id) => s.waitFor(id, { timeoutMs: 10_000 })));
      chain.stopMining();
      expect(outcomes.map((outcome) => outcome.status)).toEqual(Array(4).fill("mined"));
      const final = await readChainTxs(db.db);
      expect(final.map(rowInconsistency).filter(Boolean)).toEqual([]);
      expect(ids.map((id) => final.find((row) => row.id === id)?.nonce)).toEqual(range(4));
      expect(chain.mined.map((tx) => tx.nonce)).toEqual(range(4));
      await s.stop();
    },
    20_000,
  );
});

describe("one transaction at a time (maxInFlight = 1) asks the node what the serial sender asked", () => {
  it("simulates, estimates gas, then reads fees, one after the other and for every transaction; a call that reverts costs its simulation only", async () => {
    const db = await database();
    const chain = new PendingCountChain({ chainId: CHAIN_ID }, false);
    const { logger } = capturingLogger();
    const s = sender(db, chain, logger, { maxInFlight: 1, feeSuggestionMaxAgeMs: 60_000 });
    // The order in which each preparation request starts and ends.
    const trace: string[] = [];
    const methods = ["call", "estimateGas", "estimateFeesPerGas"] as const;
    for (const method of methods) {
      const original = chain[method].bind(chain) as (request?: unknown) => Promise<unknown>;
      (chain as unknown as Record<string, unknown>)[method] = async (
        request?: unknown,
      ): Promise<unknown> => {
        trace.push(`${method}:start`);
        try {
          return await original(request);
        } finally {
          trace.push(`${method}:end`);
        }
      };
    }
    chain.startMining(20);
    await s.start();
    const plan = [FAKE_OK, FAKE_SIMULATION_REVERT, FAKE_OK, FAKE_OK];
    const ids: string[] = [];
    for (const [index, outcome] of plan.entries()) {
      const { id } = await s.enqueue({
        idempotencyKey: `serial-${index.toString()}`,
        signer: "relayer",
        kind: "buyFor",
        to: ESCROW,
        data: fakeCallData({ outcome, barrier: false, id: index }),
      });
      ids.push(id);
    }
    const outcomes = await Promise.all(ids.map((id) => s.waitFor(id, { timeoutMs: 10_000 })));
    chain.stopMining();
    await s.stop();
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      "mined",
      "failed",
      "mined",
      "mined",
    ]);
    const prepare = [
      "call:start",
      "call:end",
      "estimateGas:start",
      "estimateGas:end",
      "estimateFeesPerGas:start",
      "estimateFeesPerGas:end",
    ];
    // Without the replays of reverted calls on their block (none here: nothing reverted
    // on-chain), the trace is the serial sender's: three sequential reads per transaction sent,
    // a fresh fee read each time whatever the cache's age, and the simulation alone for the
    // call that reverts.
    expect(trace).toEqual([...prepare, "call:start", "call:end", ...prepare, ...prepare]);
  }, 20_000);
});
