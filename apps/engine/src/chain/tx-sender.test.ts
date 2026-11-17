import { toHex, type Hex } from "viem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createArcClients } from "./clients";
import { describeError } from "./decode-error";
import {
  ChainIdMismatchError,
  InvalidTxRequestError,
  TxNotFoundError,
  TxSenderConfigError,
  TxSenderStoppedError,
  TxWaitTimeoutError,
} from "./errors";
import { addGasMargin } from "./fees";
import {
  createChainHarness,
  FEE_FLOOR_WEI,
  REVERTING_CALL_DATA,
  rowInconsistency,
  TEST_REVERT_ERROR,
  TEST_SENDER_CONFIG,
  waitUntil,
  wrapClient,
  type ChainHarness,
  type ChainTxSnapshot,
} from "./test-support";
import { TxSender } from "./tx-sender";
import { SIGNER_NAMES, type SignerName, type TxRequest } from "./types";

function range(count: number): bigint[] {
  return Array.from({ length: count }, (_, index) => BigInt(index));
}

/** Nonces assigned to a signer, in ascending order. */
function noncesOf(rows: readonly ChainTxSnapshot[], signer: SignerName): bigint[] {
  return rows
    .filter((row) => row.signer === signer && row.nonce !== null)
    .map((row) => row.nonce as bigint)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

async function eventCount(h: ChainHarness): Promise<bigint> {
  const [row] = await h.db<{ n: bigint }[]>`select count(*) as n from chain_events`;
  return row?.n ?? -1n;
}

describe("TxSender", () => {
  let h: ChainHarness;

  beforeEach(async () => {
    h = await createChainHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  describe("concurrency", () => {
    it("mines 50 transactions enqueued at once across both signers, each signer's nonces 0..n-1", async () => {
      const sender = h.createSender();
      await sender.start();

      // 30 for the relayer, 20 for the oracle, interleaved.
      const requests = Array.from({ length: 50 }, (_, index) =>
        h.bumpRequest(index % 5 < 3 ? "relayer" : "oracle", `concurrent-${index.toString()}`),
      );
      const outcomes = await Promise.all(
        requests.map((request) => sender.sendAndWait(request, { timeoutMs: 60_000 })),
      );

      expect(outcomes.map((outcome) => outcome.status)).toEqual(Array(50).fill("mined"));
      const rows = await h.rows();
      expect(rows).toHaveLength(50);
      expect(rows.map(rowInconsistency).filter(Boolean)).toEqual([]);
      expect(new Set(rows.map((row) => row.txHash)).size).toBe(50);

      const expected: Record<SignerName, number> = { relayer: 30, oracle: 20 };
      for (const signer of SIGNER_NAMES) {
        // 0..n-1: no gap, no duplicate.
        expect(noncesOf(rows, signer)).toEqual(range(expected[signer]));
        // And the chain agrees: exactly n transactions of that key were mined.
        expect(await h.minedCount(h.accounts[signer].address)).toBe(expected[signer]);
      }
      // Each stored (hash, nonce) is the transaction that is on-chain, signed by the right key.
      for (const row of rows) {
        const onChain = await h.client.getTransaction({ hash: row.txHash as Hex });
        expect(BigInt(onChain.nonce)).toBe(row.nonce);
        expect(onChain.from.toLowerCase()).toBe(h.accounts[row.signer].address.toLowerCase());
      }
      // Every call ran exactly once.
      expect(await h.counter(h.escrow)).toBe(50n);
      expect(await eventCount(h)).toBe(50n);
    }, 90_000);
  });

  describe("idempotency", () => {
    it("returns the existing row for a key enqueued twice", async () => {
      const sender = h.createSender();
      await sender.start();
      const request = h.bumpRequest("relayer", "pay:pi_123");

      const first = await sender.enqueue(request);
      const second = await sender.enqueue(request);
      expect(first.created).toBe(true);
      expect(second).toEqual({ id: first.id, created: false });

      const outcome = await sender.waitFor(first.id, { timeoutMs: 10_000 });
      expect(outcome.status).toBe("mined");
      // Enqueueing again after it is mined still creates nothing.
      expect(await sender.enqueue(request)).toEqual({ id: first.id, created: false });
      expect(await sender.sendAndWait(request)).toEqual(outcome);

      expect(await h.rows()).toHaveLength(1);
      expect(await h.minedCount(h.accounts.relayer.address)).toBe(1);
      expect(await h.counter(h.escrow)).toBe(1n);
    });

    it("creates one row and one transaction for 20 concurrent enqueues of one key", async () => {
      const sender = h.createSender();
      await sender.start();
      const request = h.bumpRequest("oracle", "settle:42");

      const results = await Promise.all(Array.from({ length: 20 }, () => sender.enqueue(request)));
      expect(new Set(results.map((result) => result.id)).size).toBe(1);
      expect(results.filter((result) => result.created)).toHaveLength(1);

      const id = results[0]?.id as string;
      expect((await sender.waitFor(id, { timeoutMs: 10_000 })).status).toBe("mined");
      // Positive control: a different key does create a second transaction.
      expect((await sender.sendAndWait(h.bumpRequest("oracle", "settle:43"))).status).toBe("mined");

      const rows = await h.rows();
      expect(rows).toHaveLength(2);
      expect(noncesOf(rows, "oracle")).toEqual([0n, 1n]);
      expect(await h.minedCount(h.accounts.oracle.address)).toBe(2);
      expect(await h.counter(h.escrow)).toBe(2n);
    });

    it("keeps the first transaction when a key comes back with another call", async () => {
      const sender = h.createSender();
      await sender.start();
      const first = await sender.enqueue(h.bumpRequest("relayer", "same-key"));
      const second = await sender.enqueue({
        ...h.bumpRequest("relayer", "same-key"),
        to: h.otherContract,
        data: "0x1234",
      });
      expect(second).toEqual({ id: first.id, created: false });
      await sender.waitFor(first.id, { timeoutMs: 10_000 });

      expect(await h.rows()).toHaveLength(1);
      expect(await h.counter(h.escrow)).toBe(1n);
      expect(await h.counter(h.otherContract)).toBe(0n);
      expect(h.logLines.some((line) => line.includes("idempotency key reused"))).toBe(true);
    });

    it("rejects a malformed request without writing a row", async () => {
      const sender = h.createSender();
      const bad = { ...h.bumpRequest("relayer", "bad"), to: "0x1234" } as TxRequest;
      await expect(sender.enqueue(bad)).rejects.toBeInstanceOf(InvalidTxRequestError);
      expect(await h.rows()).toHaveLength(0);
    });
  });

  describe("crash safety", () => {
    it("re-broadcasts the stored transaction after a crash between persist and broadcast", async () => {
      let stopped: Promise<void> | undefined;
      let broadcasts = 0;
      const first: TxSender = h.createSender({
        client: wrapClient(h.client, {
          sendRawTransaction: () => {
            broadcasts += 1;
            // The process dies here: the row is stored, the node never hears of it.
            stopped = first.stop();
            return Promise.reject(new Error("simulated crash before broadcast"));
          },
        }),
      });
      await first.start();
      const { id } = await first.enqueue(h.bumpRequest("relayer", "crash-1"));
      await waitUntil(() => stopped !== undefined, "the broadcast attempt");
      await stopped;

      // What the crash left: a signed, stored transaction that no node has seen.
      const [crashed] = await h.rows();
      expect(crashed).toMatchObject({ status: "sent", nonce: 0n });
      expect(crashed && rowInconsistency(crashed)).toBeUndefined();
      expect(broadcasts).toBe(1);
      const storedHash = crashed?.txHash as Hex;
      await expect(h.client.getTransaction({ hash: storedHash })).rejects.toThrow(
        /could not be found/,
      );
      expect(
        await h.client.getTransactionCount({
          address: h.accounts.relayer.address,
          blockTag: "pending",
        }),
      ).toBe(0);
      expect(await h.counter(h.escrow)).toBe(0n);

      // A new instance on the same database.
      const second = h.createSender();
      await second.start();
      const outcome = await second.waitFor(id, { timeoutMs: 10_000 });

      // Mined, and it is the stored transaction (same hash), not a second signature.
      expect(outcome.status).toBe("mined");
      expect(outcome.txHash).toBe(storedHash);
      const [recovered] = await h.rows();
      expect(recovered?.senderState?.attempts).toHaveLength(1);
      // Exactly once.
      expect(await h.counter(h.escrow)).toBe(1n);
      expect(await h.minedCount(h.accounts.relayer.address)).toBe(1);

      // The sequence goes on from there, without a gap.
      expect((await second.sendAndWait(h.bumpRequest("relayer", "crash-2"))).status).toBe("mined");
      expect(noncesOf(await h.rows(), "relayer")).toEqual([0n, 1n]);
      expect(await h.minedCount(h.accounts.relayer.address)).toBe(2);
      expect(await h.counter(h.escrow)).toBe(2n);
    });

    it("does not send twice after a crash between broadcast and receipt", async () => {
      let stopped: Promise<void> | undefined;
      const first: TxSender = h.createSender({
        client: wrapClient(h.client, {
          sendRawTransaction: async (request) => {
            const hash = await h.client.sendRawTransaction(request);
            // The process dies here: the node has the transaction, the row still says `sent`.
            stopped = first.stop();
            return hash;
          },
        }),
      });
      await first.start();
      const { id } = await first.enqueue(h.bumpRequest("relayer", "crash-after-broadcast"));
      await waitUntil(() => stopped !== undefined, "the broadcast");
      await stopped;

      const [crashed] = await h.rows();
      expect(crashed).toMatchObject({ status: "sent", nonce: 0n, blockNumber: null });
      const storedHash = crashed?.txHash as Hex;
      await waitUntil(
        async () => (await h.minedCount(h.accounts.relayer.address)) === 1,
        "the block that mines it",
      );

      // The new instance re-broadcasts the same bytes; the node refuses them as already mined.
      const refusals: string[] = [];
      const second = h.createSender({
        client: wrapClient(h.client, {
          sendRawTransaction: async (request) => {
            try {
              return await h.client.sendRawTransaction(request);
            } catch (error: unknown) {
              refusals.push(describeError(error));
              throw error;
            }
          },
        }),
      });
      await second.start();
      const outcome = await second.waitFor(id, { timeoutMs: 10_000 });

      expect(refusals).toHaveLength(1);
      expect(refusals[0]).toMatch(/nonce too low/i);
      expect(outcome).toMatchObject({ status: "mined", txHash: storedHash });
      expect(outcome.events).toHaveLength(1);
      expect(await h.counter(h.escrow)).toBe(1n);
      expect(await h.minedCount(h.accounts.relayer.address)).toBe(1);

      expect((await second.sendAndWait(h.bumpRequest("relayer", "after"))).status).toBe("mined");
      expect(noncesOf(await h.rows(), "relayer")).toEqual([0n, 1n]);
    });

    it("leaves the row queued when the crash comes before anything is signed", async () => {
      let stopped: Promise<void> | undefined;
      const first: TxSender = h.createSender({
        client: wrapClient(h.client, {
          estimateGas: (request) => {
            stopped = first.stop();
            return h.client.estimateGas(request);
          },
        }),
      });
      await first.start();
      const { id } = await first.enqueue(h.bumpRequest("oracle", "crash-early"));
      await waitUntil(() => stopped !== undefined, "the simulation");
      await stopped;

      const [crashed] = await h.rows();
      expect(crashed).toMatchObject({ status: "queued", nonce: null, txHash: null });
      expect(crashed && rowInconsistency(crashed)).toBeUndefined();

      const second = h.createSender();
      await second.start();
      expect((await second.waitFor(id, { timeoutMs: 10_000 })).status).toBe("mined");
      expect(noncesOf(await h.rows(), "oracle")).toEqual([0n]);
      expect(await h.counter(h.escrow)).toBe(1n);
    });
  });

  describe("simulation", () => {
    it("fails a call that would revert without using a nonce, and sends the next one", async () => {
      const sender = h.createSender();
      await sender.start();

      const reverted = await sender.sendAndWait({
        idempotencyKey: "revert-1",
        signer: "relayer",
        kind: "test.revert",
        to: h.escrow,
        data: REVERTING_CALL_DATA,
      });
      expect(reverted).toEqual({
        id: reverted.id,
        status: "failed",
        events: [],
        error: TEST_REVERT_ERROR,
      });
      expect(TEST_REVERT_ERROR).toBe("SalesArePaused");

      const [failed] = await h.rows();
      expect(failed).toMatchObject({ status: "failed", nonce: null, txHash: null, sentAt: null });
      expect(failed?.senderState).toBeUndefined();
      // Nothing reached the chain, mined or pending.
      expect(
        await h.client.getTransactionCount({
          address: h.accounts.relayer.address,
          blockTag: "pending",
        }),
      ).toBe(0);

      // The next transaction of that signer goes through, with the nonce the failed one did not take.
      const next = await sender.sendAndWait(h.bumpRequest("relayer", "after-revert"));
      expect(next.status).toBe("mined");
      expect(noncesOf(await h.rows(), "relayer")).toEqual([0n]);
      expect(await h.minedCount(h.accounts.relayer.address)).toBe(1);
      expect(await h.counter(h.escrow)).toBe(1n);
    });

    it("fails a transfer the signer cannot afford, without using a nonce", async () => {
      await h.anvil.rpc("anvil_setBalance", [h.accounts.oracle.address, toHex(10n ** 18n)]);
      const sender = h.createSender();
      await sender.start();

      const outcome = await sender.sendAndWait({
        idempotencyKey: "too-much",
        signer: "oracle",
        kind: "test.transfer",
        to: h.bystander.address,
        data: "0x",
        value: 5n * 10n ** 18n,
      });
      expect(outcome).toMatchObject({ status: "failed", error: "InsufficientFunds" });

      // Positive control: an amount it can afford is sent, with nonce 0.
      const affordable = await sender.sendAndWait({
        idempotencyKey: "affordable",
        signer: "oracle",
        kind: "test.transfer",
        to: h.bystander.address,
        data: "0x",
        value: 10n ** 17n,
      });
      expect(affordable.status).toBe("mined");
      expect(noncesOf(await h.rows(), "oracle")).toEqual([0n]);
    });

    it("records a transaction that reverts once mined as reverted, with its nonce used", async () => {
      // The simulation is bypassed so that a reverting call reaches the chain.
      const sender = h.createSender({
        client: wrapClient(h.client, {
          call: (request) =>
            request.blockNumber === undefined ? Promise.resolve({}) : h.client.call(request),
          estimateGas: () => Promise.resolve(100_000n),
        }),
      });
      await sender.start();

      const outcome = await sender.sendAndWait({
        idempotencyKey: "revert-on-chain",
        signer: "relayer",
        kind: "test.revert",
        to: h.escrow,
        data: REVERTING_CALL_DATA,
      });
      expect(outcome).toMatchObject({ status: "reverted", error: TEST_REVERT_ERROR, events: [] });
      expect(outcome.txHash).toBeDefined();
      expect(outcome.blockNumber).toBeGreaterThan(0n);
      const receipt = await h.client.getTransactionReceipt({ hash: outcome.txHash as Hex });
      expect(receipt.status).toBe("reverted");

      const [row] = await h.rows();
      expect(row).toMatchObject({ status: "reverted", nonce: 0n });
      expect(row && rowInconsistency(row)).toBeUndefined();
      expect(await eventCount(h)).toBe(0n);

      expect((await sender.sendAndWait(h.bumpRequest("relayer", "after"))).status).toBe("mined");
      expect(noncesOf(await h.rows(), "relayer")).toEqual([0n, 1n]);
    });
  });

  describe("fees and gas", () => {
    it("never signs a maxFeePerGas below Arc's floor when the node suggests less", async () => {
      // Positive control: this node does suggest less than the floor.
      const suggestion = await h.client.estimateFeesPerGas();
      expect(suggestion.maxFeePerGas).toBeLessThan(FEE_FLOOR_WEI);

      const estimate = await h.client.estimateGas({
        account: h.accounts.relayer.address,
        to: h.escrow,
        data: "0x",
      });
      const sender = h.createSender();
      await sender.start();
      const outcome = await sender.sendAndWait(h.bumpRequest("relayer", "fee-floor"));

      const onChain = await h.client.getTransaction({ hash: outcome.txHash as Hex });
      expect(onChain.type).toBe("eip1559");
      expect(onChain.maxFeePerGas).toBe(FEE_FLOOR_WEI);
      expect(onChain.maxPriorityFeePerGas).toBeGreaterThan(0n);
      expect(onChain.maxPriorityFeePerGas).toBeLessThanOrEqual(FEE_FLOOR_WEI);
      // Gas limit: the estimate plus 20 %.
      expect(onChain.gas).toBe(addGasMargin(estimate, 20));
      expect(onChain.gas).toBe((estimate * 120n + 99n) / 100n);

      const [row] = await h.rows();
      expect(row?.senderState?.attempts[0]?.maxFeePerGas).toBe(FEE_FLOOR_WEI.toString());
    });

    it("keeps every transaction of a batch at or above the floor", async () => {
      const sender = h.createSender();
      await sender.start();
      const outcomes = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          sender.sendAndWait(
            h.bumpRequest(index % 2 ? "relayer" : "oracle", `floor-${index.toString()}`),
          ),
        ),
      );
      for (const outcome of outcomes) {
        const onChain = await h.client.getTransaction({ hash: outcome.txHash as Hex });
        expect(onChain.maxFeePerGas).toBeGreaterThanOrEqual(FEE_FLOOR_WEI);
      }
    });
  });

  describe("receipts", () => {
    it("writes the escrow's logs to chain_events once and returns them to the caller", async () => {
      const sender = h.createSender();
      await sender.start();
      const outcome = await sender.sendAndWait({
        ...h.bumpRequest("relayer", "event-1"),
        payload: { campaignId: 7n, note: "top up" },
      });

      expect(outcome.status).toBe("mined");
      expect(outcome.events).toEqual([
        {
          name: "BudgetToppedUp",
          args: { id: "1", amount: "42" },
          txHash: outcome.txHash,
          logIndex: 0,
          blockNumber: outcome.blockNumber,
        },
      ]);

      const stored = await h.db<
        {
          tx_hash: string;
          log_index: number;
          block_number: bigint;
          block_time: Date;
          name: string;
          args: unknown;
          source: string;
        }[]
      >`select * from chain_events`;
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        tx_hash: outcome.txHash,
        log_index: 0,
        block_number: outcome.blockNumber,
        name: "BudgetToppedUp",
        args: { id: "1", amount: "42" },
        source: "receipt",
      });

      const [row] = await h.rows();
      expect(row).toMatchObject({
        status: "mined",
        blockNumber: outcome.blockNumber,
        lastError: null,
      });
      // mined_at and block_time are the block's timestamp.
      const block = await h.client.getBlock({ blockNumber: outcome.blockNumber as bigint });
      expect(row?.minedAt?.getTime()).toBe(Number(block.timestamp) * 1000);
      expect(stored[0]?.block_time.getTime()).toBe(Number(block.timestamp) * 1000);
      // The caller's payload is kept next to what the sender stores.
      expect(row?.payload).toMatchObject({ campaignId: "7", note: "top up" });
    });

    it("ignores logs emitted by any other address", async () => {
      const sender = h.createSender();
      await sender.start();
      const outcome = await sender.sendAndWait({
        ...h.bumpRequest("relayer", "other-contract"),
        to: h.otherContract,
      });

      expect(outcome.status).toBe("mined");
      expect(outcome.events).toEqual([]);
      expect(await eventCount(h)).toBe(0n);
      // Positive control: the transaction did emit a log, with an escrow event's signature.
      const receipt = await h.client.getTransactionReceipt({ hash: outcome.txHash as Hex });
      expect(receipt.logs).toHaveLength(1);
      expect(receipt.logs[0]?.address.toLowerCase()).toBe(h.otherContract);

      // And the escrow's own log, in the same run, is indexed.
      const indexed = await sender.sendAndWait(h.bumpRequest("relayer", "escrow"));
      expect(indexed.events).toHaveLength(1);
      expect(await eventCount(h)).toBe(1n);
    });

    it("does not duplicate events when the receipt is processed again", async () => {
      const first = h.createSender();
      await first.start();
      const outcome = await first.sendAndWait(h.bumpRequest("oracle", "replay"));
      expect(await eventCount(h)).toBe(1n);
      await first.stop();

      // Put the row back to `sent`, as if the receipt had never been recorded.
      await h.db`
        update chain_txs set status = 'sent', block_number = null, mined_at = null
        where id = ${outcome.id}
      `;
      const second = h.createSender();
      await second.start();
      const replayed = await second.waitFor(outcome.id, { timeoutMs: 10_000 });

      expect(replayed).toEqual(outcome);
      expect(await eventCount(h)).toBe(1n);
      expect(await h.counter(h.escrow)).toBe(1n);
      expect(await h.minedCount(h.accounts.oracle.address)).toBe(1);
    });
  });

  describe("stop", () => {
    it("leaves every row queued, sent or final when stopped during activity, and resumes cleanly", async () => {
      const first = h.createSender();
      await first.start();
      const requests = Array.from({ length: 30 }, (_, index) =>
        h.bumpRequest(index % 2 ? "relayer" : "oracle", `stop-${index.toString()}`),
      );
      const enqueued = await Promise.all(requests.map((request) => first.enqueue(request)));
      await waitUntil(
        async () => (await h.rows()).filter((row) => row.status === "mined").length >= 4,
        "a few mined transactions",
      );
      await first.stop();

      const stoppedRows = await h.rows();
      expect(stoppedRows).toHaveLength(30);
      expect(stoppedRows.map(rowInconsistency).filter(Boolean)).toEqual([]);
      // Positive control: the stop did interrupt the work.
      const queued = stoppedRows.filter((row) => row.status === "queued");
      expect(queued.length).toBeGreaterThan(0);
      for (const signer of SIGNER_NAMES) {
        const assigned = noncesOf(stoppedRows, signer);
        expect(assigned).toEqual(range(assigned.length));
        const inFlight = stoppedRows.filter(
          (row) => row.signer === signer && row.status === "sent",
        );
        expect(inFlight.length).toBeLessThanOrEqual(1);
      }

      // Nothing moves once stop() has returned.
      await new Promise((resolve) => setTimeout(resolve, 200));
      const summary = (rows: readonly ChainTxSnapshot[]): string[] =>
        rows.map((row) => `${row.id}:${row.status}:${String(row.nonce)}:${String(row.txHash)}`);
      expect(summary(await h.rows())).toEqual(summary(stoppedRows));
      // A caller waiting on an unfinished transaction is told, not left hanging.
      await expect(
        first.waitFor(queued[0]?.id as string, { timeoutMs: 5_000 }),
      ).rejects.toBeInstanceOf(TxSenderStoppedError);

      // A new instance finishes the work: all mined, no gap, no duplicate.
      const second = h.createSender();
      await second.start();
      const outcomes = await Promise.all(
        enqueued.map(({ id }) => second.waitFor(id, { timeoutMs: 60_000 })),
      );
      expect(outcomes.map((outcome) => outcome.status)).toEqual(Array(30).fill("mined"));
      const finalRows = await h.rows();
      expect(finalRows.map(rowInconsistency).filter(Boolean)).toEqual([]);
      for (const signer of SIGNER_NAMES) {
        expect(noncesOf(finalRows, signer)).toEqual(range(15));
        expect(await h.minedCount(h.accounts[signer].address)).toBe(15);
      }
      expect(await h.counter(h.escrow)).toBe(30n);
      expect(await eventCount(h)).toBe(30n);
    }, 90_000);

    it("can be stopped twice, and started again on the same instance", async () => {
      const sender = h.createSender();
      await sender.stop();
      await sender.start();
      await sender.start();
      expect((await sender.sendAndWait(h.bumpRequest("relayer", "one"))).status).toBe("mined");
      await Promise.all([sender.stop(), sender.stop()]);
      await sender.stop();

      const { id } = await sender.enqueue(h.bumpRequest("relayer", "two"));
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect((await h.rows()).find((row) => row.id === id)?.status).toBe("queued");

      await sender.start();
      expect((await sender.waitFor(id, { timeoutMs: 10_000 })).status).toBe("mined");
      expect(noncesOf(await h.rows(), "relayer")).toEqual([0n, 1n]);
    });
  });

  describe("waitFor", () => {
    it("times out on a transaction that is not final, without cancelling it", async () => {
      const sender = h.createSender();
      // Not started: the row stays queued.
      const { id } = await sender.enqueue(h.bumpRequest("relayer", "slow"));
      const error = await sender.waitFor(id, { timeoutMs: 80 }).then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(TxWaitTimeoutError);
      expect(error).toMatchObject({ id, timeoutMs: 80, status: "queued" });

      await sender.start();
      expect((await sender.waitFor(id, { timeoutMs: 10_000 })).status).toBe("mined");
    });

    it("rejects an unknown id", async () => {
      const sender = h.createSender();
      await expect(
        sender.waitFor("00000000-0000-4000-8000-000000000000", { timeoutMs: 1_000 }),
      ).rejects.toBeInstanceOf(TxNotFoundError);
    });

    it("returns the outcome of a final transaction even from a sender that never ran", async () => {
      const sender = h.createSender();
      await sender.start();
      const outcome = await sender.sendAndWait(h.bumpRequest("relayer", "done"));
      await sender.stop();

      expect(await sender.waitFor(outcome.id, { timeoutMs: 1_000 })).toEqual(outcome);
      const fresh = h.createSender();
      expect(await fresh.waitFor(outcome.id, { timeoutMs: 1_000 })).toEqual(outcome);
    });
  });

  describe("nonces", () => {
    it("starts from the chain's count when the key was used before", async () => {
      // Two transactions of the relayer key that the table knows nothing about.
      for (const nonce of [0, 1]) {
        const raw = await h.accounts.relayer.signTransaction({
          type: "eip1559",
          chainId: h.chainId,
          nonce,
          gas: 21_000n,
          maxFeePerGas: FEE_FLOOR_WEI,
          maxPriorityFeePerGas: 1_000_000_000n,
          to: h.bystander.address,
        });
        await h.client.waitForTransactionReceipt({
          hash: await h.client.sendRawTransaction({ serializedTransaction: raw }),
          pollingInterval: 10,
        });
      }

      const sender = h.createSender();
      await sender.start();
      expect((await sender.sendAndWait(h.bumpRequest("relayer", "a"))).status).toBe("mined");
      expect((await sender.sendAndWait(h.bumpRequest("relayer", "b"))).status).toBe("mined");
      expect((await sender.sendAndWait(h.bumpRequest("oracle", "c"))).status).toBe("mined");

      const rows = await h.rows();
      expect(noncesOf(rows, "relayer")).toEqual([2n, 3n]);
      expect(noncesOf(rows, "oracle")).toEqual([0n]);
    });

    it("picks up a row written while it was idle, without being told", async () => {
      const running = h.createSender();
      await running.start();
      // Another instance on the same database only inserts: the running one is not woken.
      const writer = h.createSender();
      const { id } = await writer.enqueue(h.bumpRequest("oracle", "from-elsewhere"));
      expect((await running.waitFor(id, { timeoutMs: 10_000 })).status).toBe("mined");
    });
  });

  describe("construction and start", () => {
    it("refuses the same key for both signers", () => {
      expect(
        () =>
          new TxSender({
            db: h.db,
            client: h.client,
            accounts: { relayer: h.accounts.relayer, oracle: h.accounts.relayer },
            logger: h.logger,
            config: { chainId: h.chainId, escrowAddress: h.escrow },
          }),
      ).toThrow(TxSenderConfigError);
    });

    it("refuses to start against a node on another chain", async () => {
      const sender = h.createSender({ config: { chainId: 1 } });
      await expect(sender.start()).rejects.toBeInstanceOf(ChainIdMismatchError);
      // Nothing runs: a queued row stays queued.
      const { id } = await sender.enqueue(h.bumpRequest("relayer", "never"));
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect((await h.rows()).find((row) => row.id === id)?.status).toBe("queued");
    });

    it("refuses to start when the node cannot be reached", async () => {
      const sender = h.createSender({
        client: wrapClient(h.client, {
          getChainId: () => Promise.reject(new Error("connect ECONNREFUSED")),
        }),
      });
      await expect(sender.start()).rejects.toThrow(/could not be reached: connect ECONNREFUSED/);
    });
  });

  describe("secrets", () => {
    it("never writes a private key to the logs or to the database", async () => {
      const sender = h.createSender();
      await sender.start();
      await sender.sendAndWait(h.bumpRequest("relayer", "secret-1"));
      await sender.sendAndWait(h.bumpRequest("oracle", "secret-2"));
      await sender.sendAndWait({
        idempotencyKey: "secret-3",
        signer: "relayer",
        kind: "test.revert",
        to: h.escrow,
        data: REVERTING_CALL_DATA,
      });
      await sender.stop();

      const logs = h.logLines.join("\n").toLowerCase();
      const tables = JSON.stringify(
        await h.db`select row_to_json(t)::text as row from chain_txs t`,
      ).toLowerCase();
      // Positive control: both haystacks hold what the sender does write.
      const [row] = await h.rows();
      expect(logs).toContain(row?.txHash as string);
      expect(tables).toContain(row?.txHash as string);
      expect(h.logLines.length).toBeGreaterThan(5);

      for (const signer of SIGNER_NAMES) {
        const key = h.privateKeys[signer].slice(2).toLowerCase();
        expect(key).toHaveLength(64);
        expect(logs).not.toContain(key);
        expect(tables).not.toContain(key);
      }
    });
  });
});

