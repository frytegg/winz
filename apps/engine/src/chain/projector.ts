import { randomBytes } from "node:crypto";

import type { Logger } from "pino";
import type { Hex } from "viem";
import { z } from "zod";

import type { Db } from "../db";
import { summarizeError } from "./error-summary";
import { InvalidEventArgsError, ProjectionError } from "./ingest-errors";
import type { JsonObject, Queryable } from "./types";

/** A row of `chain_events`, as the projector reads it. */
export interface StoredChainEvent {
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  /** Null when the writer could not read the block; `createdAt` stands in for it then. */
  blockTime: Date | null;
  name: string;
  /** Integers are decimal strings or small numbers, addresses lowercase (see `toJsonValue`). */
  args: JsonObject;
  createdAt: Date;
}

/**
 * What `projectChainEvent` did with an event.
 * - `applied`: the database now reflects it; the caller marks it processed.
 * - `ignored`: nothing to project (an event without a projection rule); also marked processed.
 * - `deferred`: it concerns a campaign whose `onchain_id` is not written yet. Nothing was
 *   changed; the caller leaves it unprocessed and retries it later.
 */
export type ProjectionOutcome =
  | { status: "applied"; campaignOnchainId: bigint | null }
  | { status: "ignored"; campaignOnchainId: bigint | null; reason: string }
  | { status: "deferred"; campaignOnchainId: bigint; reason: string };

// Off-chain statuses (CA-4) the SQL below relies on: a campaign in 'settled_yes', 'settled_no',
// 'void' or 'closed' is settled and its lots leave the exposure; 'draft' and 'funding' are the
// statuses before the campaign exists on-chain, which `CampaignCreated` moves to 'live'.

/** `IWinzEscrow.Outcome` by index, and the off-chain status each one leads to. */
const OUTCOMES = [
  { outcome: "yes", status: "settled_yes" },
  { outcome: "no", status: "settled_no" },
  { outcome: "void", status: "void" },
] as const;

/**
 * `lots.seq` of a ticket's lot: the position of its `TicketPurchased` log on the chain. Lots are
 * filled in `seq` order (SPEC 9.5), so the FIFO is the on-chain order of the purchases even when
 * one purchase is projected after a later one (its campaign was not known yet), and a replay
 * rebuilds the same values. A block holds far fewer than a million logs (30 M gas per block).
 */
const LOG_INDEX_SPAN = 1_000_000n;

export function lotSeq(blockNumber: bigint, logIndex: number): bigint {
  if (logIndex < 0 || BigInt(logIndex) >= LOG_INDEX_SPAN) {
    throw new RangeError(`log index ${logIndex.toString()} out of range for a lot sequence`);
  }
  return blockNumber * LOG_INDEX_SPAN + BigInt(logIndex);
}

/** A uint stored as a decimal string (wider than 48 bits) or as a JSON number (narrower). */
const uint = z
  .union([z.string().regex(/^[0-9]+$/), z.number().int().nonnegative()])
  .transform((value) => BigInt(value));
const address = z.string().regex(/^0x[0-9a-f]{40}$/);

const argSchemas = {
  CampaignCreated: z.object({ id: uint, budget: uint }),
  BudgetToppedUp: z.object({ id: uint, amount: uint }),
  TicketPurchased: z.object({
    ticketId: uint,
    id: uint,
    buyer: address,
    qty: uint,
    paid: uint,
    refundable: uint,
    maxHedgeCost: uint,
  }),
  CampaignPaused: z.object({ id: uint, paused: z.boolean() }),
  SalesClosedEarly: z.object({ id: uint, salesClose: uint }),
  HedgeCharged: z.object({ ticketId: uint, id: uint, amount: uint }),
  CampaignSettled: z.object({ id: uint, outcome: z.number().int().min(0).max(2) }),
  MerchantPaid: z.object({ id: uint }),
  TicketRefunded: z.object({ ticketId: uint, id: uint }),
  RefundFailed: z.object({ ticketId: uint, id: uint }),
  CampaignReleased: z.object({ id: uint }),
} as const;

type CampaignEventName = keyof typeof argSchemas;

function isCampaignEvent(name: string): name is CampaignEventName {
  return Object.prototype.hasOwnProperty.call(argSchemas, name);
}

