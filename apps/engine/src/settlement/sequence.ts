import type { Logger } from "pino";
import { decodeFunctionData, encodeFunctionData, type Address, type Hex } from "viem";

import { REFUND_BATCH_SIZE, winzEscrowAbi } from "@winz/shared";

import type { Clock, DecodedEvent } from "../chain";
import { summarizeError } from "../chain";
import type { Db } from "../db";
import { FinalizeTimeoutError, SettlementAbortedError, SettlementStepError } from "./errors";
import type { EscrowReader, OnchainCampaign } from "./escrow-reader";
import {
  campaignKeyPrefix,
  chargeKeyBase,
  chunk,
  compareBigint,
  ESCROW_STATUS,
  isSettledStatus,
  ONCHAIN_OUTCOME,
  outcomeOfStatus,
  payMerchantKeyBase,
  refundKeyBase,
  releaseKeyBase,
  retryDelayMs,
  safetyNetCharge,
  settleKeyBase,
} from "./plan";
import {
  isTreasuryFailure,
  revertName,
  type StepResult,
  type StepRunner,
  type StepSpec,
} from "./steps";
import { knownTickets, markDemo, openChargeTxs, stepTxs, type KnownTicket } from "./store";
import type {
  CampaignSettlementResult,
  CampaignSettlementStatus,
  HedgeFinalizer,
  SettlementCampaign,
  SettlementStep,
  SettlementStepEvent,
} from "./types";

/** Tickets per `chargeHedge` sent by the safety net. */
export const CHARGE_BATCH_SIZE = 50;

/** `getTicket` reads in flight at once while checking which tickets are still uncharged. */
const TICKET_READ_CONCURRENCY = 16;

export interface SettlerSettings {
  maxAttempts: number;
  txWaitTimeoutMs: number;
  refundRetryBaseMs: number;
  refundRetryMaxMs: number;
  treasuryRetryBaseMs: number;
  treasuryRetryMaxMs: number;
  finalizeFailuresBeforeSafetyNet: number;
  finalizeTimeoutMs: number;
}

export interface SettlerDeps {
  db: Db;
  reader: EscrowReader;
  steps: StepRunner;
  escrow: Address;
  hedgeFinalizer: HedgeFinalizer;
  logger: Logger;
  clock: Clock;
  signal: AbortSignal;
  settings: SettlerSettings;
  onStep?: (event: SettlementStepEvent) => void | Promise<void>;
}

interface RetryState {
  failures: number;
  nextAtMs: number;
}

/** Ends a run early with a result: a condition the next pass looks at again, not a failure. */
class StopRun extends Error {
  constructor(
    readonly status: CampaignSettlementStatus,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "StopRun";
  }
}

/**
 * Waits for `promise`, at most `timeoutMs`, and no longer than until `signal` aborts. Resolves
 * "done" or "timeout" or "aborted"; rejects when `promise` rejects first. The promise itself is
 * left running either way.
 */
async function within(
  promise: Promise<void>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<"done" | "timeout" | "aborted"> {
  if (signal.aborted) return "aborted";
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  const limit = new Promise<"timeout" | "aborted">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
    onAbort = (): void => resolve("aborted");
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([promise.then((): "done" => "done"), limit]);
  } finally {
    clearTimeout(timer);
    if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
  }
}

/** Maps `items` through `fn`, at most `limit` calls in flight, results in input order. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * The tickets a `chargeHedge` call charges, decoded from its call data; null when the data is not
 * a `chargeHedge` call of the escrow (it then cannot charge any ticket).
 */
function chargedTicketIds(data: string): bigint[] | null {
  try {
    const call = decodeFunctionData({ abi: winzEscrowAbi, data: data as Hex });
    if (call.functionName !== "chargeHedge") return null;
    const [ticketIds] = call.args;
    return [...ticketIds];
  } catch {
    return null;
  }
}

function eventTicketId(event: DecodedEvent): bigint | null {
  const value = event.args.ticketId;
  if (typeof value === "string" && /^[0-9]+$/.test(value)) return BigInt(value);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  return null;
}

/**
 * The settlement sequence of one campaign (steps a to e), resumable from any point: every
 * decision is taken from the chain (`getCampaign`, `getTicket`) and from the watcher's own
 * transactions in the outbox, never from the projection alone.
 *
 * One instance serves every campaign and keeps the in-memory retry schedules (refunds that
 * failed, a treasury that could not pay, a hedge finalizer that failed). They are delays only:
 * after a restart each one is simply tried once more at once.
 */
