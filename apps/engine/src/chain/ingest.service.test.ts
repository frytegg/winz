/**
 * The ingestion as a service: the poller's range halving and RPC failures, catch-up after a
 * stop, and a clean stop on abort. Each test gets its own local chain, escrow and database.
 */
import pino, { type Logger } from "pino";
import { describe, expect, it } from "vitest";
import { getAddress, type Address } from "viem";

import { parseUsd } from "@winz/shared";

import type { Db } from "../db";
import { startAnvil, type AnvilInstance } from "../testing/anvil";
import { deployTestEscrow, type TestEscrow } from "../testing/escrow";
import { createTestDatabase, type TestDatabase } from "../testing/postgres";
import { decodeEscrowLogs, insertChainEvents } from "./events";
import { startChainIngest } from "./ingest";
import {
  capturingLogger,
  EscrowDriver,
  exposureCheck,
  faultyLogClient,
  seedCampaign,
  seedInstrument,
  seedMerchant,
  TestNodeUnreachableError,
  TestRangeRefusedError,
  waitFor,
} from "./ingest-test-support";
import { defaultCursorName, isRangeRefusal, LogPoller, readCursor } from "./log-poller";
import { ChainProjector } from "./projector";

const SYMBOL = "GEMI-CFBTEXARK-2611290030-TEXAS-MONEYLINE-YES";
const USDC = 1_000_000n;
const BUYER: Address = getAddress("0x00000000000000000000000000000000000b0b01");

interface Setup {
  anvil: AnvilInstance;
  env: TestEscrow;
  database: TestDatabase;
  db: Db;
  driver: EscrowDriver;
}

async function withSetup(run: (setup: Setup) => Promise<void>): Promise<void> {
  const anvil = await startAnvil();
  let database: TestDatabase | undefined;
  try {
    const env = await deployTestEscrow(anvil);
    database = await createTestDatabase();
    await seedInstrument(database.db, SYMBOL);
    await run({ anvil, env, database, db: database.db, driver: new EscrowDriver(env) });
  } finally {
    await database?.drop();
    await anvil.stop();
  }
}

/** A campaign on-chain and its row, with the onchain_id already written. */
async function liveCampaign(setup: Setup, label: string): Promise<bigint> {
  const created = await setup.driver.createCampaign({
    merchant: setup.env.accounts.merchant.address,
    symbol: SYMBOL,
    unitPrice: parseUsd("10"),
    refundBps: 5_000,
    budget: 200n * USDC,
    salesCloseInSeconds: 86_400n,
  });
  await seedCampaign(setup.db, {
    merchantId: await seedMerchant(setup.db, label),
    symbol: SYMBOL,
    unitPrice: parseUsd("10"),
    refundBps: 5_000,
    budget: 200n * USDC,
    salesClose: new Date(Number(created.salesClose) * 1000),
    onchainId: created.id,
    slug: `${label}-texas`,
  });
  return created.id;
}

async function countRows(db: Db, sql: "tickets" | "unprocessed" | "events"): Promise<bigint> {
  const rows =
    sql === "tickets"
      ? await db<{ n: bigint }[]>`select count(*) as n from tickets`
      : sql === "unprocessed"
        ? await db<
            { n: bigint }[]
          >`select count(*) as n from chain_events where processed_at is null`
        : await db<{ n: bigint }[]>`select count(*) as n from chain_events`;
  return rows[0]?.n ?? 0n;
}

function silent(): Logger {
  return pino({ level: "silent" });
}

describe("isRangeRefusal", () => {
  it.each([
    "query exceeds max block range 2000",
    "eth_getLogs block range is too large",
    "Log response size exceeded. You can make eth_getLogs requests with up to a 2K block range",
    "query returned more than 10000 results",
    "too many logs in response",
  ])("treats '%s' as a range refusal", (message) => {
    expect(isRangeRefusal(new Error(message))).toBe(true);
  });

  it("reads EIP-1474's limit-exceeded code by its message: a bare -32005 is a rate limit", () => {
    // Before the first rehearsal any -32005 halved the range. Arc's public RPC answers its rate
    // limit with -32005, so a bare -32005 is now read as a rate limit (see classifyRpcRefusal).
    const inner = Object.assign(new Error("limit"), { code: -32005 });
    expect(isRangeRefusal(new Error("RPC request failed", { cause: inner }))).toBe(false);
    const sized = Object.assign(new Error("query returned more than 10000 results"), {
      code: -32005,
    });
    expect(isRangeRefusal(new Error("RPC request failed", { cause: sized }))).toBe(true);
    expect(isRangeRefusal(new TestRangeRefusedError(5n))).toBe(true);
  });

  it("does not treat an unreachable node or a timeout as a range refusal", () => {
    expect(isRangeRefusal(new TestNodeUnreachableError())).toBe(false);
    expect(isRangeRefusal(new Error("The request took too long to respond."))).toBe(false);
    expect(isRangeRefusal(undefined)).toBe(false);
  });
});