/** Events of the escrow that change nothing in the database (SPEC section 8). */
const NO_PROJECTION_EVENTS = new Set([
  "RolesUpdated",
  "OwnershipTransferred",
  "OwnershipTransferStarted",
  "EIP712DomainChanged",
]);

function parseArgs<N extends CampaignEventName>(
  name: N,
  event: StoredChainEvent,
): z.infer<(typeof argSchemas)[N]> {
  const parsed = argSchemas[name].safeParse(event.args);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new InvalidEventArgsError(
      event.name,
      event.txHash,
      event.logIndex,
      issue ? `${issue.path.join(".")}: ${issue.message}` : "invalid",
    );
  }
  return parsed.data as z.infer<(typeof argSchemas)[N]>;
}

/**
 * On-chain campaign id an event concerns, or null for an event about no campaign. Read without
 * validating the rest of the arguments, so the projector can keep the events of one campaign in
 * order even when one of them cannot be applied.
 */
export function campaignOnchainIdOf(event: Pick<StoredChainEvent, "name" | "args">): bigint | null {
  if (!isCampaignEvent(event.name)) return null;
  const parsed = uint.safeParse(event.args.id);
  return parsed.success ? parsed.data : null;
}

interface CampaignRow {
  id: string;
  instrument: string;
  status: string;
}

/** The campaign whose on-chain id is `onchainId`, locked for the rest of the transaction. */
async function lockCampaign(sql: Queryable, onchainId: bigint): Promise<CampaignRow | undefined> {
  const rows = await sql<CampaignRow[]>`
    select id, instrument, status from campaigns
    where onchain_id = ${onchainId.toString()}::bigint
    for update
  `;
  return rows[0];
}

/** The time an event happened: its block's, or when it was stored if the block was not read. */
function eventTime(event: StoredChainEvent): Date {
  return event.blockTime ?? event.createdAt;
}