export class CampaignSettler {
  private readonly finalizeFailures = new Map<string, number>();
  /** Finalizer calls not answered yet, by campaign: never called again while one is pending. */
  private readonly pendingFinalize = new Map<string, Promise<void>>();
  private readonly refundRetries = new Map<string, RetryState>();
  private readonly treasuryRetries = new Map<string, RetryState>();
  /** Conditions logged once per process rather than at every pass. */
  private readonly reported = new Set<string>();

  constructor(private readonly deps: SettlerDeps) {}

  /**
   * Runs the sequence once. Resolves with where the campaign stands; rejects with
   * `SettlementStepError` when a read, a write or the hedge finalizer throws, and with
   * `SettlementAbortedError` when the watcher stops in the middle.
   */
  async run(campaign: SettlementCampaign): Promise<CampaignSettlementResult> {
    const context = { step: "settle" as SettlementStep };
    const log = this.deps.logger.child({
      campaignId: campaign.id,
      onchainId: campaign.onchainId.toString(),
    });
    try {
      return await this.sequence(campaign, context, log);
    } catch (error: unknown) {
      if (error instanceof StopRun) {
        return this.result(campaign, error.status, error.detail, []);
      }
      if (error instanceof SettlementAbortedError || this.deps.signal.aborted) {
        throw new SettlementAbortedError();
      }
      throw new SettlementStepError(campaign.id, campaign.onchainId, context.step, error);
    }
  }

  private result(
    campaign: SettlementCampaign,
    status: CampaignSettlementStatus,
    detail: string,
    owedTickets: bigint[],
  ): CampaignSettlementResult {
    return { campaignId: campaign.id, onchainId: campaign.onchainId, status, detail, owedTickets };
  }

  private checkAbort(): void {
    if (this.deps.signal.aborted) throw new SettlementAbortedError();
  }

  private async emit(
    campaign: SettlementCampaign,
    step: SettlementStep,
    phase: "enqueued" | "done",
  ): Promise<void> {
    if (this.deps.onStep !== undefined) {
      await this.deps.onStep({
        campaignId: campaign.id,
        onchainId: campaign.onchainId,
        step,
        phase,
      });
    }
    this.checkAbort();
  }

  private reportOnce(key: string, report: () => void): void {
    if (this.reported.has(key)) return;
    this.reported.add(key);
    report();
  }

  private nowMs(): number {
    return this.deps.clock.now().getTime();
  }

  private async sequence(
    campaign: SettlementCampaign,
    context: { step: SettlementStep },
    log: Logger,
  ): Promise<CampaignSettlementResult> {
    const { reader } = this.deps;
    const prefix = campaignKeyPrefix(this.deps.escrow, campaign.onchainId);
    let onchain = await reader.getCampaign(campaign.onchainId);

    if (!isSettledStatus(onchain.status)) {
      const chainNow = await reader.latestTimestamp();
      if (chainNow < onchain.salesClose) {
        throw new StopRun("not-ready", "sales are still open on-chain");
      }
      const delay = await reader.emergencyDelay();
      if (onchain.released || chainNow >= onchain.salesClose + delay) {
        this.reportOnce(`emergency:${campaign.id}`, () =>
          log.error(
            {
              step: "settle",
              salesClose: onchain.salesClose.toString(),
              chainTime: chainNow.toString(),
              emergencyDelay: delay.toString(),
              released: onchain.released,
            },
            "the emergency window is open: settle is not sent, the emergency exits are the only path",
          ),
        );
        throw new StopRun("emergency", "the emergency window is open");
      }

      // a. Hedge charges: the hedging lane first, then the safety net.
      context.step = "finalize";
      await this.finalizeHedges(campaign, log);
      context.step = "charge";
      await this.chargeUncharged(campaign, prefix, log);

      onchain = await reader.getCampaign(campaign.onchainId);
      if (!isSettledStatus(onchain.status)) {
        context.step = "settle";
        await this.checkReadyToSettle(campaign, onchain, log);
        await this.settle(campaign, prefix, log);
        onchain = await reader.getCampaign(campaign.onchainId);
        if (!isSettledStatus(onchain.status)) {
          throw new StopRun("in-progress", "settle is not final on-chain yet");
        }
      }
    }

    const outcome = outcomeOfStatus(onchain.status);
    if (outcome !== null && outcome !== campaign.outcome) {
      this.reportOnce(`outcome:${campaign.id}`, () =>
        log.warn(
          { onchainOutcome: outcome, knownOutcome: campaign.outcome },
          "the campaign is settled on-chain with another result than the one known now; the chain's stands",
        ),
      );
    }

    // c. Refunds, YES only.
    let owed: KnownTicket[] = [];
    if (onchain.status === ESCROW_STATUS.settledYes) {
      context.step = "refund";
      owed = await this.refund(campaign, prefix, log);
    }

    // d. What the treasury owes the merchant. Never blocks refunds or release.
    context.step = "pay-merchant";
    if (onchain.merchantDue > 0n)
      await this.payMerchant(campaign, onchain.merchantDue, prefix, log);

    // e. Release, once.
    context.step = "release";
    if (!onchain.released) await this.release(campaign, prefix, log);

    const final = await reader.getCampaign(campaign.onchainId);
    const owedIds = owed.map((ticket) => ticket.ticketId);
    const refundsSettled =
      final.status !== ESCROW_STATUS.settledYes ||
      final.lockedRefunds === 0n ||
      (owed.length > 0 && owed.every((ticket) => this.hasFailedRefund(campaign, ticket)));
    if (final.released && final.merchantDue === 0n && refundsSettled) {
      const detail =
        owed.length > 0
          ? `finished; ${owed.length.toString()} ticket(s) still owed, their refund keeps failing`
          : "finished";
      return this.result(campaign, "finished", detail, owedIds);
    }
    const left: string[] = [];
    if (!final.released) left.push("release");
    if (final.merchantDue > 0n) left.push("payMerchant");
    if (!refundsSettled) left.push("refunds");
    return this.result(campaign, "in-progress", `left: ${left.join(", ")}`, owedIds);
  }

