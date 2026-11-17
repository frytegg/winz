/**
 * Test harness of the hedging service: a real Postgres with every migration, a real local chain
 * with the real escrow, the real transaction sender and the real chain projection, the paper
 * venue, and a hand-driven book source with the book feed's `subscribe` / `getBook` shape.
 * Campaigns and purchases are made on-chain, so lots and exposure come from the projection.
 * Test code only.
 */
import { randomBytes } from "node:crypto";

import type { Logger } from "pino";
import { getAddress, type Address } from "viem";

import {
  instrumentId,
  winzEscrowAbi,
  type Book,
  type Bps,
  type MicroContracts,
} from "@winz/shared";

import { startChainIngest, TxSender, type TxRequest } from "../../chain";
import {
  EscrowDriver,
  capturingLogger,
  seedMerchant,
  waitFor,
  type LogEntry,
} from "../../chain/ingest-test-support";
import { TEST_SENDER_CONFIG } from "../../chain/test-support";
import type { Db } from "../../db";
import type { BookFeedEvent } from "../../market-data/book-feed";
import type { AnvilInstance } from "../../testing/anvil";
import { deployTestEscrow, type TestEscrow } from "../../testing/escrow";
import { createTestDatabase, type TestDatabase } from "../../testing/postgres";
import type { TradePrint } from "../../venues";
import { startHedging, type Hedging, type StartHedgingOptions } from "./index";
import type { ChargeTxSender } from "./charger";
import type { HedgeBookSource } from "./service";

export { waitFor } from "../../chain/ingest-test-support";

/** One contract, in micro-contracts. */
export const CONTRACT = 1_000_000n;
/** One USDC, in micro-USDC. */
export const USDC = 1_000_000n;

/** Wall clock shifted by an offset the test moves forward. */
export class OffsetClock {
  private offsetMs = 0;

  now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }

  nowMs(): number {
    return this.now().getTime();
  }

  advance(ms: number): void {
    this.offsetMs += ms;
  }
}

/** A book source driven by the test: the book feed's `subscribe` and `getBook`, nothing else. */
export class HandBookSource implements HedgeBookSource {
  private readonly listeners = new Set<(event: BookFeedEvent) => void>();
  private readonly books = new Map<string, Book>();

  constructor(private readonly clock: OffsetClock) {}

