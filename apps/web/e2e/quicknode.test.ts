import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Hex } from "viem";

import { POST as postQuicknode } from "@/app/api/webhooks/quicknode/route";
import {
  TEST_STREAMS_TOKEN,
  deliveryOf,
  rpcLogOf,
  signedRequest,
} from "@/lib/server/testing/quicknode-deliveries";

import { startAnvil, type AnvilInstance } from "../../engine/src/testing/anvil";
import {
  buy,
  customerEmail,
  launchCampaign,
  signUpMerchant,
  waitTicketed,
  type LiveCampaign,
  type Purchase,
} from "./support/flows";
import { QUIET_BOOK } from "./support/steps";
import { createWorld, type World } from "./support/world";

/**
 * SPEC HE-1, the three sources of one event, on a local chain with the real WinzEscrow, the
 * engine as one process and the web app's route: a purchase's `TicketPurchased` reaches
 * `chain_events` through the QuickNode webhook (a delivery built from the chain's real logs, in
 * the documented shape, signed with a test token), through the engine's receipt path and through
 * its `eth_getLogs` poller, in either order; it is stored once and applied once (one ticket, one
 * lot, the instrument's exposure raised once).
 *
 * To deliver before the engine has read anything, the chain stops mining (`evm_setAutomine`
 * false), the engine broadcasts its `buyFor` and is stopped, the block is mined, the webhook
 * stores the events, and only then does the engine start again: its receipt path and its poller
 * meet events already stored.
 */

process.env.APP_LOG_LEVEL ??= "warn";

const SCENARIO_TIMEOUT_MS = 120_000;

let anvil: AnvilInstance;
let world: World | undefined;

beforeAll(async () => {
  anvil = await startAnvil();
  process.env.QUICKNODE_STREAMS_TOKEN = TEST_STREAMS_TOKEN;
});
afterAll(async () => {
  delete process.env.QUICKNODE_STREAMS_TOKEN;
  await anvil?.stop();
});
afterEach(async () => {
  // Mining back on, whatever the scenario left.
  await anvil?.rpc("evm_setAutomine", [true]);
  await world?.close();
  world = undefined;
});

interface EventRow {
  tx_hash: string;
  log_index: number;
  block_number: bigint;
  block_time: Date | null;
  name: string;
  args: unknown;
  source: string;
  processed_at: Date | null;
}

async function eventRows(w: World, txHashes: readonly string[]): Promise<EventRow[]> {
  return w.db<EventRow[]>`
    select tx_hash, log_index, block_number, block_time, name, args, source, processed_at
    from chain_events where tx_hash in ${w.db(txHashes as string[])}
    order by block_number, log_index
  `;
}

/** The webhook's delivery of these blocks: every log of each block, as `eth_getLogs` gives them. */
async function deliver(w: World, blocks: readonly bigint[]): Promise<number> {
  const logs = [];
  for (const blockNumber of blocks) {
    const block = await w.escrow.publicClient.getBlock({ blockNumber });
    const all = await w.escrow.publicClient.getLogs({
      fromBlock: blockNumber,
      toBlock: blockNumber,
    });
    // The block holds the escrow's logs and the test token's transfers: the route keeps the first.
    expect(new Set(all.map((log) => log.address.toLowerCase())).size).toBeGreaterThan(1);
    logs.push(all.map((log) => rpcLogOf(log, block.timestamp)));
  }
  const response = await postQuicknode(signedRequest(deliveryOf(logs), { at: w.clock.date() }), {
    params: Promise.resolve({}),
  });
  return response.status;
}

/** The relayer's `buyFor` of a purchase, once it is broadcast (status `sent`). */
async function sentBuy(w: World, purchase: Purchase): Promise<{ hash: Hex; raw: Hex }> {
  let found: { hash: Hex; raw: Hex } | null = null;
  await w.waitFor(`the buyFor of ${purchase.pi} broadcast`, async () => {
    const [row] = await w.db<{ tx_hash: string | null; status: string; payload: unknown }[]>`
      select tx_hash, status, payload from chain_txs
      where kind = 'buyFor' and payload ->> 'paymentIntentId' = ${purchase.pi}
      order by created_at desc limit 1
    `;
    if (row?.status !== "sent" || row.tx_hash === null) return { ok: false, seen: row };
    const attempts = (row.payload as { _txSender: { attempts: { raw: Hex }[] } })._txSender
      .attempts;
    const raw = attempts[attempts.length - 1]?.raw;
    if (raw === undefined) return { ok: false, seen: row };
    found = { hash: row.tx_hash as Hex, raw };
    return true;
  });
  const result = found as { hash: Hex; raw: Hex } | null;
  if (result === null) throw new Error("unreachable: no buyFor");
  return result;
}