  // -------------------------------------------------------------------------------------------
  // a. Hedge charges
  // -------------------------------------------------------------------------------------------

  /**
   * The finalizer's call for this campaign: the one still pending from an earlier pass, or a new
   * one. A call is forgotten once it settles, whether this pass still waits for it or not.
   */
  private finalizerCall(campaign: SettlementCampaign): Promise<void> {
    const pending = this.pendingFinalize.get(campaign.id);
    if (pending !== undefined) return pending;
    const call = (async (): Promise<void> => this.deps.hedgeFinalizer.finalize(campaign))();
    this.pendingFinalize.set(campaign.id, call);
    const forget = (): void => {
      if (this.pendingFinalize.get(campaign.id) === call) this.pendingFinalize.delete(campaign.id);
    };
    // Observed here, so a call nobody waits for any more never rejects unhandled.
    call.then(forget, forget);
    return call;
  }

  /**
   * Calls the hedging lane, waiting at most `finalizeTimeoutMs` and never past the watcher's stop;
   * after repeated failures (a call that did not answer in time is one), lets the safety net
   * charge without it.
   */
  private async finalizeHedges(campaign: SettlementCampaign, log: Logger): Promise<void> {
    try {
      const timeoutMs = this.deps.settings.finalizeTimeoutMs;
      const answer = await within(this.finalizerCall(campaign), timeoutMs, this.deps.signal);
      if (answer === "aborted") throw new SettlementAbortedError();
      if (answer === "timeout") throw new FinalizeTimeoutError(campaign.id, timeoutMs);
      this.finalizeFailures.delete(campaign.id);
    } catch (error: unknown) {
      this.checkAbort();
      const failures = (this.finalizeFailures.get(campaign.id) ?? 0) + 1;
      this.finalizeFailures.set(campaign.id, failures);
      const limit = this.deps.settings.finalizeFailuresBeforeSafetyNet;
      if (failures < limit) {
        log.error(
          { step: "finalize", error: summarizeError(error), failures, limit },
          "the hedge finalizer failed, settlement retried at a later pass",
        );
        throw new StopRun("not-ready", "the hedge finalizer failed");
      }
      log.error(
        { step: "finalize", error: summarizeError(error), failures, limit },
        "the hedge finalizer keeps failing: the safety net charges the hedges without it",
      );
    }
    await this.emit(campaign, "finalize", "done");
  }

