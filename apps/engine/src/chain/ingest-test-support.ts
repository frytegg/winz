/**
 * Test helpers of the event ingestion: the off-chain rows the API would have created, a driver
 * of the real escrow on a local chain, and readers of what the projection wrote. Test code only.
 */
import { Writable } from "node:stream";

import pino, { type Logger } from "pino";
import type { Address, Hex, TransactionReceipt } from "viem";

import { instrumentId, winzEscrowAbi, type Quote } from "@winz/shared";

import type { Db } from "../db";
import { testUsdcAbi, type TestEscrow } from "../testing/escrow";
import type { LogClient } from "./log-poller";
import type { ReceiptLog } from "./types";

export const TEST_EVENT_TICKER = "INGEST-TEST-EVENT";

export type LogEntry = Record<string, unknown>;

/** A pino logger that keeps its entries, so tests can assert on what was logged. */
export function capturingLogger(): { logger: Logger; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback): void {
      for (const line of chunk.toString("utf8").split("\n")) {
        if (line.trim() !== "") entries.push(JSON.parse(line) as LogEntry);
      }
      callback();
    },
  });
  return { logger: pino({ level: "debug" }, stream), entries };
}

/** Resolves once `condition` holds, or rejects after `timeoutMs`. */
export async function waitFor(
  condition: () => Promise<boolean>,
  what: string,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
}

// ---------------------------------------------------------------------------------------------
// Off-chain rows the API creates before anything happens on-chain
// ---------------------------------------------------------------------------------------------

/** The game every test instrument belongs to (inserted once). */
async function seedEvent(db: Db): Promise<void> {
  await db`
    insert into events (ticker, title, sport, league, home_name, home_abbreviation,
                        away_name, away_abbreviation, starts_at, sales_close_at)
    values (${TEST_EVENT_TICKER}, 'Ingest test game', 'football', 'NCAAF', 'Texas', 'TEX',
            'Arkansas', 'ARK', '2026-11-29T00:30:00Z', '2026-11-29T00:25:00Z')
    on conflict do nothing
  `;
}

/** An instrument whose `onchain_id` is `instrumentId(symbol)`, as the catalogue sync writes it. */
export async function seedInstrument(db: Db, symbol: string): Promise<void> {
  await seedEvent(db);
  await db`
    insert into instruments (symbol, event_ticker, label, type, onchain_id)
    values (${symbol}, ${TEST_EVENT_TICKER}, ${symbol}, 'moneyline', ${instrumentId(symbol)})
    on conflict do nothing
  `;
}

/** A merchant user and its business. Returns the merchant id. */
export async function seedMerchant(db: Db, label: string): Promise<string> {
  const [user] = await db<{ id: string }[]>`
    insert into users (email, roles) values (${`${label}@example.com`}, '{merchant}') returning id
  `;
  if (user === undefined) throw new Error("user not inserted");
  const [merchant] = await db<{ id: string }[]>`
    insert into merchants (user_id, name, category) values (${user.id}, ${label}, 'bar') returning id
  `;
  if (merchant === undefined) throw new Error("merchant not inserted");
  return merchant.id;
}

export interface SeedCampaignInput {
  merchantId: string;
  symbol: string;
  unitPrice: bigint;
  refundBps: number;
  budget: bigint;
  salesClose: Date;
  /** Null: the creation job has not written it yet. */
  onchainId: bigint | null;
  slug: string | null;
  /** Default `funding`: paid, waiting for the creation job. */
  status?: string;
}

/** The campaign row the API writes. Returns its id. */
export async function seedCampaign(db: Db, input: SeedCampaignInput): Promise<string> {
  const [row] = await db<{ id: string }[]>`
    insert into campaigns (merchant_id, instrument, event_ticker, product, condition_label, promise,
                           unit_price, refund_bps, usual_margin_bps, min_margin_bps,
                           pause_threshold_bps, budget, sales_close, status, slug, onchain_id)
    values (${input.merchantId}, ${input.symbol}, ${TEST_EVENT_TICKER}, 'Beer', 'Texas wins',
            'Refunded if Texas wins', ${input.unitPrice.toString()}::bigint, ${input.refundBps},
            7000, 3000, 9000, ${input.budget.toString()}::bigint, ${input.salesClose},
            ${input.status ?? "funding"}, ${input.slug},
            ${input.onchainId === null ? null : input.onchainId.toString()}::bigint)
    returning id
  `;
  if (row === undefined) throw new Error("campaign not inserted");
  return row.id;
}

