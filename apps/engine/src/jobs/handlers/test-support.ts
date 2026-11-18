/**
 * Test harness of the job handlers: a real local chain with the real escrow, a real Postgres with
 * every migration, the real transaction sender and projector, a fake payment gateway, a fake
 * identity directory and a hand-fed book source. Test code only.
 */
import { randomUUID } from "node:crypto";

import type { Logger } from "pino";
import { getAddress, type Address, type Hex } from "viem";

import { maxCostBps, pauseThresholdBps } from "@winz/pricing";
import {
  instrumentId,
  STRIPE_PAYMENT_KINDS,
  winzEscrowAbi,
  type Book,
  type BookLevel,
} from "@winz/shared";

import { TxSender, type ChainClient, type TxSenderConfig } from "../../chain";
import { capturingLogger, type LogEntry } from "../../chain/ingest-test-support";
import { TEST_SENDER_CONFIG, transientError, wrapClient } from "../../chain/test-support";
import type { Db } from "../../db";
import { FakeIdentityDirectory } from "../../identity";
import { FakePaymentGateway } from "../../payments";
import { startAnvil, type AnvilInstance } from "../../testing/anvil";
import { deployTestEscrow, testUsdcAbi, type TestEscrow } from "../../testing/escrow";
import { createTestDatabase, type TestDatabase } from "../../testing/postgres";
import type { JobContext, JobHandler } from "../worker";
import { createCampaignCreationHandler } from "./create-campaign";
import type { BookSource, JobHandlerDeps, JobHandlerOptions } from "./deps";

export const USDC = 1_000_000n;
export const CONTRACT = 1_000_000n;

// ---------------------------------------------------------------------------------------------
// Time and books
// ---------------------------------------------------------------------------------------------

/**
 * The handlers' clock: the chain's time (re-read by `sync`) plus the time elapsed since, plus a
 * skew a test can set to make the handler believe it is earlier or later than the chain.
 */
export class TestClock {
  private offsetMs = 0;
  skewMs = 0;

  readonly now = (): number => Date.now() + this.offsetMs + this.skewMs;

  /** Unskewed: the chain's time as far as the test knows. */
  chainNow(): number {
    return Date.now() + this.offsetMs;
  }

  async sync(escrow: TestEscrow): Promise<void> {
    const latest = await escrow.latestTimestamp();
    this.offsetMs = Number(latest) * 1000 - Date.now();
  }
}

interface FedBook {
  bids: BookLevel[];
  asks: BookLevel[];
  ageMs: number;
}

/** A book source fed by hand. Each book is observed `ageMs` before the chain's current time. */
export class HandFedBooks implements BookSource {
  private readonly books = new Map<string, FedBook>();

  constructor(private readonly clock: TestClock) {}

  set(symbol: string, book: { asks: BookLevel[]; bids?: BookLevel[]; ageMs?: number }): void {
    this.books.set(symbol, { asks: book.asks, bids: book.bids ?? [], ageMs: book.ageMs ?? 0 });
  }

  delete(symbol: string): void {
    this.books.delete(symbol);
  }

  getBook(symbol: string): Book | null {
    const fed = this.books.get(symbol);
    if (fed === undefined) return null;
    return {
      instrumentSymbol: symbol,
      bids: fed.bids,
      asks: fed.asks,
      observedAtMs: this.clock.chainNow() - fed.ageMs,
    };
  }
}

// ---------------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------------

export interface JobsHarness {
  anvil: AnvilInstance;
  escrow: TestEscrow;
  database: TestDatabase;
  db: Db;
  sender: TxSender;
  gateway: FakePaymentGateway;
  identity: FakeIdentityDirectory;
  books: HandFedBooks;
  clock: TestClock;
  logger: Logger;
  logs: LogEntry[];
  /** While true, the node refuses broadcasts and receipt lookups (an RPC outage). */
  outage: { active: boolean };
  /** Handler dependencies; `override` replaces fields, `options` merges into the test options. */
  deps: (override?: Partial<JobHandlerDeps>, options?: JobHandlerOptions) => JobHandlerDeps;
  close: () => Promise<void>;
}

/** Fast timings for tests. */
export const TEST_HANDLER_OPTIONS: JobHandlerOptions = {
  waitTimeoutMs: 20_000,
  retryDelayMs: 10,
  maxBuyAttempts: 3,
  resendDelayMs: 10,
  maxResendDelayMs: 50,
};

export interface JobsHarnessOptions {
  /** Seconds between blocks (interval mining). Omitted: a block per transaction (automine). */
  blockTime?: number;
  /** Settings of the harness's transaction sender over `TEST_SENDER_CONFIG`. */
  sender?: Partial<TxSenderConfig>;
}