  /**
   * The safety net: every ticket still uncharged on-chain is charged its lot's cost capped at the
   * guarantee, or zero when its hedge was never allocated, in batches of 50. Its own batches of a
   * previous run are waited for first, then every other charge of the campaign's tickets still in
   * the outbox (`waitForOtherCharges`); the tickets are read after both.
   */
  private async chargeUncharged(
    campaign: SettlementCampaign,
    prefix: string,
    log: Logger,
  ): Promise<void> {
    const { reader } = this.deps;
    if ((await this.waitInFlight(`${prefix}:charge:`)).unfinished > 0) {
      throw new StopRun("in-progress", "hedge charges of a previous run are not final yet");
    }
    await this.waitForOtherCharges(campaign, log);
    const tickets = await knownTickets(this.deps.db, campaign.onchainId);
    const suspects = tickets.filter((ticket) => !ticket.charged);
    if (suspects.length === 0) return;

    const onchainTickets = await mapLimit(suspects, TICKET_READ_CONCURRENCY, (ticket) =>
      reader.getTicket(ticket.ticketId),
    );
    const charges: { ticketId: bigint; amount: bigint }[] = [];
    suspects.forEach((ticket, index) => {
      const onchainTicket = onchainTickets[index];
      if (onchainTicket === undefined || onchainTicket.hedgeCharged) return;
      if (onchainTicket.campaignId !== campaign.onchainId) {
        log.error(
          {
            step: "charge",
            ticketId: ticket.ticketId.toString(),
            onchainCampaign: onchainTicket.campaignId.toString(),
          },
          "a ticket stored for this campaign belongs to another one on-chain; left out",
        );
        return;
      }
      const charge = safetyNetCharge(onchainTicket.maxHedgeCost, {
        cost: ticket.lotCost,
        filledQty: ticket.lotFilledQty,
        maxHedgeCost: ticket.lotMaxHedgeCost,
      });
      if (!charge.allocated) {
        this.reportOnce(`zero:${campaign.onchainId.toString()}:${ticket.ticketId.toString()}`, () =>
          log.error(
            {
              step: "charge",
              ticketId: ticket.ticketId.toString(),
              guarantee: onchainTicket.maxHedgeCost.toString(),
              lot: ticket.lotCost === null ? "missing" : "never allocated",
            },
            "hedge never allocated to this ticket: charged zero, the merchant pays nothing for it and the platform bears its hedge",
          ),
        );
      }
      charges.push({ ticketId: ticket.ticketId, amount: charge.amount });
    });
    if (charges.length === 0) return;

    charges.sort((a, b) => compareBigint(a.ticketId, b.ticketId));
    const specs = chunk(charges, CHARGE_BATCH_SIZE).map((batch): StepSpec => {
      const ticketIds = batch.map((charge) => charge.ticketId);
      const amounts = batch.map((charge) => charge.amount);
      return {
        base: chargeKeyBase(prefix, ticketIds, amounts),
        maxAttempts: this.deps.settings.maxAttempts,
        request: {
          signer: "oracle",
          kind: "chargeHedge",
          to: this.deps.escrow,
          data: encodeFunctionData({
            abi: winzEscrowAbi,
            functionName: "chargeHedge",
            args: [ticketIds, amounts],
          }),
          payload: {
            campaignOnchainId: campaign.onchainId.toString(),
            source: "settlement-safety-net",
            ticketIds: ticketIds.map(String),
            amounts: amounts.map(String),
          },
        },
      };
    });
    const results = await this.sendAll(campaign, "charge", specs);
    const unfinished = this.reportFailures(campaign, "charge", results, log);
    if (unfinished > 0) {
      throw new StopRun("in-progress", "hedge charges are not all final");
    }
    await this.emit(campaign, "charge", "done");
  }