describe("TxSender with the clients of createArcClients", () => {
  it("sends through the fallback RPC when the primary is down", async () => {
    const h = await createChainHarness();
    try {
      const clients = createArcClients(
        {
          ARC_CHAIN_ID: h.chainId,
          ARC_RPC_URL: "http://127.0.0.1:1",
          ARC_RPC_FALLBACK_URL: h.anvil.rpcUrl,
          ARC_RELAYER_PRIVATE_KEY: h.privateKeys.relayer,
          ARC_ORACLE_PRIVATE_KEY: h.privateKeys.oracle,
        },
        { retryCount: 0, requestTimeoutMs: 2_000 },
      );
      const sender = new TxSender({
        db: h.db,
        client: clients.publicClient,
        accounts: clients.accounts,
        logger: h.logger,
        config: { chainId: h.chainId, escrowAddress: h.escrow, ...TEST_SENDER_CONFIG },
      });
      await sender.start();
      try {
        const mined = await sender.sendAndWait(h.bumpRequest("relayer", "via-fallback"));
        expect(mined.status).toBe("mined");
        expect(mined.events).toHaveLength(1);
        const failed = await sender.sendAndWait({
          idempotencyKey: "via-fallback-revert",
          signer: "oracle",
          kind: "test.revert",
          to: h.escrow,
          data: REVERTING_CALL_DATA,
        });
        expect(failed).toMatchObject({ status: "failed", error: TEST_REVERT_ERROR });
      } finally {
        await sender.stop();
      }
    } finally {
      await h.close();
    }
  });
});

describe("TxSender on a node that suggests more than the floor", () => {
  it("follows the node's suggestion", async () => {
    const h = await createChainHarness({ baseFeeWei: 100_000_000_000n });
    try {
      const sender = h.createSender();
      await sender.start();
      const outcome = await sender.sendAndWait(h.bumpRequest("relayer", "busy"));
      expect(outcome.status).toBe("mined");
      const onChain = await h.client.getTransaction({ hash: outcome.txHash as Hex });
      expect(onChain.maxFeePerGas).toBeGreaterThan(FEE_FLOOR_WEI);
      const [row] = await h.rows();
      expect(row?.senderState?.attempts[0]?.maxFeePerGas).toBe(String(onChain.maxFeePerGas));
    } finally {
      await h.close();
    }
  });
});