/** Secret of the `/t/<token>` link of a ticket the projector creates (at least 16 characters). */
function newAccessToken(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Sets the exposure of an instrument to the quantity of the lots of its unsettled campaigns
 * (HE-1, HE-3: every campaign on the instrument shares one position). Recomputed rather than
 * incremented, so applying an event twice, or replaying every event, gives the same value.
 * `create` inserts the position when the instrument has none yet (venue `paper` by default).
 *
 * The position row is locked before the sum is computed, in a separate statement: under READ
 * COMMITTED a statement that waited for the lock takes a new snapshot, so two transactions that
 * project events of two campaigns on the same instrument at once cannot both write a sum that
 * misses the other's lot.
 */
async function refreshExposure(sql: Queryable, instrument: string, create: boolean): Promise<void> {
  if (create) {
    await sql`
      insert into positions (instrument) values (${instrument})
      on conflict (instrument) do nothing
    `;
  }
  await sql`select instrument from positions where instrument = ${instrument} for update`;
  await sql`
    update positions
    set exposure = (
      select coalesce(sum(l.qty), 0)::bigint
      from lots l
      join campaigns c on c.id = l.campaign_id
      where l.instrument = ${instrument} and c.status not in ('settled_yes', 'settled_no', 'void', 'closed')
    )
    where instrument = ${instrument}
  `;
}

/**
 * Writes the public row of a campaign that has a slug: its sale state and outcome as stored on
 * the campaign, units sold, the sum of the refundable amounts of its tickets, and the share of
 * its lots' quantity that is filled, in basis points rounded down.
 */
async function refreshLiveCampaign(sql: Queryable, campaignId: string): Promise<void> {
  await sql`
    insert into live_campaigns (slug, sale_state, sales, exposure, hedged_bps, outcome)
    select
      c.slug,
      c.sale_state,
      coalesce((select sum(t.qty) from tickets t where t.campaign_id = c.id), 0)::integer,
      coalesce((select sum(t.refundable) from tickets t where t.campaign_id = c.id), 0)::bigint,
      coalesce((
        select floor(sum(l.filled_qty) * 10000 / nullif(sum(l.qty), 0))
        from lots l where l.campaign_id = c.id
      ), 0)::integer,
      c.outcome
    from campaigns c
    where c.id = ${campaignId} and c.slug is not null
    on conflict (slug) do update
      set sale_state = excluded.sale_state,
          sales = excluded.sales,
          exposure = excluded.exposure,
          hedged_bps = excluded.hedged_bps,
          outcome = excluded.outcome
  `;
}

/**
 * Hedge budget deposited for a campaign: the budget of its `CampaignCreated` plus every
 * `BudgetToppedUp` of the campaign in `chain_events`, whatever their position. Derived from
 * `chain_events` rather than added to the stored budget, so applying a top-up twice cannot count
 * it twice, and a top-up that reaches `chain_events` after a later one (the three sources do not
 * arrive in chain order) cannot erase the later one: the result does not depend on the order in
 * which the events are applied.
 */
async function depositedBudget(sql: Queryable, onchainId: bigint): Promise<bigint | null> {
  const rows = await sql<{ created: string | null; topped: string }[]>`
    select
      (
        select (args ->> 'budget')::numeric(78, 0)::text
        from chain_events
        where name = 'CampaignCreated' and args ->> 'id' = ${onchainId.toString()}
        order by block_number, log_index
        limit 1
      ) as created,
      (
        select coalesce(sum((args ->> 'amount')::numeric(78, 0)), 0)::text
        from chain_events
        where name = 'BudgetToppedUp' and args ->> 'id' = ${onchainId.toString()}
      ) as topped
  `;
  const row = rows[0];
  if (row?.created === null || row?.created === undefined) return null;
  return BigInt(row.created) + BigInt(row.topped);
}

/**
 * Whether a campaign is paused on-chain, as far as `chain_events` knows: the `paused` argument
 * of its last `CampaignPaused` in chain order, or null when it has none. Read from every stored
 * event rather than from the event being applied, so a pause that reaches `chain_events` after
 * a later resume was projected cannot leave a live campaign paused.
 */
async function latestPauseState(sql: Queryable, onchainId: bigint): Promise<boolean | null> {
  const rows = await sql<{ paused: boolean | null }[]>`
    select (args ->> 'paused')::boolean as paused
    from chain_events
    where name = 'CampaignPaused' and args ->> 'id' = ${onchainId.toString()}
    order by block_number desc, log_index desc
    limit 1
  `;
  return rows[0]?.paused ?? null;
}

/**
 * Applies one escrow event to the database (SPEC HE-1, HE-3, 9.5, EC-7), inside the caller's
 * transaction. Idempotent: applying the same event again leaves every row as it was. Independent
 * of arrival order: the three sources do not write `chain_events` in chain order, so every value
 * an event sets (budget, pause state, exposure, the public row) is derived from all the stored
 * events or rows of its campaign, never from the event alone on top of what was there. It never
 * touches `chain_events.processed_at`; that is the caller's (see `ChainProjector`).
 *
 * An event that concerns a campaign whose `onchain_id` is not written yet (the creation job
 * writes it from its own receipt, which can come after the log) is `deferred` and changes
 * nothing. Throws `InvalidEventArgsError` or `ProjectionError` when the event cannot be applied;
 * the caller's transaction must then be rolled back.
 */
export async function projectChainEvent(
  sql: Queryable,
  event: StoredChainEvent,
): Promise<ProjectionOutcome> {
  if (!isCampaignEvent(event.name)) {
    return {
      status: "ignored",
      campaignOnchainId: null,
      reason: NO_PROJECTION_EVENTS.has(event.name) ? "no projection" : "unknown event",
    };
  }
  const name: CampaignEventName = event.name;
  const onchainId = parseArgs(name, event).id;
  const campaign = await lockCampaign(sql, onchainId);

  if (name === "MerchantPaid" || name === "CampaignReleased") {
    // Money moved on-chain; nothing of it is stored off-chain.
    if (campaign) await refreshLiveCampaign(sql, campaign.id);
    return { status: "ignored", campaignOnchainId: onchainId, reason: "no projection" };
  }
  if (!campaign) {
    return {
      status: "deferred",
      campaignOnchainId: onchainId,
      reason: `no campaign with onchain_id ${onchainId.toString()} yet`,
    };
  }

  switch (name) {
    case "CampaignCreated": {
      await sql`
        update campaigns
        set status = case when status in ('draft', 'funding') then 'live' else status end,
            live_at = coalesce(live_at, ${eventTime(event)})
        where id = ${campaign.id}
      `;
      break;
    }
    case "BudgetToppedUp": {
      const budget = await depositedBudget(sql, onchainId);
      if (budget === null) {
        throw new ProjectionError(
          event.name,
          event.txHash,
          event.logIndex,
          `the CampaignCreated of campaign ${onchainId.toString()} is not in chain_events yet`,
        );
      }
      await sql`
        update campaigns set budget = ${budget.toString()}::bigint where id = ${campaign.id}
      `;
      break;
    }
    case "TicketPurchased": {
      await projectTicketPurchased(sql, event, campaign);
      break;
    }
    case "CampaignPaused": {
      const args = parseArgs("CampaignPaused", event);
      // The last pause or resume on-chain, not the one being applied (see latestPauseState). The
      // event's own value stands in when it is not stored (a caller projecting it directly).
      const paused = (await latestPauseState(sql, onchainId)) ?? args.paused;
      // Never touches a campaign past its sales (CA-4: Live ⇄ Paused → SalesClosed → Settled):
      // the contract refuses a pause or resume after salesClose, so a pause event that reaches
      // the projection late must not reopen a campaign whose sales are closed or settled.
      await sql`
        update campaigns
        set status = ${paused ? "paused" : "live"}
        where id = ${campaign.id}
          and status not in ('sales_closed', 'settled_yes', 'settled_no', 'void', 'closed')
      `;
      break;
    }
    case "SalesClosedEarly": {
      const { salesClose } = parseArgs("SalesClosedEarly", event);
      const closesAt = new Date(Number(salesClose) * 1000);
      await sql`update campaigns set sales_close = ${closesAt} where id = ${campaign.id}`;
      break;
    }
    case "HedgeCharged": {
      const { ticketId, amount } = parseArgs("HedgeCharged", event);
      const rows = await sql<{ id: string }[]>`
        update lots
        set charged = true, charged_amount = ${amount.toString()}::bigint
        from tickets
        where lots.ticket_id = tickets.id and tickets.onchain_id = ${ticketId.toString()}::bigint
        returning lots.id
      `;
      if (rows.length === 0) {
        throw new ProjectionError(
          event.name,
          event.txHash,
          event.logIndex,
          `ticket ${ticketId.toString()} has no lot`,
        );
      }
      break;
    }
    case "CampaignSettled": {
      const { outcome } = parseArgs("CampaignSettled", event);
      const result = OUTCOMES[outcome];
      if (result === undefined) {
        throw new InvalidEventArgsError(event.name, event.txHash, event.logIndex, "outcome");
      }
      await sql`
        update campaigns
        set status = ${result.status}, outcome = ${result.outcome}
        where id = ${campaign.id} and status <> 'closed'
      `;
      await refreshExposure(sql, campaign.instrument, false);
      break;
    }
    case "TicketRefunded": {
      const { ticketId } = parseArgs("TicketRefunded", event);
      const rows = await sql<{ id: string }[]>`
        update tickets
        set status = 'refunded', refunded_at = ${eventTime(event)}
        where onchain_id = ${ticketId.toString()}::bigint
        returning id
      `;
      if (rows.length === 0) {
        throw new ProjectionError(
          event.name,
          event.txHash,
          event.logIndex,
          `ticket ${ticketId.toString()} is not projected`,
        );
      }
      break;
    }
    case "RefundFailed": {
      const { ticketId } = parseArgs("RefundFailed", event);
      // A refund that succeeded later wins: a failure never overwrites `refunded`.
      const rows = await sql<{ status: string }[]>`
        update tickets
        set status = case when status = 'refunded' then status else 'refund_failed' end
        where onchain_id = ${ticketId.toString()}::bigint
        returning status
      `;
      if (rows.length === 0) {
        throw new ProjectionError(
          event.name,
          event.txHash,
          event.logIndex,
          `ticket ${ticketId.toString()} is not projected`,
        );
      }
      break;
    }
  }
  await refreshLiveCampaign(sql, campaign.id);
  return { status: "applied", campaignOnchainId: onchainId };
}

/**
 * Upserts the ticket (keyed by its on-chain id; the columns other writers own, `payment_pi`,
 * `access_token` and `quote_nonce`, are never overwritten), creates its lot of `refundable`
 * micro-contracts (1 micro-USDC of exposure = 1 micro-contract, SPEC 9.2) and adds it to the
 * exposure of the instrument.
 */
async function projectTicketPurchased(
  sql: Queryable,
  event: StoredChainEvent,
  campaign: CampaignRow,
): Promise<void> {
  const args = parseArgs("TicketPurchased", event);
  if (args.qty < 1n || args.qty > 2_147_483_647n) {
    throw new InvalidEventArgsError(event.name, event.txHash, event.logIndex, "qty out of range");
  }
  const tickets = await sql<{ id: string }[]>`
    insert into tickets (
      onchain_id, campaign_id, buyer, qty, paid, refundable, max_hedge_cost, status,
      access_token, tx_hash, purchased_at
    )
    values (
      ${args.ticketId.toString()}::bigint, ${campaign.id}, ${args.buyer}, ${Number(args.qty)},
      ${args.paid.toString()}::bigint, ${args.refundable.toString()}::bigint,
      ${args.maxHedgeCost.toString()}::bigint, 'issued', ${newAccessToken()},
      ${event.txHash.toLowerCase()}, ${eventTime(event)}
    )
    on conflict (onchain_id) do update
      set campaign_id = excluded.campaign_id,
          buyer = excluded.buyer,
          qty = excluded.qty,
          paid = excluded.paid,
          refundable = excluded.refundable,
          max_hedge_cost = excluded.max_hedge_cost,
          tx_hash = excluded.tx_hash,
          purchased_at = excluded.purchased_at
    returning id
  `;
  const ticket = tickets[0];
  if (ticket === undefined) {
    throw new ProjectionError(event.name, event.txHash, event.logIndex, "ticket upsert failed");
  }
  await sql`
    insert into lots (seq, ticket_id, campaign_id, instrument, qty, max_hedge_cost)
    overriding system value
    values (
      ${lotSeq(event.blockNumber, event.logIndex).toString()}::bigint, ${ticket.id}, ${campaign.id},
      ${campaign.instrument}, ${args.refundable.toString()}::bigint,
      ${args.maxHedgeCost.toString()}::bigint
    )
    on conflict (ticket_id) do nothing
  `;
  await refreshExposure(sql, campaign.instrument, true);
}

interface ChainEventDbRow {
  tx_hash: string;
  log_index: number;
  block_number: bigint;
  block_time: Date | null;
  name: string;
  args: JsonObject;
  created_at: Date;
}

function toStoredEvent(row: ChainEventDbRow): StoredChainEvent {
  return {
    txHash: row.tx_hash as Hex,
    logIndex: row.log_index,
    blockNumber: row.block_number,
    blockTime: row.block_time,
    name: row.name,
    args: row.args,
    createdAt: row.created_at,
  };
}

export interface ChainProjectorOptions {
  /** Unprocessed events read per query. Default 500. */
  batchSize?: number;
}

export interface ProjectorPassResult {
  applied: number;
  ignored: number;
  /** Left unprocessed: campaign not known yet, or an earlier event of its campaign was. */
  deferred: number;
  /** Left unprocessed after an error; retried at the next pass. */
  failed: number;
}

/**
 * Applies the unprocessed rows of `chain_events` in `(block_number, log_index)` order, each in
 * its own transaction that also sets `processed_at`, so each event is applied exactly once.
 *
 * When an event is deferred or fails, the later events of the same campaign wait for the next
 * pass (their order matters), while the events of other campaigns go on.
 */
export class ChainProjector {
  private readonly batchSize: number;
  /** Events already reported as deferred, so the warning is logged once per event. */
  private readonly reportedDeferrals = new Set<string>();
  /**
   * Events whose projection failed, with the failure last logged for each. A failure is logged
   * at error level once, and again only when it changes, not at every pass.
   */
  private readonly reportedFailures = new Map<string, string>();

  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
    options: ChainProjectorOptions = {},
  ) {
    this.batchSize = options.batchSize ?? 500;
    if (!Number.isInteger(this.batchSize) || this.batchSize < 1) {
      throw new RangeError("ChainProjector: batchSize must be a positive integer");
    }
  }

  /** Events whose last projection attempt failed and that are still unprocessed. */
  get failingEvents(): number {
    return this.reportedFailures.size;
  }

  /** One pass over every unprocessed event. Never throws for one event; a query error throws. */
  async runPass(signal?: AbortSignal, onProgress?: () => void): Promise<ProjectorPassResult> {
    const result: ProjectorPassResult = { applied: 0, ignored: 0, deferred: 0, failed: 0 };
    const blocked = new Set<bigint>();
    let after: { blockNumber: bigint; logIndex: number } | null = null;

    for (;;) {
      const rows: ChainEventDbRow[] =
        after === null
          ? await this.db<ChainEventDbRow[]>`
              select tx_hash, log_index, block_number, block_time, name, args, created_at
              from chain_events
              where processed_at is null
              order by block_number, log_index
              limit ${this.batchSize}
            `
          : await this.db<ChainEventDbRow[]>`
              select tx_hash, log_index, block_number, block_time, name, args, created_at
              from chain_events
              where processed_at is null
                and (block_number, log_index) > (${after.blockNumber.toString()}::bigint, ${after.logIndex})
              order by block_number, log_index
              limit ${this.batchSize}
            `;
      for (const row of rows) {
        if (signal?.aborted === true) return result;
        const event = toStoredEvent(row);
        const campaignId = campaignOnchainIdOf(event);
        if (campaignId !== null && blocked.has(campaignId)) {
          result.deferred += 1;
          continue;
        }
        const key = `${event.txHash}:${event.logIndex.toString()}`;
        try {
          const outcome = await this.applyOne(event);
          if (outcome === null) {
            // Taken by another projector meanwhile, or already processed by it.
            this.reportedFailures.delete(key);
            continue;
          }
          const failedBefore = this.reportedFailures.delete(key);
          if (failedBefore && outcome.status !== "deferred") {
            this.logger.info(
              { event: event.name, txHash: event.txHash, logIndex: event.logIndex },
              "chain event projected after failing",
            );
          }
          if (outcome.status === "deferred") {
            result.deferred += 1;
            blocked.add(outcome.campaignOnchainId);
            if (!this.reportedDeferrals.has(key)) {
              this.reportedDeferrals.add(key);
              this.logger.warn(
                {
                  event: event.name,
                  txHash: event.txHash,
                  logIndex: event.logIndex,
                  reason: outcome.reason,
                },
                "chain event deferred until its campaign is known",
              );
            }
            continue;
          }
          this.reportedDeferrals.delete(key);
          if (outcome.status === "applied") result.applied += 1;
          else result.ignored += 1;
          if (outcome.status === "ignored" && outcome.reason === "unknown event") {
            this.logger.warn(
              { event: event.name, txHash: event.txHash, logIndex: event.logIndex },
              "chain event without a projection rule, marked processed",
            );
          }
        } catch (error: unknown) {
          result.failed += 1;
          if (campaignId !== null) blocked.add(campaignId);
          const summary = summarizeError(error);
          const signature = `${summary.type}: ${summary.message}`;
          if (this.reportedFailures.get(key) !== signature) {
            this.reportedFailures.set(key, signature);
            this.logger.error(
              {
                error: summary,
                event: event.name,
                txHash: event.txHash,
                logIndex: event.logIndex,
                failingEvents: this.reportedFailures.size,
              },
              "chain event projection failed, retried at every pass until it succeeds",
            );
          }
        }
      }
      onProgress?.();
      const last = rows[rows.length - 1];
      if (rows.length < this.batchSize || last === undefined) break;
      after = { blockNumber: last.block_number, logIndex: last.log_index };
    }
    return result;
  }

  /** Projects one event and marks it processed, in one transaction. Null if already taken. */
  private async applyOne(event: StoredChainEvent): Promise<ProjectionOutcome | null> {
    return this.db.begin(async (tx) => {
      const locked = await tx<{ log_index: number }[]>`
        select log_index from chain_events
        where tx_hash = ${event.txHash} and log_index = ${event.logIndex} and processed_at is null
        for update skip locked
      `;
      if (locked.length === 0) return null;
      const outcome = await projectChainEvent(tx, event);
      if (outcome.status !== "deferred") {
        await tx`
          update chain_events set processed_at = now()
          where tx_hash = ${event.txHash} and log_index = ${event.logIndex}
        `;
      }
      return outcome;
    });
  }
}