  /**
   * Waits for every `chargeHedge` still `queued` or `sent` in the outbox that holds a ticket of
   * this campaign the chain events do not show charged, whoever enqueued it: once the hedge
   * finalizer has failed, the hedging lane may still have one in flight. A charge simulated while
   * another one holding the same ticket is in flight passes its simulation (the latest block does
   * not hold the other one) and reverts on-chain with `HedgeAlreadyCharged`, gas paid; waited for,
   * the tickets it charged are read back charged and left out of the batches.
   *
   * The hedging lane's rows name neither their campaign nor, in their key, their tickets: the
   * tickets are decoded from the call data (`chargeHedge(ticketIds, amounts)`), the transaction
   * itself, and matched against the campaign's tickets (ticket ids are the escrow's, unique across
   * campaigns). Data that is not a `chargeHedge` call cannot charge any ticket and is left out.
   *
   * Each wait is the step's own (`txWaitTimeoutMs`), all at once. A charge still not final then
   * is left as it is and the safety net goes on as without this wait: a ticket it holds may then
   * be charged twice, the second charge reverting with `HedgeAlreadyCharged`.
   */
  private async waitForOtherCharges(campaign: SettlementCampaign, log: Logger): Promise<void> {
    const tickets = await knownTickets(this.deps.db, campaign.onchainId);
    const uncharged = new Set(
      tickets.filter((ticket) => !ticket.charged).map((ticket) => ticket.ticketId),
    );
    if (uncharged.size === 0) return;
    const holding: { id: string; key: string; tickets: bigint[] }[] = [];
    for (const row of await openChargeTxs(this.deps.db)) {
      const charged = chargedTicketIds(row.data);
      if (charged === null) {
        this.reportOnce(`undecodable-charge:${row.id}`, () =>
          log.warn(
            { step: "charge", txId: row.id, idempotencyKey: row.idempotencyKey },
            "a chargeHedge of the outbox does not decode as a chargeHedge call; it cannot charge a ticket, not waited for",
          ),
        );
        continue;
      }
      const ours = charged.filter((ticketId) => uncharged.has(ticketId));
      if (ours.length > 0) holding.push({ id: row.id, key: row.idempotencyKey, tickets: ours });
    }
    if (holding.length === 0) return;
    const fields = {
      step: "charge",
      txIds: holding.map((entry) => entry.id),
      tickets: holding.flatMap((entry) => entry.tickets.map(String)),
    };
    log.info(
      fields,
      "charges of this campaign's tickets are still in the outbox: the safety net waits for them before cutting its batches",
    );
    const outcomes = await Promise.all(holding.map((entry) => this.deps.steps.waitForTx(entry.id)));
    this.checkAbort();
    const unfinished = holding.filter((_, index) => outcomes[index] === null);
    if (unfinished.length > 0) {
      log.warn(
        {
          ...fields,
          unfinished: unfinished.map((entry) => entry.id),
          waitMs: this.deps.settings.txWaitTimeoutMs,
        },
        "charges of this campaign's tickets are not final within the wait: the safety net charges without them, a ticket they hold may revert HedgeAlreadyCharged",
      );
    }
  }

  /**
   * `settle` needs every reservation released; the sum of the refundable amounts of the tickets
   * the database knows must also be what the escrow locks, or a ticket is missing from the lists
   * the refunds are built from. Either way the projection catches up and a later pass settles.
   */
  private async checkReadyToSettle(
    campaign: SettlementCampaign,
    onchain: OnchainCampaign,
    log: Logger,
  ): Promise<void> {
    if (onchain.hedgeReserved !== 0n) {
      log.warn(
        { step: "settle", hedgeReserved: onchain.hedgeReserved.toString() },
        "hedge reservations remain on-chain for tickets the database does not know yet; settle waits",
      );
      throw new StopRun("not-ready", "hedge reservations remain on-chain");
    }
    const tickets = await knownTickets(this.deps.db, campaign.onchainId);
    const known = tickets.reduce((sum, ticket) => sum + ticket.refundable, 0n);
    if (known !== onchain.lockedRefunds) {
      log.warn(
        {
          step: "settle",
          knownRefundable: known.toString(),
          lockedRefunds: onchain.lockedRefunds.toString(),
          knownTickets: tickets.length,
        },
        "the database does not know every ticket of the campaign yet; settle waits",
      );
      throw new StopRun("not-ready", "tickets missing from the database");
    }
  }

  // -------------------------------------------------------------------------------------------
  // b. Settle
  // -------------------------------------------------------------------------------------------