describe("LogPoller", () => {
  it("halves the range while the node refuses it, and still reads every log once", async () => {
    await withSetup(async (setup) => {
      const { env, db, driver, anvil } = setup;
      const campaign = await liveCampaign(setup, "halving");
      for (let index = 0; index < 4; index += 1) {
        await anvil.rpc("anvil_mine", ["0x9"]);
        await driver.buy(campaign, BUYER, index + 1, USDC);
      }
      const client = faultyLogClient(env.publicClient);
      client.maxRange = 5n;
      const poller = new LogPoller(
        db,
        client,
        { escrowAddress: env.escrow, fromBlock: env.deployedAtBlock, maxBlockRange: 64n },
        silent(),
      );
      const result = await poller.pollOnce();
      const head = await env.publicClient.getBlockNumber({ cacheTime: 0 });

      // 64 → 32 → 16 → 8 → 4: four refusals, then every request fits the node's limit.
      expect(client.refusals).toBe(4);
      expect(poller.currentRange).toBe(4n);
      expect(client.ranges.every((width) => width <= 5n)).toBe(true);
      expect(result.toBlock).toBe(head);
      expect(await readCursor(db, defaultCursorName(env.escrow))).toBe(head);

      const direct = await env.publicClient.getLogs({
        address: env.escrow,
        fromBlock: env.deployedAtBlock,
        toBlock: head,
      });
      expect(result.events).toBe(direct.length);
      expect(await countRows(db, "events")).toBe(BigInt(direct.length));
      const purchases = await db<{ n: bigint }[]>`
        select count(*) as n from chain_events where name = 'TicketPurchased' and source = 'logs'
      `;
      expect(purchases[0]?.n).toBe(4n);

      // Read again: nothing new, nothing duplicated.
      expect((await poller.pollOnce()).toBlock).toBeNull();
      expect(await countRows(db, "events")).toBe(BigInt(direct.length));
    });
  });

  it("throws when even one block is refused, leaving the cursor where it was", async () => {
    await withSetup(async ({ env, db }) => {
      const client = faultyLogClient(env.publicClient);
      client.maxRange = 0n;
      const poller = new LogPoller(
        db,
        client,
        { escrowAddress: env.escrow, fromBlock: env.deployedAtBlock, maxBlockRange: 4n },
        silent(),
      );
      await expect(poller.pollOnce()).rejects.toBeInstanceOf(TestRangeRefusedError);
      expect(poller.currentRange).toBe(1n);
      expect(await readCursor(db, poller.cursorName)).toBeNull();
    });
  });

  it("stays the confirmation depth behind the head", async () => {
    await withSetup(async ({ env, db, anvil }) => {
      await anvil.rpc("anvil_mine", ["0x5"]);
      const poller = new LogPoller(
        db,
        env.publicClient,
        { escrowAddress: env.escrow, fromBlock: env.deployedAtBlock, confirmations: 3n },
        silent(),
      );
      await poller.pollOnce();
      const head = await env.publicClient.getBlockNumber({ cacheTime: 0 });
      expect(await readCursor(db, poller.cursorName)).toBe(head - 3n);
    });
  });
});

