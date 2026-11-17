import { parseTransaction, type Hex } from "viem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { abortableSleep } from "./clock";
import {
  createChainHarness,
  FEE_FLOOR_WEI,
  rowInconsistency,
  sendDirect,
  transientError,
  waitUntil,
  wrapClient,
  type ChainHarness,
} from "./test-support";
import { TxSender } from "./tx-sender";
import { SENDER_STATE_KEY, type Clock } from "./types";

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("TxSender under failure", () => {
  let h: ChainHarness;

  beforeEach(async () => {
    h = await createChainHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  describe("replacement", () => {
    it("replaces a transaction that is not mined with the same nonce and a higher fee, a bounded number of times", async () => {
      await h.anvil.rpc("evm_setAutomine", [false]);
      const sender = h.createSender({
        config: { replaceAfterMs: 120, maxFeeBumps: 2, feeBumpPercent: 25 },
      });
      await sender.start();
      const { id } = await sender.enqueue(h.bumpRequest("relayer", "stuck"));

      await waitUntil(
        async () => (await h.rows())[0]?.senderState?.attempts.length === 3,
        "two replacements",
      );
      // Bounded: several more timeouts pass and no further replacement is signed.
      await pause(600);
      const [pending] = await h.rows();
      const attempts = pending?.senderState?.attempts ?? [];
      expect(attempts).toHaveLength(3);
      expect(pending).toMatchObject({ status: "sent", nonce: 0n, attempts: 3 });
      expect(pending && rowInconsistency(pending)).toBeUndefined();
      // The row keeps the latest hash.
      expect(pending?.txHash).toBe(attempts[2]?.hash);
      expect(new Set(attempts.map((attempt) => attempt.hash)).size).toBe(3);
      expect(pending?.lastError).toMatch(/still pending after 2 fee bump/);

      // Same nonce, same call, same gas; fees up by at least 25 % each time, from the floor.
      const signed = attempts.map((attempt) => parseTransaction(attempt.raw));
      expect(signed.map((tx) => tx.nonce)).toEqual([0, 0, 0]);
      expect(
        new Set(signed.map((tx) => `${String(tx.to)}:${String(tx.data)}:${String(tx.gas)}`)).size,
      ).toBe(1);
      expect(signed[0]?.maxFeePerGas).toBe(FEE_FLOOR_WEI);
      for (let index = 1; index < signed.length; index += 1) {
        const previous = signed[index - 1];
        const current = signed[index];
        expect((current?.maxFeePerGas as bigint) * 100n).toBeGreaterThanOrEqual(
          (previous?.maxFeePerGas as bigint) * 125n,
        );
        expect((current?.maxPriorityFeePerGas as bigint) * 100n).toBeGreaterThanOrEqual(
          (previous?.maxPriorityFeePerGas as bigint) * 125n,
        );
      }
      // One nonce in the mempool, nothing mined yet.
      expect(
        await h.client.getTransactionCount({
          address: h.accounts.relayer.address,
          blockTag: "pending",
        }),
      ).toBe(1);
      expect(await h.minedCount(h.accounts.relayer.address)).toBe(0);

      await h.anvil.rpc("evm_mine", []);
      const outcome = await sender.waitFor(id, { timeoutMs: 10_000 });
      expect(outcome.status).toBe("mined");
      expect(attempts.map((attempt) => attempt.hash)).toContain(outcome.txHash);
      const [mined] = await h.rows();
      expect(mined?.txHash).toBe(outcome.txHash);
      // The call ran once, whatever the number of signatures.
      expect(await h.minedCount(h.accounts.relayer.address)).toBe(1);
      expect(await h.counter(h.escrow)).toBe(1n);
      expect(outcome.events).toHaveLength(1);
    });

    it("records the hash that was mined when an earlier attempt wins over its replacement", async () => {
      await h.anvil.rpc("evm_setAutomine", [false]);
      const seen: Hex[] = [];
      const sender = h.createSender({
        client: wrapClient(h.client, {
          // Only the first attempt reaches the node; replacements are lost on the way.
          sendRawTransaction: (request) => {
            seen.push(request.serializedTransaction);
            return new Set(seen).size === 1
              ? h.client.sendRawTransaction(request)
              : Promise.reject(transientError());
          },
        }),
        config: { replaceAfterMs: 100, maxFeeBumps: 1 },
      });
      await sender.start();
      const { id } = await sender.enqueue(h.bumpRequest("oracle", "first-wins"));
      await waitUntil(
        async () => (await h.rows())[0]?.senderState?.attempts.length === 2,
        "one replacement",
      );
      const [pending] = await h.rows();
      const [original, replacement] = pending?.senderState?.attempts ?? [];
      expect(pending?.txHash).toBe(replacement?.hash);

      await h.anvil.rpc("evm_mine", []);
      const outcome = await sender.waitFor(id, { timeoutMs: 10_000 });
      expect(outcome).toMatchObject({ status: "mined", txHash: original?.hash });
      const [mined] = await h.rows();
      expect(mined?.txHash).toBe(original?.hash);
      expect(mined && rowInconsistency(mined)).toBeUndefined();
      expect(await h.counter(h.escrow)).toBe(1n);
    });

    it("does not replace a transaction that is mined in time", async () => {
      const sender = h.createSender({ config: { replaceAfterMs: 5_000 } });
      await sender.start();
      await sender.sendAndWait(h.bumpRequest("relayer", "quick"));
      const [row] = await h.rows();
      expect(row?.senderState?.attempts).toHaveLength(1);
      expect(row?.attempts).toBe(1);
    });
  });

  describe("node errors", () => {
    it("retries the preparation with exponential backoff, then sends", async () => {
      let failuresLeft = 3;
      const sleeps: number[] = [];
      const clock: Clock = {
        now: () => new Date(),
        sleep: (ms, signal) => {
          sleeps.push(ms);
          return abortableSleep(ms, signal);
        },
      };
      const sender = new TxSender({
        db: h.db,
        client: wrapClient(h.client, {
          call: (request) => {
            if (failuresLeft > 0) {
              failuresLeft -= 1;
              return Promise.reject(transientError());
            }
            return h.client.call(request);
          },
        }),
        accounts: h.accounts,
        logger: h.logger,
        clock,
        config: {
          chainId: h.chainId,
          escrowAddress: h.escrow,
          receiptPollMs: 15,
          idlePollMs: 40,
          retryBaseMs: 11,
          retryMaxMs: 30,
          waitPollMs: 20,
        },
      });
      await sender.start();
      try {
        const outcome = await sender.sendAndWait(h.bumpRequest("relayer", "flaky-node"));
        expect(outcome.status).toBe("mined");
      } finally {
        await sender.stop();
      }

      // 11 ms, doubled, capped at 30 ms: the delays between the three failed tries.
      expect(sleeps.filter((ms) => ms === 11 || ms === 22 || ms === 30)).toEqual([11, 22, 30]);
      const [row] = await h.rows();
      // Three failed preparations and one signature.
      expect(row).toMatchObject({ status: "mined", nonce: 0n, attempts: 4, lastError: null });
      expect(await h.counter(h.escrow)).toBe(1n);
    });

    it("gives up on a transaction it cannot prepare, without using a nonce", async () => {
      let healthy = false;
      const sender = h.createSender({
        client: wrapClient(h.client, {
          estimateFeesPerGas: () =>
            healthy ? h.client.estimateFeesPerGas() : Promise.reject(transientError()),
        }),
        config: { maxPrepareAttempts: 3 },
      });
      await sender.start();

      const outcome = await sender.sendAndWait(h.bumpRequest("relayer", "node-down"));
      expect(outcome).toMatchObject({
        status: "failed",
        error: "NodeUnavailable: HttpRequestError: fetch failed",
      });
      const [failed] = await h.rows();
      expect(failed).toMatchObject({ status: "failed", nonce: null, txHash: null, attempts: 3 });
      expect(
        await h.client.getTransactionCount({
          address: h.accounts.relayer.address,
          blockTag: "pending",
        }),
      ).toBe(0);

      healthy = true;
      expect((await sender.sendAndWait(h.bumpRequest("relayer", "node-back"))).status).toBe(
        "mined",
      );
      const rows = await h.rows();
      expect(rows.filter((row) => row.nonce !== null).map((row) => row.nonce)).toEqual([0n]);
    });

    it("re-broadcasts the same bytes until the node takes them", async () => {
      const seen: Hex[] = [];
      const sender = h.createSender({
        client: wrapClient(h.client, {
          sendRawTransaction: (request) => {
            seen.push(request.serializedTransaction);
            return seen.length <= 3
              ? Promise.reject(transientError())
              : h.client.sendRawTransaction(request);
          },
        }),
      });
      await sender.start();
      const outcome = await sender.sendAndWait(h.bumpRequest("oracle", "lossy-broadcast"));

      expect(outcome.status).toBe("mined");
      expect(seen.length).toBe(4);
      // Always the stored transaction, never a new signature.
      expect(new Set(seen).size).toBe(1);
      const [row] = await h.rows();
      expect(row?.senderState?.attempts).toHaveLength(1);
      expect(row?.senderState?.attempts[0]?.raw).toBe(seen[0]);
      expect(await h.counter(h.escrow)).toBe(1n);
      expect(await h.minedCount(h.accounts.oracle.address)).toBe(1);
    });

    it("says on the row and in the error log when a signed transaction cannot be broadcast", async () => {
      let healthy = false;
      const sender = h.createSender({
        client: wrapClient(h.client, {
          sendRawTransaction: (request) =>
            healthy ? h.client.sendRawTransaction(request) : Promise.reject(transientError()),
        }),
      });
      await sender.start();
      const { id } = await sender.enqueue(h.bumpRequest("relayer", "no-broadcast"));
      await waitUntil(
        async () => ((await h.rows())[0]?.lastError ?? "").startsWith("broadcast refused 5 times"),
        "the alert on the row",
      );
      const [blocked] = await h.rows();
      expect(blocked).toMatchObject({ status: "sent", nonce: 0n });
      expect(blocked?.lastError).toBe("broadcast refused 5 times: HttpRequestError: fetch failed");
      expect(h.logLines.some((line) => line.includes("cannot be broadcast"))).toBe(true);
      // Still the one signature: the nonce is held, not burnt.
      expect(blocked?.senderState?.attempts).toHaveLength(1);

      healthy = true;
      const outcome = await sender.waitFor(id, { timeoutMs: 10_000 });
      expect(outcome).toMatchObject({ status: "mined", txHash: blocked?.txHash });
      expect(outcome.error).toBeUndefined();
      expect(await h.counter(h.escrow)).toBe(1n);
    });

    it("keeps looking for the receipt through node errors", async () => {
      let failuresLeft = 4;
      const sender = h.createSender({
        client: wrapClient(h.client, {
          getTransactionReceipt: (request) => {
            if (failuresLeft > 0) {
              failuresLeft -= 1;
              return Promise.reject(transientError());
            }
            return h.client.getTransactionReceipt(request);
          },
        }),
      });
      await sender.start();
      const outcome = await sender.sendAndWait(h.bumpRequest("relayer", "lossy-receipt"));
      expect(outcome.status).toBe("mined");
      expect(failuresLeft).toBe(0);
      expect(outcome.events).toHaveLength(1);
      expect(await h.counter(h.escrow)).toBe(1n);
    });

    it("records a mined transaction even when the block time cannot be read", async () => {
      const sender = h.createSender({
        client: wrapClient(h.client, { getBlock: () => Promise.reject(transientError()) }),
      });
      await sender.start();
      const before = Date.now();
      const outcome = await sender.sendAndWait(h.bumpRequest("relayer", "no-block-time"));
      expect(outcome.status).toBe("mined");
      const [row] = await h.rows();
      expect(row?.minedAt?.getTime()).toBeGreaterThanOrEqual(before - 1_000);
      const [event] = await h.db<
        { block_time: Date | null }[]
      >`select block_time from chain_events`;
      expect(event).toEqual({ block_time: null });
    });

    it("re-derives the nonce when storing a signed transaction hits the unique (signer, nonce) index", async () => {
      const sender = h.createSender();
      await sender.start();
      expect((await sender.sendAndWait(h.bumpRequest("relayer", "first"))).status).toBe("mined");

      // Another writer takes nonce 1, on the chain and in the table, behind the sender's back.
      const foreign = await sendDirect(h.client, h.accounts.relayer, h.chainId, {
        nonce: 1,
        to: h.bystander.address,
        gas: 21_000n,
      });
      await h.client.waitForTransactionReceipt({ hash: foreign, pollingInterval: 10 });
      await h.db`
        insert into chain_txs
          (idempotency_key, signer, kind, to_address, data, nonce, tx_hash, status, sent_at, block_number, mined_at)
        values
          ('other-writer', 'relayer', 'test.foreign', ${h.bystander.address.toLowerCase()}, '0x', 1,
           ${foreign}, 'mined', now(), 1, now())
      `;

      const outcome = await sender.sendAndWait(h.bumpRequest("relayer", "second"));
      expect(outcome.status).toBe("mined");
      // The write for nonce 1 was refused by the index, nothing was broadcast, and the nonce
      // was derived again from the chain and the table.
      expect(h.logLines.some((line) => line.includes("transaction worker failed"))).toBe(true);
      expect((await h.rows()).find((row) => row.id === outcome.id)?.nonce).toBe(2n);
      expect(await h.minedCount(h.accounts.relayer.address)).toBe(3);
      expect(await h.counter(h.escrow)).toBe(2n);
    });
  });

  describe("a key used outside the sender", () => {
    it("fails the transaction whose nonce another one took, and carries on with the next nonce", async () => {
      let hijacked = false;
      const sender = h.createSender({
        client: wrapClient(h.client, {
          sendRawTransaction: async (request) => {
            if (!hijacked) {
              hijacked = true;
              // Someone else uses the relayer key, with the nonce the sender just assigned.
              const hash = await sendDirect(h.client, h.accounts.relayer, h.chainId, {
                nonce: 0,
                to: h.bystander.address,
                gas: 21_000n,
              });
              await h.client.waitForTransactionReceipt({ hash, pollingInterval: 10 });
            }
            return h.client.sendRawTransaction(request);
          },
        }),
        config: { replaceAfterMs: 150 },
      });
      await sender.start();

      const outcome = await sender.sendAndWait(h.bumpRequest("relayer", "hijacked"));
      expect(outcome.status).toBe("failed");
      expect(outcome.error).toMatch(/^NonceConsumedElsewhere: nonce 0 /);
      expect(outcome.txHash).toBeUndefined();
      const [failed] = await h.rows();
      expect(failed).toMatchObject({ status: "failed", nonce: null, txHash: null });
      expect(failed && rowInconsistency(failed)).toBeUndefined();
      // Its call never ran.
      expect(await h.counter(h.escrow)).toBe(0n);

      const next = await sender.sendAndWait(h.bumpRequest("relayer", "after-hijack"));
      expect(next.status).toBe("mined");
      expect((await h.rows()).find((row) => row.id === next.id)?.nonce).toBe(1n);
      expect(await h.counter(h.escrow)).toBe(1n);
      expect(await h.minedCount(h.accounts.relayer.address)).toBe(2);
    });
  });

  describe("stored state", () => {
    it("does not sign again when a sent row lost its signed transaction, and blocks only that signer", async () => {
      const first = h.createSender();
      await first.start();
      const done = await first.sendAndWait(h.bumpRequest("relayer", "tampered"));
      await first.stop();
      // A `sent` row without the bytes that were signed for its nonce.
      await h.db`
        update chain_txs
        set status = 'sent', block_number = null, mined_at = null, payload = payload - ${SENDER_STATE_KEY}
        where id = ${done.id}
      `;

      const second = h.createSender();
      await second.start();
      const { id: blocked } = await second.enqueue(h.bumpRequest("relayer", "behind"));
      // The other signer is not affected.
      expect((await second.sendAndWait(h.bumpRequest("oracle", "free"))).status).toBe("mined");
      await waitUntil(
        () => h.logLines.some((line) => line.includes("stored state is unusable")),
        "the error log",
      );
      await pause(200);

      const rows = await h.rows();
      expect(rows.find((row) => row.id === done.id)?.status).toBe("sent");
      expect(rows.find((row) => row.id === blocked)?.status).toBe("queued");
      // Still exactly the one transaction of the relayer on-chain.
      expect(await h.minedCount(h.accounts.relayer.address)).toBe(1);
    });
  });
});