  private async settle(campaign: SettlementCampaign, prefix: string, log: Logger): Promise<void> {
    if (campaign.forced && (await markDemo(this.deps.db, campaign.id))) {
      log.info(
        { outcome: campaign.outcome },
        "settled on a forced demo result: campaign marked demo",
      );
    }
    // A settle of an earlier run, on whatever result was known then, is waited for first: a
    // result that changed meanwhile must not put a second settle in the outbox.
    const inFlight = await this.waitInFlight(`${prefix}:settle:`);
    if (inFlight.unfinished > 0) {
      throw new StopRun("in-progress", "a settle of a previous run is not final yet");
    }
    if (inFlight.mined.length > 0) {
      await this.emit(campaign, "settle", "done");
      return;
    }
    const spec: StepSpec = {
      base: settleKeyBase(prefix, campaign.outcome),
      maxAttempts: this.deps.settings.maxAttempts,
      request: {
        signer: "oracle",
        kind: "settle",
        to: this.deps.escrow,
        data: encodeFunctionData({
          abi: winzEscrowAbi,
          functionName: "settle",
          args: [campaign.onchainId, ONCHAIN_OUTCOME[campaign.outcome]],
        }),
        payload: {
          campaignOnchainId: campaign.onchainId.toString(),
          outcome: campaign.outcome,
          forced: campaign.forced,
        },
      },
    };
    const [result] = await this.sendAll(campaign, "settle", [spec]);
    if (result === undefined) throw new StopRun("in-progress", "settle was not sent");
    if (result.kind === "mined") {
      await this.emit(campaign, "settle", "done");
      return;
    }
    if (result.kind === "unfinished") throw new StopRun("in-progress", "settle is not mined yet");
    if (result.kind === "exhausted") {
      this.reportExhausted(campaign, "settle", result.attempts, result.lastError, log);
      throw new StopRun("in-progress", `settle given up: ${result.lastError}`);
    }
    const error = revertName(result.outcome.error);
    if (error === "AlreadySettled") {
      log.info({ step: "settle" }, "the campaign was already settled on-chain");
      await this.emit(campaign, "settle", "done");
      return;
    }
    if (error === "EmergencyActive") {
      log.error(
        { step: "settle", error },
        "the contract refused settle, the emergency window is open: the emergency exits are the only path",
      );
      throw new StopRun("emergency", "the contract answered EmergencyActive");
    }
    log.error(
      { step: "settle", error, txId: result.outcome.id, countsAsAttempt: result.countsAsAttempt },
      "settle failed, retried at a later pass",
    );
    throw new StopRun("in-progress", `settle failed: ${error}`);
  }

  // -------------------------------------------------------------------------------------------
  // c. Refunds
  // -------------------------------------------------------------------------------------------

  private retryKey(campaign: SettlementCampaign, ticketId: bigint): string {
    return `${campaign.onchainId.toString()}:${ticketId.toString()}`;
  }

  private hasFailedRefund(campaign: SettlementCampaign, ticket: KnownTicket): boolean {
    return (
      ticket.refundFailures > 0 || this.refundRetries.has(this.retryKey(campaign, ticket.ticketId))
    );
  }

  /**
   * Pushes every owed refund: the batches still in the outbox are waited for first, then every
   * ticket not refunded yet, in batches of 50 enqueued at once (the sender serialises them on the
   * relayer's key; nothing waits for one batch before sending the next). A ticket whose transfer
   * failed is retried on later passes with backoff, never holding the others. Returns the tickets
   * still owed.
   */
  private async refund(
    campaign: SettlementCampaign,
    prefix: string,
    log: Logger,
  ): Promise<KnownTicket[]> {
    const resumed = await this.waitInFlight(`${prefix}:refund:`);
    const before = await knownTickets(this.deps.db, campaign.onchainId);
    for (const outcome of resumed.mined) {
      this.recordRefundEvents(campaign, outcome.events, [], log);
    }
    if (resumed.unfinished > 0) {
      // Batches of a previous run are still in the outbox: nothing new is built on top of them
      // this time, and payMerchant and release go on.
      log.warn(
        { step: "refund", unfinished: resumed.unfinished },
        "refund batches of a previous run are not final yet, resumed at a later pass",
      );
      return before.filter((ticket) => !ticket.refunded);
    }

    const nowMs = this.nowMs();
    const owed = before.filter((ticket) => !ticket.refunded);
    const due = owed
      .filter((ticket) => {
        const retry = this.refundRetries.get(this.retryKey(campaign, ticket.ticketId));
        return retry === undefined || retry.nextAtMs <= nowMs;
      })
      .map((ticket) => ticket.ticketId)
      .sort(compareBigint);

    if (due.length > 0) {
      const specs = chunk(due, REFUND_BATCH_SIZE).map((batch): StepSpec => ({
        base: refundKeyBase(prefix, batch),
        maxAttempts: this.deps.settings.maxAttempts,
        newAttemptAfterMined: true,
        request: {
          signer: "relayer",
          kind: "refundBatch",
          to: this.deps.escrow,
          data: encodeFunctionData({
            abi: winzEscrowAbi,
            functionName: "refundBatch",
            args: [campaign.onchainId, batch],
          }),
          payload: {
            campaignOnchainId: campaign.onchainId.toString(),
            ticketIds: batch.map(String),
          },
        },
      }));
      const results = await this.sendAll(campaign, "refund", specs);
      for (const result of results) {
        if (result.kind === "mined") {
          this.recordRefundEvents(campaign, result.outcome.events, before, log);
        }
      }
      const unfinished = this.reportFailures(campaign, "refund", results, log);
      if (unfinished === 0) await this.emit(campaign, "refund", "done");
    }

    const after = await knownTickets(this.deps.db, campaign.onchainId);
    return after.filter((ticket) => !ticket.refunded);
  }