export async function createJobsHarness(options: JobsHarnessOptions = {}): Promise<JobsHarness> {
  const anvil = await startAnvil(
    options.blockTime === undefined ? {} : { blockTime: options.blockTime },
  );
  let database: TestDatabase | undefined;
  let sender: TxSender | undefined;
  const close = async (): Promise<void> => {
    await sender?.stop();
    await database?.drop();
    await anvil.stop();
  };
  try {
    const escrow = await deployTestEscrow(anvil);
    database = await createTestDatabase();
    const db = database.db;
    const { logger, entries } = capturingLogger();
    const outage = { active: false };
    const base: ChainClient = escrow.publicClient;
    const client = wrapClient(base, {
      sendRawTransaction: (request) =>
        outage.active ? Promise.reject(transientError()) : base.sendRawTransaction(request),
      getTransactionReceipt: (request) =>
        outage.active ? Promise.reject(transientError()) : base.getTransactionReceipt(request),
    });
    sender = new TxSender({
      db,
      client,
      accounts: { relayer: escrow.accounts.relayer, oracle: escrow.accounts.oracle },
      logger: logger.child({ module: "tx-sender" }),
      config: {
        chainId: escrow.chainId,
        escrowAddress: escrow.escrow,
        ...TEST_SENDER_CONFIG,
        ...options.sender,
      },
    });
    await sender.start();
    const clock = new TestClock();
    await clock.sync(escrow);
    const books = new HandFedBooks(clock);
    const gateway = new FakePaymentGateway();
    const identity = new FakeIdentityDirectory();
    const started = sender;
    return {
      anvil,
      escrow,
      database,
      db,
      sender: started,
      gateway,
      identity,
      books,
      clock,
      logger,
      logs: entries,
      outage,
      deps: (override = {}, options = {}) => ({
        db,
        txSender: started,
        publicClient: escrow.publicClient,
        oracle: escrow.accounts.oracle,
        escrowAddress: escrow.escrow,
        chainId: escrow.chainId,
        books,
        payments: gateway,
        identity,
        logger,
        clock: clock.now,
        ...override,
        options: { ...TEST_HANDLER_OPTIONS, ...override.options, ...options },
      }),
      close,
    };
  } catch (error: unknown) {
    await close();
    throw error;
  }
}

/** A job context for a direct call of a handler. */
export function jobContext(signal: AbortSignal = new AbortController().signal): JobContext {
  return { jobId: randomUUID(), attempt: 1, signal };
}

/** Calls a handler the way the worker does, after syncing the clock with the chain. */
export async function runHandler<T>(
  harness: JobsHarness,
  handler: JobHandler<T>,
  payload: T,
): Promise<void> {
  await harness.clock.sync(harness.escrow);
  await handler(payload, jobContext());
}

// ---------------------------------------------------------------------------------------------
// Off-chain rows the web app writes
// ---------------------------------------------------------------------------------------------

/** A game whose sales close in two days, and one instrument on it. Returns the symbol. */
export async function seedInstrument(harness: JobsHarness, label: string): Promise<string> {
  const ticker = `JOBS-${label.toUpperCase()}-${randomUUID().slice(0, 8)}`;
  const symbol = `GEMI-${ticker}-YES`;
  const startsAt = new Date(harness.clock.chainNow() + 2 * 24 * 3_600_000);
  const salesCloseAt = new Date(startsAt.getTime() - 5 * 60_000);
  await harness.db`
    insert into events (ticker, title, sport, league, home_name, home_abbreviation,
                        away_name, away_abbreviation, starts_at, sales_close_at)
    values (${ticker}, 'Texas vs Arkansas', 'football', 'NCAAF', 'Texas', 'TEX', 'Arkansas', 'ARK',
            ${startsAt}, ${salesCloseAt})
  `;
  await harness.db`
    insert into instruments (symbol, event_ticker, label, type, onchain_id, side)
    values (${symbol}, ${ticker}, 'Texas wins', 'moneyline', ${instrumentId(symbol)}, 'home')
  `;
  return symbol;
}

/** A merchant user (no wallet yet: the creation job resolves it) and its business. */
export async function seedMerchant(
  harness: JobsHarness,
  name: string,
  email = `merchant-${randomUUID().slice(0, 8)}@example.com`,
): Promise<{ merchantId: string; userId: string; email: string }> {
  const [user] = await harness.db<{ id: string }[]>`
    insert into users (email, roles) values (${email}, '{merchant}') returning id
  `;
  if (user === undefined) throw new Error("user not inserted");
  const [merchant] = await harness.db<{ id: string }[]>`
    insert into merchants (user_id, name, category) values (${user.id}, ${name}, 'bar') returning id
  `;
  if (merchant === undefined) throw new Error("merchant not inserted");
  return { merchantId: merchant.id, userId: user.id, email };
}