  subscribe(listener: (event: BookFeedEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getBook(symbol: string): Book | null {
    return this.books.get(symbol) ?? null;
  }

  listenerCount(): number {
    return this.listeners.size;
  }

  /** A book with one level a side, observed now by the clock. */
  push(
    symbol: string,
    bidBps: Bps | null,
    askBps: Bps | null,
    depth: MicroContracts = 1_000n * CONTRACT,
  ): Book {
    const book: Book = {
      instrumentSymbol: symbol,
      bids: bidBps === null ? [] : [{ priceBps: bidBps, qty: depth }],
      asks: askBps === null ? [] : [{ priceBps: askBps, qty: depth }],
      observedAtMs: this.clock.nowMs(),
    };
    this.books.set(symbol, book);
    for (const listener of this.listeners) listener({ kind: "book", book, source: "ws" });
    return book;
  }

  /** The held book of `symbol` again, observed now (a feed that keeps delivering). */
  refresh(symbol: string): void {
    const book = this.books.get(symbol);
    if (book === undefined) return;
    const fresh: Book = { ...book, observedAtMs: this.clock.nowMs() };
    this.books.set(symbol, fresh);
    for (const listener of this.listeners) listener({ kind: "book", book: fresh, source: "ws" });
  }

  trade(symbol: string, priceBps: Bps, qty: MicroContracts): void {
    const trade: TradePrint = { instrumentSymbol: symbol, priceBps, qty, atMs: this.clock.nowMs() };
    for (const listener of this.listeners) listener({ kind: "trade", trade });
  }
}

export interface Market {
  symbol: string;
  eventTicker: string;
}

export interface Campaign {
  id: string;
  onchainId: bigint;
  instrument: string;
  merchant: Address;
}

export interface RunningService {
  hedging: Hedging;
  controller: AbortController;
  /** Aborts and waits until everything has stopped. */
  stop: () => Promise<void>;
}

export interface HedgeHarness {
  env: TestEscrow;
  database: TestDatabase;
  db: Db;
  driver: EscrowDriver;
  logger: Logger;
  logs: LogEntry[];
  clock: OffsetClock;
  books: HandBookSource;
  /** The sender currently running (replaced by `restartSender`). */
  sender: () => TxSender;
  /** Stops the running sender and starts a new one on the same database and chain. */
  restartSender: () => Promise<TxSender>;
  stopSender: () => Promise<void>;
  createMarket: (options?: { startsInMs?: number }) => Promise<Market>;
  openCampaign: (
    market: Market,
    options?: {
      unitPrice?: bigint;
      refundBps?: number;
      merchant?: Address;
      budget?: bigint;
      salesCloseInSeconds?: bigint;
    },
  ) => Promise<Campaign>;
  /** One purchase on-chain; resolves once the projection has created its lot. */
  sell: (campaign: Campaign, maxHedgeCost: bigint, qty?: number) => Promise<bigint>;
  /** Starts a hedging service on this harness. Several can run one after the other. */
  startService: (options?: Partial<StartHedgingOptions>) => RunningService;
  /** Every `HedgeCharged` the escrow emitted, read from the chain. */
  hedgeChargedLogs: () => Promise<{ ticketId: bigint; campaignId: bigint; amount: bigint }[]>;
  /** Sends a transaction through the running sender and waits for it. */
  send: (request: Omit<TxRequest, "idempotencyKey">, key: string) => Promise<string>;
  close: () => Promise<void>;
}

const BUYER: Address = getAddress("0x00000000000000000000000000000000000b0b07");

/** Fast timings for tests. */
export const TEST_SERVICE_TIMINGS = {
  exposureIntervalMs: 100,
  tickIntervalMs: 100,
  chargeIntervalMs: 200,
  deskMinIntervalMs: 200,
  reconcileTimeoutMs: 10_000,
  finalizeTimeoutMs: 20_000,
} satisfies Partial<StartHedgingOptions>;

function hex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

/**
 * A fresh escrow on `anvil`, a fresh database, a running sender and a running projection.
 * `ingest: false` leaves the projection to the test (`projectOnce` style tests).
 */
export async function createHedgeHarness(
  anvil: AnvilInstance,
  options: { ingest?: boolean; startSender?: boolean } = {},
): Promise<HedgeHarness> {
  const env = await deployTestEscrow(anvil);
  const database = await createTestDatabase();
  const db = database.db;
  const { logger, entries } = capturingLogger();
  const driver = new EscrowDriver(env);
  const clock = new OffsetClock();
  const books = new HandBookSource(clock);
  const ingestController = new AbortController();
  const services: RunningService[] = [];

  const newSender = (): TxSender =>
    new TxSender({
      db,
      client: env.publicClient,
      accounts: { relayer: env.accounts.relayer, oracle: env.accounts.oracle },
      logger,
      config: { chainId: env.chainId, escrowAddress: env.escrow, ...TEST_SENDER_CONFIG },
    });
  let sender = newSender();
  if (options.startSender !== false) await sender.start();

  const ingest =
    options.ingest === false
      ? null
      : startChainIngest({
          db,
          publicClient: env.publicClient,
          escrowAddress: env.escrow,
          fromBlock: env.deployedAtBlock,
          logger,
          signal: ingestController.signal,
          pollIntervalMs: 150,
          projectIntervalMs: 50,
        });

  const createMarket = async (marketOptions: { startsInMs?: number } = {}): Promise<Market> => {
    const suffix = hex(4).toUpperCase();
    const eventTicker = `HEDGE-${suffix}`;
    const symbol = `GEMI-HEDGE${suffix}-2611290030-HOME-MONEYLINE-YES`;
    const startsAt = new Date(clock.nowMs() + (marketOptions.startsInMs ?? 2 * 86_400_000));
    const closesAt = new Date(startsAt.getTime() - 5 * 60_000);
    await db`
      insert into events (ticker, title, sport, league, home_name, home_abbreviation,
                          away_name, away_abbreviation, starts_at, sales_close_at)
      values (${eventTicker}, 'Texas vs Arkansas', 'football', 'NCAAF', 'Texas', 'TEX',
              'Arkansas', 'ARK', ${startsAt}, ${closesAt})
    `;
    await db`
      insert into instruments (symbol, event_ticker, label, type, onchain_id)
      values (${symbol}, ${eventTicker}, 'Texas wins', 'moneyline', ${instrumentId(symbol)})
    `;
    return { symbol, eventTicker };
  };

  const openCampaign: HedgeHarness["openCampaign"] = async (market, campaignOptions = {}) => {
    const merchant = campaignOptions.merchant ?? env.accounts.merchant.address;
    const unitPrice = campaignOptions.unitPrice ?? 5n * USDC;
    const refundBps = campaignOptions.refundBps ?? 10_000;
    const budget = campaignOptions.budget ?? 100n * USDC;
    const salesCloseInSeconds = campaignOptions.salesCloseInSeconds ?? 86_400n;
    const created = await driver.createCampaign({
      merchant,
      symbol: market.symbol,
      unitPrice,
      refundBps,
      budget,
      salesCloseInSeconds,
    });
    const merchantId = await seedMerchant(db, `m${hex(5)}`);
    const salesClose = new Date(clock.nowMs() + Number(salesCloseInSeconds) * 1000);
    const [row] = await db<{ id: string }[]>`
      insert into campaigns (merchant_id, instrument, event_ticker, product, condition_label,
                             promise, unit_price, refund_bps, usual_margin_bps, min_margin_bps,
                             pause_threshold_bps, budget, sales_close, status, onchain_id)
      values (${merchantId}, ${market.symbol}, ${market.eventTicker}, 'Beer', 'Texas wins',
              'Refunded if Texas wins', ${unitPrice.toString()}::bigint, ${refundBps}, 7000, 3000,
              9000, ${budget.toString()}::bigint, ${salesClose}, 'funding',
              ${created.id.toString()}::bigint)
      returning id
    `;
    if (row === undefined) throw new Error("campaign not inserted");
    return { id: row.id, onchainId: created.id, instrument: market.symbol, merchant };
  };

  const sell: HedgeHarness["sell"] = async (campaign, maxHedgeCost, qty = 1) => {
    const { ticketId } = await driver.buy(campaign.onchainId, BUYER, qty, maxHedgeCost);
    if (ingest !== null) {
      await waitFor(async () => {
        const rows = await db`
          select 1 from lots l join tickets t on t.id = l.ticket_id
          where t.onchain_id = ${ticketId.toString()}::bigint
        `;
        return rows.length === 1;
      }, `the lot of ticket ${ticketId.toString()}`);
    }
    return ticketId;
  };

  const startService = (serviceOptions: Partial<StartHedgingOptions> = {}): RunningService => {
    const controller = new AbortController();
    const txSender: ChargeTxSender = serviceOptions.txSender ?? {
      enqueue: (request) => sender.enqueue(request),
    };
    const hedging = startHedging({
      db,
      bookFeed: books,
      venueName: "paper",
      escrowAddress: env.escrow,
      logger,
      clock,
      ...TEST_SERVICE_TIMINGS,
      ...serviceOptions,
      txSender,
      signal: controller.signal,
    });
    const running: RunningService = {
      hedging,
      controller,
      stop: async () => {
        controller.abort();
        await hedging.stopped;
      },
    };
    services.push(running);
    return running;
  };

  const hedgeChargedLogs: HedgeHarness["hedgeChargedLogs"] = async () => {
    const logs = await env.publicClient.getContractEvents({
      address: env.escrow,
      abi: winzEscrowAbi,
      eventName: "HedgeCharged",
      fromBlock: env.deployedAtBlock,
    });
    return logs.map((log) => ({
      ticketId: log.args.ticketId ?? -1n,
      campaignId: log.args.id ?? -1n,
      amount: log.args.amount ?? -1n,
    }));
  };

  const send: HedgeHarness["send"] = async (request, key) => {
    const outcome = await sender.sendAndWait({ ...request, idempotencyKey: key });
    if (outcome.status !== "mined") {
      throw new Error(`${request.kind} ended ${outcome.status}: ${outcome.error ?? ""}`);
    }
    return outcome.txHash ?? "";
  };

  return {
    env,
    database,
    db,
    driver,
    logger,
    logs: entries,
    clock,
    books,
    sender: () => sender,
    restartSender: async () => {
      await sender.stop();
      sender = newSender();
      await sender.start();
      return sender;
    },
    stopSender: async () => {
      await sender.stop();
    },
    createMarket,
    openCampaign,
    sell,
    startService,
    hedgeChargedLogs,
    send,
    close: async () => {
      for (const service of services) await service.stop();
      ingestController.abort();
      await ingest?.stopped;
      await sender.stop();
      await database.drop();
    },
  };
}

/** Rows of the tables the service writes, for assertions. */
export async function hedgeTables(
  db: Db,
  instrument: string,
): Promise<{
  orders: {
    venue_order_id: string;
    side: string;
    kind: string;
    price_bps: number;
    qty: bigint;
    filled_qty: bigint;
    status: string;
  }[];
  fills: {
    id: string;
    venue_order_id: string;
    side: string;
    price_bps: number;
    qty: bigint;
    fee: bigint;
  }[];
  lots: {
    ticket_onchain_id: bigint;
    campaign_id: string;
    qty: bigint;
    filled_qty: bigint;
    cost: bigint;
    max_hedge_cost: bigint;
    charged: boolean;
    charged_amount: bigint | null;
  }[];
  lotFills: { lot_qty_sum: bigint; lot_cost_sum: bigint }[];
  position: { exposure: bigint; held: bigint; working: bigint } | null;
}> {
  const orders = await db<
    {
      venue_order_id: string;
      side: string;
      kind: string;
      price_bps: number;
      qty: bigint;
      filled_qty: bigint;
      status: string;
    }[]
  >`
    select venue_order_id, side, kind, price_bps, qty, filled_qty, status
    from orders where instrument = ${instrument} order by created_at, venue_order_id
  `;
  const fills = await db<
    {
      id: string;
      venue_order_id: string;
      side: string;
      price_bps: number;
      qty: bigint;
      fee: bigint;
    }[]
  >`
    select f.id, o.venue_order_id, o.side, f.price_bps, f.qty, f.fee
    from fills f join orders o on o.id = f.order_id
    where o.instrument = ${instrument} order by f.created_at
  `;
  const lots = await db<
    {
      ticket_onchain_id: bigint;
      campaign_id: string;
      qty: bigint;
      filled_qty: bigint;
      cost: bigint;
      max_hedge_cost: bigint;
      charged: boolean;
      charged_amount: bigint | null;
    }[]
  >`
    select t.onchain_id as ticket_onchain_id, l.campaign_id, l.qty, l.filled_qty, l.cost,
           l.max_hedge_cost, l.charged, l.charged_amount
    from lots l join tickets t on t.id = l.ticket_id
    where l.instrument = ${instrument} order by l.seq
  `;
  const lotFills = await db<{ lot_qty_sum: bigint; lot_cost_sum: bigint }[]>`
    select coalesce(sum(lf.qty), 0)::bigint as lot_qty_sum, coalesce(sum(lf.cost), 0)::bigint as lot_cost_sum
    from lot_fills lf join lots l on l.id = lf.lot_id
    where l.instrument = ${instrument}
  `;
  const [position] = await db<{ exposure: bigint; held: bigint; working: bigint }[]>`
    select exposure, held, working from positions where instrument = ${instrument}
  `;
  return { orders, fills, lots, lotFills, position: position ?? null };
}

/** `engine_pnl` of an event, zeros when it has no row. */
export async function enginePnl(
  db: Db,
  eventTicker: string,
): Promise<{ makerSavings: bigint; guaranteeLosses: bigint; resaleResult: bigint }> {
  const [row] = await db<
    { maker_savings: bigint; guarantee_losses: bigint; resale_result: bigint }[]
  >`
    select maker_savings, guarantee_losses, resale_result from engine_pnl
    where event_ticker = ${eventTicker}
  `;
  return {
    makerSavings: row?.maker_savings ?? 0n,
    guaranteeLosses: row?.guarantee_losses ?? 0n,
    resaleResult: row?.resale_result ?? 0n,
  };
}

/** Waits until every lot of the instrument is charged in the database (projection). */
export async function waitAllCharged(
  db: Db,
  instrument: string,
  timeoutMs = 20_000,
): Promise<void> {
  await waitFor(
    async () => {
      const [row] = await db<{ open: bigint; total: bigint }[]>`
        select count(*) filter (where not charged)::bigint as open, count(*)::bigint as total
        from lots where instrument = ${instrument}
      `;
      return row !== undefined && row.total > 0n && row.open === 0n;
    },
    `every lot of ${instrument} charged`,
    timeoutMs,
  );
}

/** The on-chain campaign as the escrow reports it. */
export async function onchainCampaign(
  env: TestEscrow,
  id: bigint,
): Promise<{ hedgeReserved: bigint; hedgeSpent: bigint; status: number }> {
  const campaign = await env.publicClient.readContract({
    address: env.escrow,
    abi: winzEscrowAbi,
    functionName: "getCampaign",
    args: [id],
  });
  return {
    hedgeReserved: campaign.hedgeReserved,
    hedgeSpent: campaign.hedgeSpent,
    status: campaign.status,
  };
}