describe("startChainIngest", () => {
  it("catches up after a stop of five minutes", async () => {
    await withSetup(async (setup) => {
      const { env, db, driver } = setup;
      const campaign = await liveCampaign(setup, "restart");
      const start = (signal: AbortSignal): Promise<void> =>
        startChainIngest({
          db,
          publicClient: env.publicClient,
          escrowAddress: env.escrow,
          fromBlock: env.deployedAtBlock,
          logger: silent(),
          signal,
          pollIntervalMs: 100,
          projectIntervalMs: 50,
        }).stopped;

      const first = new AbortController();
      const firstRun = start(first.signal);
      await driver.buy(campaign, BUYER, 2, USDC);
      await waitFor(async () => (await countRows(db, "tickets")) === 1n, "the first ticket");
      first.abort();
      await firstRun;

      // Stopped: three purchases, a top-up, and five minutes go by.
      for (let qty = 1; qty <= 3; qty += 1) await driver.buy(campaign, BUYER, qty, USDC);
      await driver.topUp(campaign, 25n * USDC);
      await env.advanceTime(300);
      expect(await countRows(db, "tickets")).toBe(1n);

      const second = new AbortController();
      const secondRun = start(second.signal);
      const head = await env.publicClient.getBlockNumber({ cacheTime: 0 });
      await waitFor(
        async () =>
          (await countRows(db, "tickets")) === 4n &&
          (await countRows(db, "unprocessed")) === 0n &&
          ((await readCursor(db, defaultCursorName(env.escrow))) ?? 0n) >= head,
        "the catch-up",
      );
      second.abort();
      await secondRun;

      const onchain = await driver.getCampaign(campaign);
      const [row] = await db<{ budget: bigint }[]>`
        select budget from campaigns where onchain_id = ${campaign.toString()}::bigint
      `;
      expect(row?.budget).toBe(onchain.hedgeBudget);
      for (const check of await exposureCheck(db)) expect(check.exposure).toBe(check.refundable);
      const [position] = await db<{ exposure: bigint }[]>`
        select exposure from positions where instrument = ${SYMBOL}
      `;
      expect(position?.exposure).toBe(onchain.lockedRefunds);
    });
  });

  it("survives an unreachable node and recovers once it answers again", async () => {
    await withSetup(async (setup) => {
      const { env, db, driver } = setup;
      const campaign = await liveCampaign(setup, "outage");
      const client = faultyLogClient(env.publicClient);
      client.failing = true;
      const { logger, entries } = capturingLogger();
      const controller = new AbortController();
      const ingest = startChainIngest({
        db,
        publicClient: client,
        escrowAddress: env.escrow,
        fromBlock: env.deployedAtBlock,
        logger,
        signal: controller.signal,
        pollIntervalMs: 50,
        projectIntervalMs: 50,
        retryBaseMs: 10,
        retryMaxMs: 40,
      });
      try {
        await driver.buy(campaign, BUYER, 3, USDC);
        await waitFor(async () => Promise.resolve(client.failures >= 4), "several failures");
        expect(await countRows(db, "events")).toBe(0n);
        expect(
          entries.some(
            (entry) => entry.msg === "chain ingest step failed, retrying" && entry.loop === "logs",
          ),
        ).toBe(true);

        client.failing = false;
        await waitFor(async () => (await countRows(db, "tickets")) === 1n, "the ticket");
        await waitFor(
          async () =>
            Promise.resolve(
              entries.some(
                (entry) => entry.msg === "chain ingest loop recovered" && entry.loop === "logs",
              ),
            ),
          "the recovery log",
        );
      } finally {
        controller.abort();
        await ingest.stopped;
      }
    });
  });

  it("stops on abort with nothing left running", async () => {
    await withSetup(async ({ env, db }) => {
      const client = faultyLogClient(env.publicClient);
      const controller = new AbortController();
      const ingest = startChainIngest({
        db,
        publicClient: client,
        escrowAddress: env.escrow,
        fromBlock: env.deployedAtBlock,
        logger: silent(),
        signal: controller.signal,
        pollIntervalMs: 20,
        projectIntervalMs: 20,
      });
      await waitFor(async () => Promise.resolve(client.calls >= 3), "a few polls");
      controller.abort();
      const stoppedWithin = await Promise.race([
        ingest.stopped.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2_000)),
      ]);
      expect(stoppedWithin).toBe(true);
      const calls = client.calls;
      await new Promise<void>((resolve) => setTimeout(resolve, 300));
      expect(client.calls).toBe(calls);

      // Aborted before it starts: it never calls the node and resolves at once.
      const idle = faultyLogClient(env.publicClient);
      const aborted = new AbortController();
      aborted.abort();
      await startChainIngest({
        db,
        publicClient: idle,
        escrowAddress: env.escrow,
        fromBlock: env.deployedAtBlock,
        logger: silent(),
        signal: aborted.signal,
      }).stopped;
      expect(idle.calls).toBe(0);
    });
  });

  it("projects receipt events at once, without waiting for the next poll", async () => {
    await withSetup(async (setup) => {
      const { env, db, driver } = setup;
      const campaign = await liveCampaign(setup, "fast-path");
      const controller = new AbortController();
      const projector = new ChainProjector(db, silent());
      const ingest = startChainIngest({
        db,
        publicClient: env.publicClient,
        escrowAddress: env.escrow,
        fromBlock: env.deployedAtBlock,
        logger: silent(),
        signal: controller.signal,
        // The poller would not run again during this test.
        pollIntervalMs: 60_000,
        projectIntervalMs: 50,
      });
      try {
        await waitFor(
          async () =>
            (await countRows(db, "unprocessed")) === 0n && (await countRows(db, "events")) > 0n,
          "the first poll",
        );
        const bought = await driver.buy(campaign, BUYER, 2, USDC);
        await insertChainEvents(
          db,
          decodeEscrowLogs(bought.receipt.logs, env.escrow).events,
          bought.blockTime,
        );
        await waitFor(async () => (await countRows(db, "tickets")) === 1n, "the ticket", 3_000);
        expect((await projector.runPass()).applied).toBe(0);
      } finally {
        controller.abort();
        await ingest.stopped;
      }
    });
  });
});