async function receiptBlock(w: World, hash: Hex): Promise<bigint> {
  const receipt = await w.escrow.publicClient.getTransactionReceipt({ hash });
  expect(receipt.status).toBe("success");
  return receipt.blockNumber;
}

/** The engine has met the event through both of its own sources, and projected every row. */
async function waitEngineCaughtUp(w: World, hashes: readonly Hex[], block: bigint): Promise<void> {
  await w.waitFor("the receipt path, the poller and the projector past the purchases", async () => {
    const txs = await w.db<{ status: string }[]>`
      select status from chain_txs where tx_hash in ${w.db(hashes as Hex[])}
    `;
    const [cursor] = await w.db<{ block_number: bigint }[]>`
      select block_number from chain_cursor where name = ${`escrow-logs:${w.escrow.escrow.toLowerCase()}`}
    `;
    const [pending] = await w.db<{ n: bigint }[]>`
      select count(*)::bigint as n from chain_events where processed_at is null
    `;
    const seen = { txs, cursor: cursor?.block_number, unprocessed: pending?.n };
    return {
      ok:
        txs.length === hashes.length &&
        txs.every((tx) => tx.status === "mined") &&
        cursor !== undefined &&
        cursor.block_number >= block &&
        pending?.n === 0n,
      seen,
    };
  });
}

/** Tickets, lots and the exposure of the campaigns' instrument: the projection, applied once. */
async function expectAppliedOnce(
  w: World,
  campaigns: readonly LiveCampaign[],
  hashes: readonly Hex[],
): Promise<void> {
  const tickets = await w.db<{ id: string; refundable: bigint; tx_hash: string }[]>`
    select id, refundable, tx_hash from tickets where tx_hash in ${w.db(hashes as Hex[])}
  `;
  expect(tickets).toHaveLength(hashes.length);
  const lots = await w.db<{ ticket_id: string; qty: bigint }[]>`
    select ticket_id, qty from lots where ticket_id in ${w.db(tickets.map((ticket) => ticket.id))}
  `;
  expect(lots).toHaveLength(tickets.length);
  for (const ticket of tickets) {
    expect(lots.filter((lot) => lot.ticket_id === ticket.id).map((lot) => lot.qty)).toEqual([
      ticket.refundable,
    ]);
  }
  for (const symbol of new Set(campaigns.map((campaign) => campaign.symbol))) {
    const [position] = await w.db<{ exposure: bigint }[]>`
      select exposure from positions where instrument = ${symbol}
    `;
    const [sum] = await w.db<{ total: bigint }[]>`
      select coalesce(sum(t.refundable), 0)::bigint as total
      from tickets t join campaigns c on c.id = t.campaign_id
      where c.instrument = ${symbol}
    `;
    // HE-1: the exposure is the refundable amount of the instrument's tickets, each counted once.
    expect(position?.exposure).toBe(sum?.total);
  }
}

async function liveCampaign(w: World, symbol: string, name: string): Promise<LiveCampaign> {
  w.gemini.setBook(symbol, QUIET_BOOK);
  const merchant = await signUpMerchant(w, name, "pizza");
  return launchCampaign(w, merchant, symbol);
}

