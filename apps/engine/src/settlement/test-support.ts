/**
 * Test helpers of the settlement watcher: a local chain with the real escrow, a real Postgres
 * with every migration, the real chain ingestion (log poller and projector) and the real
 * transaction sender. Test code only.
 */
import { encodeFunctionData, getAddress, parseEventLogs, type Address, type Hex } from "viem";

import { winzEscrowAbi, type Outcome, type Quote } from "@winz/shared";

import { startChainIngest, TxSender, type TxSenderConfig } from "../chain";
import {
  capturingLogger,
  EscrowDriver,
  seedCampaign,
  seedInstrument,
  seedMerchant,
  waitFor,
  type LogEntry,
  type OnchainCampaign,
} from "../chain/ingest-test-support";
import { TEST_SENDER_CONFIG } from "../chain/test-support";
import type { Db } from "../db";
import { startAnvil, type AnvilInstance } from "../testing/anvil";
import { deployTestEscrow, testUsdcAbi, type TestEscrow } from "../testing/escrow";
import { createTestDatabase, type TestDatabase } from "../testing/postgres";
import { startSettlement } from "./watcher";
import type {
  HedgeFinalizer,
  Settlement,
  SettlementCampaign,
  SettlementOptions,
  SettlementStepEvent,
  SettlementTxSender,
} from "./types";

export const SYMBOL = "GEMI-CFBTEXARK-2611290030-TEXAS-MONEYLINE-YES";
export const OTHER_SYMBOL = "GEMI-CFBTEXARK-2611290030-ARKANSAS-MONEYLINE-YES";
export const USDC = 1_000_000n;
export const HOUR = 3_600n;
/** `IWinzEscrow.EMERGENCY_DELAY`. */
export const EMERGENCY_DELAY = 7n * 24n * HOUR;

/** A distinct buyer address per index. Buyers never send transactions. */
export function buyerAddress(index: number): Address {
  return getAddress(`0x${(0xb0b00000 + index).toString(16).padStart(40, "0")}`);
}

/** Watcher settings that make a test run in seconds. */
export const FAST_SETTLEMENT = {
  intervalMs: 100,
  txWaitTimeoutMs: 15_000,
  retryBaseMs: 50,
  retryMaxMs: 400,
  refundRetryBaseMs: 100,
  refundRetryMaxMs: 400,
  treasuryRetryBaseMs: 100,
  treasuryRetryMaxMs: 400,
} satisfies Partial<SettlementOptions>;

/** A hedge finalizer that records its calls and runs `impl` when given one. */
export class FakeHedgeFinalizer implements HedgeFinalizer {
  readonly calls: SettlementCampaign[] = [];

  constructor(private readonly impl?: (campaign: SettlementCampaign) => Promise<void>) {}

  async finalize(campaign: SettlementCampaign): Promise<void> {
    this.calls.push(campaign);
    if (this.impl !== undefined) await this.impl(campaign);
  }
}

export interface CampaignFixture {
  /** `campaigns.id`. */
  id: string;
  onchainId: bigint;
  salesClose: bigint;
  ticketIds: bigint[];
  buyers: Address[];
  budget: bigint;
}

export interface CreateCampaignInput {
  symbol?: string;
  /** One ticket per buyer, in order. */
  buyers: readonly Address[];
  qty?: number;
  unitPrice?: bigint;
  refundBps?: number;
  /** Guarantee of each ticket; a function of the ticket's index, or one value for all. */
  maxHedgeCost?: bigint | ((index: number) => bigint);
  budget?: bigint;
  salesCloseInSeconds?: bigint;
}