// ---------------------------------------------------------------------------------------------
// The escrow, driven as the engine would (relayer, oracle) or as anyone
// ---------------------------------------------------------------------------------------------

export interface Mined {
  receipt: TransactionReceipt;
  blockTime: Date;
}

/** Sends the escrow's transactions of a test, from the roles of `deployTestEscrow`. */
export class EscrowDriver {
  private nextNonce = 1n;

  constructor(private readonly env: TestEscrow) {}

  private async mined(hash: Hex, what: string): Promise<Mined> {
    const receipt = await this.env.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${what} reverted (${hash})`);
    const block = await this.env.publicClient.getBlock({ blockNumber: receipt.blockNumber });
    return { receipt, blockTime: new Date(Number(block.timestamp) * 1000) };
  }

  async createCampaign(input: {
    merchant: Address;
    symbol: string;
    unitPrice: bigint;
    refundBps: number;
    budget: bigint;
    salesCloseInSeconds: bigint;
  }): Promise<{ id: bigint; salesClose: bigint } & Mined> {
    const salesClose = (await this.env.latestTimestamp()) + input.salesCloseInSeconds;
    const { request, result } = await this.env.publicClient.simulateContract({
      account: this.env.accounts.relayer,
      address: this.env.escrow,
      abi: winzEscrowAbi,
      functionName: "createCampaignFor",
      args: [
        input.merchant,
        {
          instrument: instrumentId(input.symbol),
          salesClose,
          unitPrice: input.unitPrice,
          refundBps: input.refundBps,
        },
        input.budget,
      ],
    });
    const hash = await this.env.wallets.relayer.writeContract(request);
    return { id: result, salesClose, ...(await this.mined(hash, "createCampaignFor")) };
  }

  async buy(
    campaignId: bigint,
    buyer: Address,
    qty: number,
    maxHedgeCost: bigint,
  ): Promise<{ ticketId: bigint } & Mined> {
    const quote: Quote = {
      campaignId,
      buyer,
      qty,
      maxHedgeCost,
      expiry: (await this.env.latestTimestamp()) + 60n,
      nonce: this.nextNonce,
    };
    this.nextNonce += 1n;
    const signature = await this.env.signQuote(quote);
    const { request, result } = await this.env.publicClient.simulateContract({
      account: this.env.accounts.relayer,
      address: this.env.escrow,
      abi: winzEscrowAbi,
      functionName: "buyFor",
      args: [quote, signature],
    });
    const hash = await this.env.wallets.relayer.writeContract(request);
    return { ticketId: result, ...(await this.mined(hash, "buyFor")) };
  }

  async setPaused(id: bigint, paused: boolean): Promise<Mined> {
    const hash = await this.env.wallets.relayer.writeContract({
      address: this.env.escrow,
      abi: winzEscrowAbi,
      functionName: "setPaused",
      args: [id, paused],
    });
    return this.mined(hash, "setPaused");
  }

  async closeSales(id: bigint): Promise<Mined> {
    const hash = await this.env.wallets.relayer.writeContract({
      address: this.env.escrow,
      abi: winzEscrowAbi,
      functionName: "closeSales",
      args: [id],
    });
    return this.mined(hash, "closeSales");
  }

  async topUp(id: bigint, amount: bigint): Promise<Mined> {
    const hash = await this.env.wallets.relayer.writeContract({
      address: this.env.escrow,
      abi: winzEscrowAbi,
      functionName: "topUpBudgetFor",
      args: [id, amount],
    });
    return this.mined(hash, "topUpBudgetFor");
  }

  async chargeHedge(ticketIds: readonly bigint[], amounts: readonly bigint[]): Promise<Mined> {
    const hash = await this.env.wallets.oracle.writeContract({
      address: this.env.escrow,
      abi: winzEscrowAbi,
      functionName: "chargeHedge",
      args: [ticketIds, amounts],
    });
    return this.mined(hash, "chargeHedge");
  }

  /** `outcome`: 0 YES, 1 NO, 2 VOID (`IWinzEscrow.Outcome`). */
  async settle(id: bigint, outcome: 0 | 1 | 2): Promise<Mined> {
    const hash = await this.env.wallets.oracle.writeContract({
      address: this.env.escrow,
      abi: winzEscrowAbi,
      functionName: "settle",
      args: [id, outcome],
    });
    return this.mined(hash, "settle");
  }

  /** Sent by the owner account: these functions are open to anyone. */
  async refundBatch(id: bigint, ticketIds: readonly bigint[]): Promise<Mined> {
    const hash = await this.env.wallets.owner.writeContract({
      address: this.env.escrow,
      abi: winzEscrowAbi,
      functionName: "refundBatch",
      args: [id, ticketIds],
    });
    return this.mined(hash, "refundBatch");
  }

  async payMerchant(id: bigint): Promise<Mined> {
    const hash = await this.env.wallets.owner.writeContract({
      address: this.env.escrow,
      abi: winzEscrowAbi,
      functionName: "payMerchant",
      args: [id],
    });
    return this.mined(hash, "payMerchant");
  }

  async release(id: bigint): Promise<Mined> {
    const hash = await this.env.wallets.owner.writeContract({
      address: this.env.escrow,
      abi: winzEscrowAbi,
      functionName: "release",
      args: [id],
    });
    return this.mined(hash, "release");
  }

  /** Puts `account` on the test token's block list (EC-7), or takes it off. */
  async setBlocked(account: Address, blocked: boolean): Promise<Mined> {
    const hash = await this.env.wallets.owner.writeContract({
      address: this.env.usdc,
      abi: testUsdcAbi,
      functionName: "setBlocked",
      args: [account, blocked],
    });
    return this.mined(hash, "setBlocked");
  }

  async getCampaign(id: bigint): Promise<OnchainCampaign> {
    return this.env.publicClient.readContract({
      address: this.env.escrow,
      abi: winzEscrowAbi,
      functionName: "getCampaign",
      args: [id],
    });
  }

  async getTicket(id: bigint): Promise<OnchainTicket> {
    return this.env.publicClient.readContract({
      address: this.env.escrow,
      abi: winzEscrowAbi,
      functionName: "getTicket",
      args: [id],
    });
  }

  async counts(): Promise<{ campaigns: bigint; tickets: bigint }> {
    const [campaigns, tickets] = await Promise.all([
      this.env.publicClient.readContract({
        address: this.env.escrow,
        abi: winzEscrowAbi,
        functionName: "campaignCount",
      }),
      this.env.publicClient.readContract({
        address: this.env.escrow,
        abi: winzEscrowAbi,
        functionName: "ticketCount",
      }),
    ]);
    return { campaigns, tickets };
  }
}

/** `IWinzEscrow.Campaign` as viem decodes it. */
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
  merchantDue: bigint;
  status: number;
  released: boolean;
}

/** `IWinzEscrow.Ticket` as viem decodes it. */
export interface OnchainTicket {
  campaignId: bigint;
  buyer: Address;
  paid: bigint;
  refundable: bigint;
  maxHedgeCost: bigint;
  hedgeCharged: boolean;
  paidOut: boolean;
}

// ---------------------------------------------------------------------------------------------
// A log client with injected faults
// ---------------------------------------------------------------------------------------------

export interface FaultyLogClient extends LogClient {
  /** While true, every call rejects as an unreachable node would. */
  failing: boolean;
  /** `eth_getLogs` requests wider than this many blocks are refused (code -32005). */
  maxRange: bigint | null;
  calls: number;
  failures: number;
  refusals: number;
  /** Width of every successful `eth_getLogs` request, in order. */
  ranges: bigint[];
}

export class TestNodeUnreachableError extends Error {
  constructor() {
    super("fetch failed: connect ECONNREFUSED 127.0.0.1");
    this.name = "TestNodeUnreachableError";
  }
}

/** Shaped like viem's `RpcRequestError` for a node's block range limit. */
export class TestRangeRefusedError extends Error {
  readonly code = -32005;
  constructor(limit: bigint) {
    super(`query exceeds max block range ${limit.toString()}`);
    this.name = "TestRangeRefusedError";
  }
}

/** Wraps a real client: the calls go through unless the test says otherwise. */
export function faultyLogClient(inner: LogClient): FaultyLogClient {
  const client: FaultyLogClient = {
    failing: false,
    maxRange: null,
    calls: 0,
    failures: 0,
    refusals: 0,
    ranges: [],
    getBlockNumber: async (request?: { cacheTime?: number }): Promise<bigint> => {
      client.calls += 1;
      if (client.failing) {
        client.failures += 1;
        throw new TestNodeUnreachableError();
      }
      return inner.getBlockNumber(request);
    },
    getLogs: async (request): Promise<readonly ReceiptLog[]> => {
      client.calls += 1;
      if (client.failing) {
        client.failures += 1;
        throw new TestNodeUnreachableError();
      }
      const width = request.toBlock - request.fromBlock + 1n;
      if (client.maxRange !== null && width > client.maxRange) {
        client.refusals += 1;
        throw new TestRangeRefusedError(client.maxRange);
      }
      const logs = await inner.getLogs(request);
      client.ranges.push(width);
      return logs;
    },
    getBlock: async (request): Promise<{ timestamp: bigint }> => {
      client.calls += 1;
      if (client.failing) {
        client.failures += 1;
        throw new TestNodeUnreachableError();
      }
      return inner.getBlock(request);
    },
  };
  return client;
}

// ---------------------------------------------------------------------------------------------
// What the projection wrote
// ---------------------------------------------------------------------------------------------

export interface ProjectionSnapshot {
  campaigns: Record<string, unknown>[];
  tickets: Record<string, unknown>[];
  lots: Record<string, unknown>[];
  positions: Record<string, unknown>[];
  liveCampaigns: Record<string, unknown>[];
}

/**
 * Every projected row, with generated ids replaced by on-chain ids and without the columns a
 * replay cannot reproduce: row ids, `created_at` / `updated_at`, and the random `access_token`
 * of a ticket the projector created.
 */
export async function projectionSnapshot(db: Db): Promise<ProjectionSnapshot> {
  const campaigns = await db`
    select onchain_id, slug, status, sale_state, outcome, budget, sales_close, live_at
    from campaigns order by onchain_id nulls last, slug
  `;
  const tickets = await db`
    select t.onchain_id, c.onchain_id as campaign, t.buyer, t.qty, t.paid, t.refundable,
           t.max_hedge_cost, t.quote_nonce, t.status, t.tx_hash, t.payment_pi, t.purchased_at,
           t.refunded_at
    from tickets t join campaigns c on c.id = t.campaign_id
    order by t.onchain_id
  `;
  const lots = await db`
    select l.seq, t.onchain_id as ticket, c.onchain_id as campaign, l.instrument, l.qty,
           l.max_hedge_cost, l.filled_qty, l.cost, l.charged, l.charged_amount
    from lots l
    join tickets t on t.id = l.ticket_id
    join campaigns c on c.id = l.campaign_id
    order by l.seq
  `;
  const positions = await db`
    select instrument, exposure, held, working, venue from positions order by instrument
  `;
  const liveCampaigns = await db`
    select slug, sale_state, sales, exposure, hedged_bps, outcome from live_campaigns order by slug
  `;
  return {
    campaigns: [...campaigns],
    tickets: [...tickets],
    lots: [...lots],
    positions: [...positions],
    liveCampaigns: [...liveCampaigns],
  };
}

/**
 * Per instrument: the stored exposure, and the sum of the refundable amounts of the tickets of
 * its unsettled campaigns, as stored. HE-1 says both are equal at every moment.
 */
export async function exposureCheck(
  db: Db,
): Promise<{ instrument: string; exposure: bigint; refundable: bigint }[]> {
  return db<{ instrument: string; exposure: bigint; refundable: bigint }[]>`
    select i.symbol as instrument,
           coalesce(p.exposure, 0)::bigint as exposure,
           coalesce((
             select sum(t.refundable)
             from tickets t join campaigns c on c.id = t.campaign_id
             where c.instrument = i.symbol
               and c.status not in ('settled_yes', 'settled_no', 'void', 'closed')
           ), 0)::bigint as refundable
    from instruments i
    left join positions p on p.instrument = i.symbol
    order by i.symbol
  `;
}