describe("one event, three sources, one row (HE-1)", () => {
  it(
    "the webhook first: the engine's receipt and poller meet it stored, it is applied once",
    { timeout: SCENARIO_TIMEOUT_MS },
    async () => {
      const w = await createWorld(anvil);
      world = w;
      const campaign = await liveCampaign(w, w.game.away.symbol, "Joe's Pizza");

      await anvil.rpc("evm_setAutomine", [false]);
      const purchase = await buy(w, campaign.slug, 2, customerEmail("ann"));
      const { hash } = await sentBuy(w, purchase);
      await w.stopEngine();
      await anvil.rpc("evm_mine");
      await anvil.rpc("evm_setAutomine", [true]);
      const block = await receiptBlock(w, hash);

      // QuickNode delivers the block while no engine is running.
      expect(await deliver(w, [block])).toBe(200);
      const delivered = await eventRows(w, [hash]);
      expect(delivered.map((row) => row.name)).toContain("TicketPurchased");
      expect(delivered.every((row) => row.source === "streams" && row.processed_at === null)).toBe(
        true,
      );
      const chainBlock = await w.escrow.publicClient.getBlock({ blockNumber: block });
      expect(delivered[0]?.block_time).toEqual(new Date(Number(chainBlock.timestamp) * 1000));
      const [before] = await w.db<{ n: bigint }[]>`
        select count(*)::bigint as n from tickets where tx_hash = ${hash}
      `;
      expect(before?.n).toBe(0n);

      // The engine starts: its receipt path finalizes the buyFor, its poller reads the block.
      await w.startEngine();
      await waitTicketed(w, purchase.pi);
      await waitEngineCaughtUp(w, [hash], block);
      const after = await eventRows(w, [hash]);
      expect(after.map(({ processed_at: _p, ...row }) => row)).toEqual(
        delivered.map(({ processed_at: _p, ...row }) => row),
      );
      expect(after.every((row) => row.processed_at !== null)).toBe(true);
      await expectAppliedOnce(w, [campaign], [hash]);
    },
  );

  it(
    "the engine first: the webhook's delivery afterwards changes nothing",
    { timeout: SCENARIO_TIMEOUT_MS },
    async () => {
      const w = await createWorld(anvil);
      world = w;
      const campaign = await liveCampaign(w, w.game.away.symbol, "Joe's Pizza");
      const purchase = await buy(w, campaign.slug, 1, customerEmail("bob"));
      await waitTicketed(w, purchase.pi);
      const [row] = await w.db<{ tx_hash: Hex }[]>`
        select tx_hash from tickets order by purchased_at desc limit 1
      `;
      const hash = row?.tx_hash;
      if (hash === undefined) throw new Error("no ticket");
      const block = await receiptBlock(w, hash);
      await waitEngineCaughtUp(w, [hash], block);
      const stored = await eventRows(w, [hash]);
      expect(stored.map((event) => event.source)).not.toContain("streams");
      const lotsBefore = await w.db`select * from lots order by seq`;
      const positionsBefore =
        await w.db`select instrument, exposure from positions order by instrument`;

      // Delivered twice, as QuickNode may.
      expect(await deliver(w, [block])).toBe(200);
      expect(await deliver(w, [block])).toBe(200);
      expect(await eventRows(w, [hash])).toEqual(stored);
      expect(await w.db`select * from lots order by seq`).toEqual(lotsBefore);
      expect(await w.db`select instrument, exposure from positions order by instrument`).toEqual(
        positionsBefore,
      );
      await expectAppliedOnce(w, [campaign], [hash]);
    },
  );

  it(
    "one delivery carrying the purchases of two campaigns in two blocks, stored and applied once each",
    { timeout: SCENARIO_TIMEOUT_MS },
    async () => {
      const w = await createWorld(anvil);
      world = w;
      const first = await liveCampaign(w, w.game.away.symbol, "Joe's Pizza");
      const second = await liveCampaign(w, w.game.home.symbol, "Ann's Bar");

      await anvil.rpc("evm_setAutomine", [false]);
      const a = await buy(w, first.slug, 1, customerEmail("cat"));
      const sentA = await sentBuy(w, a);
      const b = await buy(w, second.slug, 3, customerEmail("dan"));
      const sentB = await sentBuy(w, b);
      await w.stopEngine();
      // Two blocks: B is taken out of the pool, A is mined alone, then B is sent again (the same
      // signed bytes) and mined in the next block.
      await anvil.rpc("anvil_dropTransaction", [sentB.hash]);
      await anvil.rpc("evm_mine");
      await anvil.rpc("eth_sendRawTransaction", [sentB.raw]);
      await anvil.rpc("evm_mine");
      await anvil.rpc("evm_setAutomine", [true]);
      const blockA = await receiptBlock(w, sentA.hash);
      const blockB = await receiptBlock(w, sentB.hash);
      expect(blockB).toBe(blockA + 1n);

      expect(await deliver(w, [blockA, blockB])).toBe(200);
      const delivered = await eventRows(w, [sentA.hash, sentB.hash]);
      const purchases = delivered.filter((row) => row.name === "TicketPurchased");
      expect(purchases.map((row) => [row.tx_hash, row.block_number])).toEqual([
        [sentA.hash, blockA],
        [sentB.hash, blockB],
      ]);
      expect(purchases.map((row) => (row.args as { id: string }).id)).toEqual([
        first.onchainId.toString(),
        second.onchainId.toString(),
      ]);
      expect(delivered.every((row) => row.source === "streams")).toBe(true);
      // Delivered again: nothing new.
      expect(await deliver(w, [blockA, blockB])).toBe(200);
      expect(await eventRows(w, [sentA.hash, sentB.hash])).toEqual(delivered);

      await w.startEngine();
      await waitTicketed(w, a.pi);
      await waitTicketed(w, b.pi);
      await waitEngineCaughtUp(w, [sentA.hash, sentB.hash], blockB);
      const after = await eventRows(w, [sentA.hash, sentB.hash]);
      expect(after.map(({ processed_at: _p, ...row }) => row)).toEqual(
        delivered.map(({ processed_at: _p, ...row }) => row),
      );
      await expectAppliedOnce(w, [first, second], [sentA.hash, sentB.hash]);
    },
  );
});