export interface SettlementEnv {
  anvil: AnvilInstance;
  env: TestEscrow;
  database: TestDatabase;
  db: Db;
  driver: EscrowDriver;
  merchantId: string;
  logs: LogEntry[];
  logger: ReturnType<typeof capturingLogger>["logger"];
  /** Creates a campaign and its tickets on-chain, with the matching rows; waits for the projection. */
  createCampaign: (input: CreateCampaignInput) => Promise<CampaignFixture>;
  /** A started transaction sender on this chain and database (relayer and oracle keys). */
  startSender: () => Promise<TxSender>;
  /** The same sender, not started: what it is given stays queued until `start()`. */
  createSender: () => TxSender;
  /** A started watcher; stopped by `close` if the test did not. */
  startWatcher: (
    overrides: Partial<SettlementOptions> & {
      txSender: SettlementTxSender;
      hedgeFinalizer: HedgeFinalizer;
    },
  ) => { settlement: Settlement; controller: AbortController };
  close: () => Promise<void>;
}

export interface SettlementEnvOptions {
  /** Seconds between blocks (interval mining). Omitted: a block per transaction (automine). */
  blockTime?: number;
  /** Settings of the env's transaction senders over `TEST_SENDER_CONFIG`. */
  sender?: Partial<TxSenderConfig>;
}

/** Creates a fresh chain, database, projection and merchant. The treasury has its own key. */
export async function createSettlementEnv(
  options: SettlementEnvOptions = {},
): Promise<SettlementEnv> {
  const anvil = await startAnvil({
    accounts: 5,
    ...(options.blockTime === undefined ? {} : { blockTime: options.blockTime }),
  });
  const senders: TxSender[] = [];
  const controllers: AbortController[] = [];
  const stoppers: Promise<void>[] = [];
  let database: TestDatabase | undefined;
  const close = async (): Promise<void> => {
    for (const controller of controllers) controller.abort();
    await Promise.allSettled(stoppers);
    await Promise.allSettled(senders.map((sender) => sender.stop()));
    await database?.drop();
    await anvil.stop();
  };
  try {
    const env = await deployTestEscrow(anvil, { treasuryIsRelayer: false });
    database = await createTestDatabase();
    const db = database.db;
    const { logger, entries } = capturingLogger();
    await seedInstrument(db, SYMBOL);
    await seedInstrument(db, OTHER_SYMBOL);
    const merchantId = await seedMerchant(db, "settlement-merchant");
    const driver = new EscrowDriver(env);
    /** Quote nonces of `createCampaign`'s purchases; the driver's own start at 1. */
    let nextQuoteNonce = 1_000_000n;

    const ingest = new AbortController();
    controllers.push(ingest);
    stoppers.push(
      startChainIngest({
        db,
        publicClient: env.publicClient,
        escrowAddress: env.escrow,
        fromBlock: env.deployedAtBlock,
        logger: logger.child({ module: "chain-ingest" }),
        signal: ingest.signal,
        pollIntervalMs: 100,
        projectIntervalMs: 50,
        retryBaseMs: 50,
        retryMaxMs: 400,
      }).stopped,
    );

    const createCampaign = async (input: CreateCampaignInput): Promise<CampaignFixture> => {
      const symbol = input.symbol ?? SYMBOL;
      const unitPrice = input.unitPrice ?? 10n * USDC;
      const refundBps = input.refundBps ?? 5_000;
      const budget = input.budget ?? 100n * USDC;
      const created = await driver.createCampaign({
        merchant: env.accounts.merchant.address,
        symbol,
        unitPrice,
        refundBps,
        budget,
        salesCloseInSeconds: input.salesCloseInSeconds ?? HOUR,
      });
      const id = await seedCampaign(db, {
        merchantId,
        symbol,
        unitPrice,
        refundBps,
        budget,
        salesClose: new Date(Number(created.salesClose) * 1000),
        onchainId: created.id,
        slug: null,
        status: "live",
      });
      // Sent one after the other without waiting for each receipt (anvil mines each at once),
      // then read back: hundreds of tickets are bought in seconds.
      const hashes: Hex[] = [];
      for (const [index, buyer] of input.buyers.entries()) {
        const guarantee =
          typeof input.maxHedgeCost === "function"
            ? input.maxHedgeCost(index)
            : (input.maxHedgeCost ?? USDC);
        const quote: Quote = {
          campaignId: created.id,
          buyer,
          qty: input.qty ?? 1,
          maxHedgeCost: guarantee,
          expiry: created.salesClose,
          nonce: nextQuoteNonce,
        };
        nextQuoteNonce += 1n;
        hashes.push(
          await env.wallets.relayer.writeContract({
            address: env.escrow,
            abi: winzEscrowAbi,
            functionName: "buyFor",
            args: [quote, await env.signQuote(quote)],
          }),
        );
      }
      const ticketIds: bigint[] = [];
      for (const hash of hashes) {
        const receipt = await env.publicClient.waitForTransactionReceipt({
          hash,
          pollingInterval: 10,
        });
        if (receipt.status !== "success") throw new Error(`buyFor reverted (${hash})`);
        const [purchase] = parseEventLogs({
          abi: winzEscrowAbi,
          eventName: "TicketPurchased",
          logs: receipt.logs,
        });
        if (purchase === undefined) throw new Error(`no TicketPurchased in ${hash}`);
        ticketIds.push(purchase.args.ticketId);
      }
      await waitFor(async () => {
        const [row] = await db<{ tickets: bigint; lots: bigint }[]>`
          select (select count(*) from tickets where campaign_id = ${id}) as tickets,
                 (select count(*) from lots where campaign_id = ${id}) as lots
        `;
        return row?.tickets === BigInt(ticketIds.length) && row.lots === BigInt(ticketIds.length);
      }, "the tickets to be projected");
      return {
        id,
        onchainId: created.id,
        salesClose: created.salesClose,
        ticketIds,
        buyers: [...input.buyers],
        budget,
      };
    };

    const createSender = (): TxSender => {
      const sender = new TxSender({
        db,
        client: env.publicClient,
        accounts: { relayer: env.accounts.relayer, oracle: env.accounts.oracle },
        logger: logger.child({ module: "tx-sender" }),
        config: {
          chainId: env.chainId,
          escrowAddress: env.escrow,
          ...TEST_SENDER_CONFIG,
          ...options.sender,
        },
      });
      senders.push(sender);
      return sender;
    };

    const startSender = async (): Promise<TxSender> => {
      const sender = createSender();
      await sender.start();
      return sender;
    };

    const startWatcher: SettlementEnv["startWatcher"] = (overrides) => {
      const controller = new AbortController();
      controllers.push(controller);
      const settlement = startSettlement({
        db,
        publicClient: env.publicClient,
        escrowAddress: env.escrow,
        logger: logger.child({ module: "settlement" }),
        signal: controller.signal,
        ...FAST_SETTLEMENT,
        ...overrides,
      });
      stoppers.push(settlement.stopped);
      return { settlement, controller };
    };

    return {
      anvil,
      env,
      database,
      db,
      driver,
      merchantId,
      logs: entries,
      logger,
      createCampaign,
      startSender,
      createSender,
      startWatcher,
      close,
    };
  } catch (error: unknown) {
    await close();
    throw error;
  }
}