export interface CampaignTerms {
  unitPrice: bigint;
  refundBps: number;
  usualMarginBps: number;
  minMarginBps: number;
  budget: bigint;
  /** Default: two days minus five minutes from the chain's time (the event's sales close). */
  salesClose?: Date;
  conditionLabel?: string;
}

export const DEFAULT_TERMS: CampaignTerms = {
  unitPrice: 5n * USDC,
  refundBps: 10_000,
  usualMarginBps: 7_000,
  minMarginBps: 3_000,
  budget: 100n * USDC,
};

/** The pause threshold the web app stores for these terms. */
export function thresholdOf(terms: CampaignTerms): bigint {
  return pauseThresholdBps(
    maxCostBps(BigInt(terms.usualMarginBps), BigInt(terms.minMarginBps)),
    BigInt(terms.refundBps),
  );
}

/**
 * A campaign `funding` with its budget payment, as POST /api/campaigns writes it, and the
 * budget PaymentIntent at the gateway (`succeeded` unless told otherwise).
 */
export async function seedFundedCampaign(
  harness: JobsHarness,
  input: {
    merchantId: string;
    symbol: string;
    terms?: Partial<CampaignTerms>;
    budgetStatus?: "succeeded" | "processing";
  },
): Promise<{ campaignId: string; budgetPi: string; terms: CampaignTerms }> {
  const terms: CampaignTerms = { ...DEFAULT_TERMS, ...input.terms };
  const [instrument] = await harness.db<{ event_ticker: string; sales_close_at: Date }[]>`
    select i.event_ticker, e.sales_close_at
    from instruments i join events e on e.ticker = i.event_ticker
    where i.symbol = ${input.symbol}
  `;
  if (instrument === undefined) throw new Error(`no instrument ${input.symbol}`);
  const salesClose = terms.salesClose ?? instrument.sales_close_at;
  const [row] = await harness.db<{ id: string }[]>`
    insert into campaigns (merchant_id, instrument, event_ticker, product, condition_label, promise,
                           unit_price, refund_bps, usual_margin_bps, min_margin_bps,
                           pause_threshold_bps, budget, sales_close, status, sale_state)
    values (${input.merchantId}, ${input.symbol}, ${instrument.event_ticker}, 'Beer',
            ${terms.conditionLabel ?? "Texas wins"}, 'Refunded if Texas wins',
            ${terms.unitPrice.toString()}::bigint, ${terms.refundBps}, ${terms.usualMarginBps},
            ${terms.minMarginBps}, ${Number(thresholdOf(terms))}, ${terms.budget.toString()}::bigint,
            ${salesClose}, 'funding', 'closed')
    returning id
  `;
  if (row === undefined) throw new Error("campaign not inserted");
  const budgetPi = `pi_budget_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await harness.db`update campaigns set budget_pi = ${budgetPi} where id = ${row.id}`;
  harness.gateway.setIntent({
    id: budgetPi,
    status: input.budgetStatus ?? "succeeded",
    amount: terms.budget,
    currency: "usd",
    metadata: { kind: STRIPE_PAYMENT_KINDS.campaignBudget, campaignId: row.id },
    payerEmail: null,
  });
  return { campaignId: row.id, budgetPi, terms };
}

export interface PaymentInput {
  campaignId: string;
  qty: number;
  unitPrice: bigint;
  /** Stored on the payment row (normalised), or null to leave the e-mail to the PaymentIntent. */
  email: string | null;
  /** The e-mail the payment sheet collected, as typed. Default: `email`. */
  payerEmail?: string | null;
  /** Overrides of what the PaymentIntent says, to make it disagree with the row. */
  intent?: { amount?: bigint; qty?: string; campaignId?: string };
}

/** A payment `processing`, as the checkout confirmation leaves it, and its authorized intent. */
export async function seedPayment(harness: JobsHarness, input: PaymentInput): Promise<string> {
  const pi = `pi_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const amount = BigInt(input.qty) * input.unitPrice;
  await harness.db`
    insert into payments (stripe_pi, campaign_id, email, qty, amount, status)
    values (${pi}, ${input.campaignId}, ${input.email}, ${input.qty}, ${amount.toString()}::bigint,
            'processing')
  `;
  harness.gateway.setIntent({
    id: pi,
    status: "requires_capture",
    amount: input.intent?.amount ?? amount,
    currency: "usd",
    metadata: {
      kind: STRIPE_PAYMENT_KINDS.purchase,
      campaignId: input.intent?.campaignId ?? input.campaignId,
      qty: input.intent?.qty ?? input.qty.toString(),
    },
    payerEmail: input.payerEmail === undefined ? input.email : input.payerEmail,
  });
  return pi;
}