  /** Clears the retry of refunded tickets, schedules the retry of those whose transfer failed. */
  private recordRefundEvents(
    campaign: SettlementCampaign,
    events: readonly DecodedEvent[],
    known: readonly KnownTicket[],
    log: Logger,
  ): void {
    const { refundRetryBaseMs, refundRetryMaxMs } = this.deps.settings;
    for (const event of events) {
      const ticketId = eventTicketId(event);
      if (ticketId === null) continue;
      const key = this.retryKey(campaign, ticketId);
      if (event.name === "TicketRefunded") {
        this.refundRetries.delete(key);
      } else if (event.name === "RefundFailed") {
        const previous =
          this.refundRetries.get(key)?.failures ??
          known.find((ticket) => ticket.ticketId === ticketId)?.refundFailures ??
          0;
        const failures = previous + 1;
        const delay = retryDelayMs(failures, refundRetryBaseMs, refundRetryMaxMs);
        this.refundRetries.set(key, { failures, nextAtMs: this.nowMs() + delay });
        log.error(
          {
            step: "refund",
            ticketId: ticketId.toString(),
            failures,
            retryInMs: delay,
            txHash: event.txHash,
          },
          "refund transfer failed, the ticket stays owed and is retried later; the others go on",
        );
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // d. payMerchant
  // -------------------------------------------------------------------------------------------

  private scheduleTreasuryRetry(campaign: SettlementCampaign): number {
    const failures = (this.treasuryRetries.get(campaign.id)?.failures ?? 0) + 1;
    const delay = retryDelayMs(
      failures,
      this.deps.settings.treasuryRetryBaseMs,
      this.deps.settings.treasuryRetryMaxMs,
    );
    this.treasuryRetries.set(campaign.id, { failures, nextAtMs: this.nowMs() + delay });
    return delay;
  }

  private async payMerchant(
    campaign: SettlementCampaign,
    due: bigint,
    prefix: string,
    log: Logger,
  ): Promise<void> {
    const retry = this.treasuryRetries.get(campaign.id);
    if (retry !== undefined && retry.nextAtMs > this.nowMs()) return;

    // Checked before sending, so an empty treasury costs no transaction and no attempt.
    const funds = await this.deps.reader.treasuryFunds();
    if (funds.balance < due || funds.allowance < due) {
      const delay = this.scheduleTreasuryRetry(campaign);
      log.error(
        {
          step: "pay-merchant",
          due: due.toString(),
          treasury: funds.treasury,
          balance: funds.balance.toString(),
          allowance: funds.allowance.toString(),
          retryInMs: delay,
        },
        "the treasury cannot pay the merchant: payMerchant retried later, refunds and release go on",
      );
      return;
    }

    const spec: StepSpec = {
      base: payMerchantKeyBase(prefix),
      maxAttempts: this.deps.settings.maxAttempts,
      isTransient: isTreasuryFailure,
      request: {
        signer: "relayer",
        kind: "payMerchant",
        to: this.deps.escrow,
        data: encodeFunctionData({
          abi: winzEscrowAbi,
          functionName: "payMerchant",
          args: [campaign.onchainId],
        }),
        payload: { campaignOnchainId: campaign.onchainId.toString(), due: due.toString() },
      },
    };
    const [result] = await this.sendAll(campaign, "pay-merchant", [spec]);
    if (result === undefined) return;
    if (result.kind === "mined") {
      this.treasuryRetries.delete(campaign.id);
      await this.emit(campaign, "pay-merchant", "done");
      return;
    }
    if (result.kind === "failed") {
      const error = revertName(result.outcome.error);
      if (error === "NothingDue") {
        this.treasuryRetries.delete(campaign.id);
        await this.emit(campaign, "pay-merchant", "done");
        return;
      }
      if (isTreasuryFailure(result.outcome.error)) {
        const delay = this.scheduleTreasuryRetry(campaign);
        log.error(
          { step: "pay-merchant", error, due: due.toString(), retryInMs: delay },
          "the treasury could not pay the merchant: payMerchant retried later, refunds and release go on",
        );
        return;
      }
    }
    this.reportFailures(campaign, "pay-merchant", [result], log);
  }

  // -------------------------------------------------------------------------------------------
  // e. release
  // -------------------------------------------------------------------------------------------

  private async release(campaign: SettlementCampaign, prefix: string, log: Logger): Promise<void> {
    const spec: StepSpec = {
      base: releaseKeyBase(prefix),
      maxAttempts: this.deps.settings.maxAttempts,
      request: {
        signer: "relayer",
        kind: "release",
        to: this.deps.escrow,
        data: encodeFunctionData({
          abi: winzEscrowAbi,
          functionName: "release",
          args: [campaign.onchainId],
        }),
        payload: { campaignOnchainId: campaign.onchainId.toString() },
      },
    };
    const [result] = await this.sendAll(campaign, "release", [spec]);
    if (result === undefined) return;
    if (
      result.kind === "mined" ||
      (result.kind === "failed" && revertName(result.outcome.error) === "AlreadyReleased")
    ) {
      await this.emit(campaign, "release", "done");
      return;
    }
    this.reportFailures(campaign, "release", [result], log);
  }

  // -------------------------------------------------------------------------------------------
  // Shared
  // -------------------------------------------------------------------------------------------

  /**
   * Prepares every spec (finding or enqueuing its transaction) before waiting for any, then waits
   * for them all: the batches of a step are in the outbox together.
   */
  private async sendAll(
    campaign: SettlementCampaign,
    step: SettlementStep,
    specs: readonly StepSpec[],
  ): Promise<StepResult[]> {
    const { steps } = this.deps;
    const prepared = [];
    for (const spec of specs) prepared.push(await steps.prepare(spec));
    if (prepared.some((entry) => entry.kind === "pending"))
      await this.emit(campaign, step, "enqueued");
    const results = await Promise.all(
      prepared.map((entry, index) => steps.finish(entry, specs[index] as StepSpec)),
    );
    this.checkAbort();
    return results;
  }

  /**
   * Waits for the watcher's transactions of a step that a previous run left in the outbox, and
   * returns the outcomes of those that were mined.
   */
  private async waitInFlight(
    prefix: string,
  ): Promise<{ mined: { events: DecodedEvent[] }[]; unfinished: number }> {
    const rows = await stepTxs(this.deps.db, prefix);
    const open = rows.filter((row) => row.status === "queued" || row.status === "sent");
    if (open.length === 0) return { mined: [], unfinished: 0 };
    const outcomes = await Promise.all(open.map((row) => this.deps.steps.waitForTx(row.id)));
    this.checkAbort();
    return {
      mined: outcomes.flatMap((outcome) =>
        outcome !== null && outcome.status === "mined" ? [outcome] : [],
      ),
      unfinished: outcomes.filter((outcome) => outcome === null).length,
    };
  }

  private reportExhausted(
    campaign: SettlementCampaign,
    step: SettlementStep,
    attempts: number,
    lastError: string,
    log: Logger,
  ): void {
    this.reportOnce(`exhausted:${campaign.id}:${step}:${lastError}`, () =>
      log.error(
        { step, attempts, error: lastError },
        "settlement step given up: its transaction reverted every time, for a reason that will not change",
      ),
    );
  }

  /** Logs what did not go through; returns how many results are not mined. */
  private reportFailures(
    campaign: SettlementCampaign,
    step: SettlementStep,
    results: readonly StepResult[],
    log: Logger,
  ): number {
    let notMined = 0;
    for (const result of results) {
      if (result.kind === "mined") continue;
      notMined += 1;
      if (result.kind === "exhausted") {
        this.reportExhausted(campaign, step, result.attempts, result.lastError, log);
      } else if (result.kind === "failed") {
        log.error(
          {
            step,
            error: revertName(result.outcome.error),
            txId: result.outcome.id,
            status: result.outcome.status,
            countsAsAttempt: result.countsAsAttempt,
          },
          "settlement transaction failed, retried at a later pass",
        );
      } else {
        log.warn({ step, txId: result.id }, "settlement transaction not final yet, resumed later");
      }
    }
    return notMined;
  }
}