/** Gemini's result for an instrument, as the catalogue sync writes it. */
export async function setInstrumentOutcome(
  db: Db,
  symbol: string,
  outcome: Outcome,
): Promise<void> {
  await db`update instruments set outcome = ${outcome}, settled_at = now() where symbol = ${symbol}`;
}

/** A forced demo result, as the admin route writes it. */
export async function forceResult(db: Db, symbol: string, outcome: Outcome): Promise<void> {
  await db`
    insert into demo_overrides (instrument, forced_result) values (${symbol}, ${outcome})
    on conflict (instrument) do update set forced_result = excluded.forced_result
  `;
}

export async function tokenBalance(env: TestEscrow, account: Address): Promise<bigint> {
  return env.publicClient.readContract({
    address: env.usdc,
    abi: testUsdcAbi,
    functionName: "balanceOf",
    args: [account],
  });
}

/** Sets what the treasury lets the escrow pull. */
export async function setTreasuryAllowance(env: TestEscrow, amount: bigint): Promise<void> {
  const hash = await env.wallets.treasury.writeContract({
    address: env.usdc,
    abi: testUsdcAbi,
    functionName: "approve",
    args: [env.escrow, amount],
  });
  await env.publicClient.waitForTransactionReceipt({ hash });
}

/** Every event the escrow emitted, decoded, read from the chain itself (not the database). */
export async function escrowEvents(
  env: TestEscrow,
): Promise<ReturnType<typeof parseEventLogs<typeof winzEscrowAbi>>> {
  const logs = await env.publicClient.getLogs({
    address: env.escrow,
    fromBlock: env.deployedAtBlock,
    toBlock: "latest",
  });
  return parseEventLogs({ abi: winzEscrowAbi, logs });
}