export interface LiveCampaign {
  campaignId: string;
  onchainId: bigint;
  symbol: string;
  terms: CampaignTerms;
}

/** A campaign put live by the creation job, on its own instrument. */
export async function createLiveCampaign(
  harness: JobsHarness,
  label: string,
  terms: Partial<CampaignTerms> = {},
): Promise<LiveCampaign> {
  const symbol = await seedInstrument(harness, label);
  const { merchantId } = await seedMerchant(harness, `${label} bar`);
  const funded = await seedFundedCampaign(harness, { merchantId, symbol, terms });
  await runHandler(harness, createCampaignCreationHandler(harness.deps()), {
    campaignId: funded.campaignId,
  });
  const [row] = await harness.db<{ onchain_id: bigint | null; status: string }[]>`
    select onchain_id, status from campaigns where id = ${funded.campaignId}
  `;
  if (row?.onchain_id === null || row?.onchain_id === undefined || row.status !== "live") {
    throw new Error(`campaign ${funded.campaignId} did not go live`);
  }
  return { campaignId: funded.campaignId, onchainId: row.onchain_id, symbol, terms: funded.terms };
}

// ---------------------------------------------------------------------------------------------
// Reading back
// ---------------------------------------------------------------------------------------------

export interface OnchainCampaign {
  merchant: Address;
  instrument: Hex;
  salesClose: bigint;
  unitPrice: bigint;
  refundBps: number;
  hedgeBudget: bigint;
  hedgeReserved: bigint;
  hedgeSpent: bigint;
  lockedRefunds: bigint;
  status: number;
}

export async function getCampaign(harness: JobsHarness, id: bigint): Promise<OnchainCampaign> {
  return harness.escrow.publicClient.readContract({
    address: harness.escrow.escrow,
    abi: winzEscrowAbi,
    functionName: "getCampaign",
    args: [id],
  });
}

export interface OnchainTicket {
  id: bigint;
  campaignId: bigint;
  buyer: Address;
  paid: bigint;
  refundable: bigint;
  maxHedgeCost: bigint;
}

/** Every ticket the escrow holds, read from the contract. */
export async function onchainTickets(harness: JobsHarness): Promise<OnchainTicket[]> {
  const { publicClient, escrow } = harness.escrow;
  const count = await publicClient.readContract({
    address: escrow,
    abi: winzEscrowAbi,
    functionName: "ticketCount",
  });
  const tickets: OnchainTicket[] = [];
  for (let id = 1n; id <= count; id += 1n) {
    const ticket = await publicClient.readContract({
      address: escrow,
      abi: winzEscrowAbi,
      functionName: "getTicket",
      args: [id],
    });
    tickets.push({ id, ...ticket });
  }
  return tickets;
}

export async function campaignCount(harness: JobsHarness): Promise<bigint> {
  return harness.escrow.publicClient.readContract({
    address: harness.escrow.escrow,
    abi: winzEscrowAbi,
    functionName: "campaignCount",
  });
}

export async function treasuryBalance(harness: JobsHarness): Promise<bigint> {
  return harness.escrow.publicClient.readContract({
    address: harness.escrow.usdc,
    abi: testUsdcAbi,
    functionName: "balanceOf",
    args: [harness.escrow.accounts.treasury.address],
  });
}

/** Rows of `chain_txs` whose idempotency key starts with `prefix`. */
export async function txRows(
  harness: JobsHarness,
  prefix: string,
): Promise<{ idempotency_key: string; status: string; last_error: string | null }[]> {
  return harness.db<{ idempotency_key: string; status: string; last_error: string | null }[]>`
    select idempotency_key, status, last_error from chain_txs
    where starts_with(idempotency_key, ${prefix})
    order by created_at
  `;
}

export function checksum(address: string): Address {
  return getAddress(address);
}

/** Every log entry, serialised, for checks on what must never be logged. */
export function allLogText(harness: JobsHarness): string {
  return harness.logs.map((entry) => JSON.stringify(entry)).join("\n");
}

/** Log entries of a level (pino numbers: 40 warn, 50 error) whose message contains `text`. */
export function logsAt(harness: JobsHarness, level: number, text: string): LogEntry[] {
  return harness.logs.filter(
    (entry) => entry.level === level && typeof entry.msg === "string" && entry.msg.includes(text),
  );
}