/** Number of events of `name` per ticket id (or per campaign id for campaign events). */
export async function eventCounts(env: TestEscrow, name: string): Promise<Map<bigint, number>> {
  const counts = new Map<bigint, number>();
  for (const event of await escrowEvents(env)) {
    if (event.eventName !== name) continue;
    const args = event.args as { ticketId?: bigint; id?: bigint };
    const key = args.ticketId ?? args.id;
    if (key === undefined) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** `chargeHedge` sent through the transaction sender, as the hedging lane would. */
export async function chargeThroughSender(
  sender: TxSender,
  env: TestEscrow,
  key: string,
  ticketIds: readonly bigint[],
  amounts: readonly bigint[],
): Promise<void> {
  const outcome = await sender.sendAndWait({
    idempotencyKey: key,
    signer: "oracle",
    kind: "chargeHedge",
    to: env.escrow,
    data: encodeFunctionData({
      abi: winzEscrowAbi,
      functionName: "chargeHedge",
      args: [ticketIds, amounts],
    }),
  });
  if (outcome.status !== "mined") throw new Error(`test chargeHedge ${outcome.status}`);
}

/** Lots of a campaign by ticket id, as the projection wrote them. */
export async function projectedLots(
  db: Db,
  campaignId: string,
): Promise<Map<bigint, { charged: boolean; chargedAmount: bigint | null }>> {
  const rows = await db<{ onchain_id: bigint; charged: boolean; charged_amount: bigint | null }[]>`
    select t.onchain_id, l.charged, l.charged_amount
    from lots l join tickets t on t.id = l.ticket_id
    where l.campaign_id = ${campaignId}
  `;
  return new Map(
    rows.map((row) => [
      row.onchain_id,
      { charged: row.charged, chargedAmount: row.charged_amount },
    ]),
  );
}

/** Writes the hedging lane's allocation of a ticket's lot (cost and filled quantity). */
export async function allocateLot(
  db: Db,
  ticketOnchainId: bigint,
  cost: bigint,
  filledQty: bigint,
): Promise<void> {
  await db`
    update lots set cost = ${cost.toString()}::bigint, filled_qty = ${filledQty.toString()}::bigint
    from tickets
    where lots.ticket_id = tickets.id and tickets.onchain_id = ${ticketOnchainId.toString()}::bigint
  `;
}

/** Records the step events of a watcher, and runs `onEvent` for each. */
export function stepRecorder(onEvent?: (event: SettlementStepEvent) => void | Promise<void>): {
  events: SettlementStepEvent[];
  onStep: (event: SettlementStepEvent) => Promise<void>;
} {
  const events: SettlementStepEvent[] = [];
  return {
    events,
    onStep: async (event) => {
      events.push(event);
      if (onEvent !== undefined) await onEvent(event);
    },
  };
}

/** Waits until the transaction sender has recorded the outcome of every transaction. */
export async function waitForIdleOutbox(db: Db): Promise<void> {
  await waitFor(async () => {
    const [open] = await db<{ n: bigint }[]>`
      select count(*) as n from chain_txs where status in ('queued', 'sent')
    `;
    return open?.n === 0n;
  }, "every transaction to be final in the outbox");
}

/** Error-level log entries whose message contains `text`. */
export function errorLogs(logs: readonly LogEntry[], text: string): LogEntry[] {
  return logs.filter(
    (entry) => entry.level === 50 && typeof entry.msg === "string" && entry.msg.includes(text),
  );
}

export { waitFor, type OnchainCampaign };
