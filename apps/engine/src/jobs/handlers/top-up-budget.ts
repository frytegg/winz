import type { Logger } from "pino";
import { encodeFunctionData } from "viem";

import { JOB_KINDS, STRIPE_PAYMENT_KINDS, winzEscrowAbi, type TopUpBudgetJob } from "@winz/shared";

import { PaymentGatewayError, type PaymentIntentView } from "../../payments";
import { PermanentJobError, RetryLaterError } from "../errors";
import type { JobContext, JobHandler } from "../worker";
import {
  JobStateError,
  lockTransactionEvents,
  projectEvents,
  readTxAttempt,
  resendDelay,
  runUntilSettled,
  sendOrResume,
  uintArg,
  withExclusiveLock,
  type PreparedTx,
} from "./common";
import { resolveOptions, type JobHandlerDeps, type ResolvedJobHandlerOptions } from "./deps";

/**
 * Reverts after which `topUpBudgetFor` can never succeed for this campaign: the card payment is
 * refunded. `InvalidParams` is a zero amount, which the payload schema already refuses. Every
 * other failure (the treasury short of USDC, the relayer short of gas) may change: a new attempt
 * follows, after checking again that the campaign can still take the top-up.
 */
const FINAL_TOP_UP_FAILURES: ReadonlySet<string> = new Set([
  "AlreadySettled",
  "AlreadyReleased",
  "InvalidParams",
  "CampaignNotFound",
]);

/** The transaction's idempotency key: one per top-up payment (`<base>:<n>` for a new attempt). */
export function topUpTxKey(paymentIntentId: string): string {
  return `topUpBudget:${paymentIntentId}`;
}

/** The refund's idempotency key at the payment provider: the same for every run of the job. */
export function topUpRefundKey(paymentIntentId: string): string {
  return `refund:${paymentIntentId}`;
}

type TopUpStatus =
  "requires_payment" | "processing" | "credited" | "refunding" | "refunded" | "failed";

interface TopUpRow {
  request_id: string;
  campaign_id: string;
  stripe_pi: string;
  amount: bigint;
  status: TopUpStatus;
  message: string | null;
  onchain_id: bigint | null;
  campaign_status: string;
  sales_close: Date;
  outcome: string | null;
  close_requested: boolean;
}

async function loadTopUp(deps: JobHandlerDeps, paymentIntentId: string): Promise<TopUpRow | null> {
  const [row] = await deps.db<TopUpRow[]>`
    select t.request_id, t.campaign_id, t.stripe_pi, t.amount, t.status, t.message,
           c.onchain_id, c.status as campaign_status, c.sales_close, c.outcome,
           exists (
             select 1 from jobs j
             where j.idempotency_key = ${JOB_KINDS.closeSales} || ':' || c.id::text
                or (j.kind = ${JOB_KINDS.closeSales} and j.payload ->> 'campaignId' = c.id::text)
           ) as close_requested
    from budget_top_ups t
    join campaigns c on c.id = t.campaign_id
    where t.stripe_pi = ${paymentIntentId}
  `;
  return row ?? null;
}

/** Why the payload cannot be this top-up's, or null when it agrees with the row. */
function payloadMismatch(row: TopUpRow, payload: TopUpBudgetJob): string | null {
  if (payload.campaignId !== row.campaign_id) return "the job names another campaign";
  if (payload.requestId !== row.request_id) return "the job names another request";
  if (BigInt(payload.amount) !== row.amount) return "the job's amount is not the top-up's";
  return null;
}

/** Why the PaymentIntent cannot be trusted as this top-up's payment, or null when it can. */
function intentMismatch(row: TopUpRow, intent: PaymentIntentView): string | null {
  if (intent.metadata.kind !== STRIPE_PAYMENT_KINDS.campaignBudgetTopUp) {
    return "the PaymentIntent is not a budget top-up";
  }
  if (intent.metadata.campaignId !== row.campaign_id)
    return "the PaymentIntent pays another campaign";
  if (intent.metadata.requestId !== row.request_id) return "the PaymentIntent is another request's";
  if (intent.currency !== "usd") return "the PaymentIntent is not in USD";
  if (intent.amount !== row.amount) return "the PaymentIntent amount is not the top-up's";
  return null;
}

/**
 * Why the campaign can no longer take the top-up, or null when it can. A top-up after the close
 * could never be spent: the contract would take it until the settlement, the product does not.
 */
function cannotTakeTopUp(row: TopUpRow, nowMs: number): string | null {
  if (row.onchain_id === null) return "the campaign is not on-chain";
  if (
    row.outcome !== null ||
    ["settled_yes", "settled_no", "void", "closed"].includes(row.campaign_status)
  ) {
    return "the campaign is settled";
  }
  if (row.campaign_status === "sales_closed" || row.close_requested) return "sales are closed";
  if (row.sales_close.getTime() <= nowMs) return "sales close has passed";
  if (row.campaign_status !== "live" && row.campaign_status !== "paused") {
    return `the campaign is '${row.campaign_status}'`;
  }
  return null;
}

/**
 * One run of the top-up job.
 *
 * INVARIANT (money): the merchant's card was charged before this job existed, so a top-up ends
 * either CREDITED (exactly one `topUpBudgetFor` mined, its `BudgetToppedUp` projected) or
 * REFUNDED (the card refunded exactly once), never both and never neither:
 *
 * - at most one transaction is ever mined: `sendOrResume` answers a mined or in-flight attempt
 *   before anything else, and queues a new attempt only once every earlier one is final and not
 *   mined;
 * - a refund is decided only when no attempt is mined or in flight (`prepare`, which
 *   `sendOrResume` calls only then, or the final failure of the latest attempt), and the decision
 *   is written (`refunding`) BEFORE the payment provider is called: from then on no run sends a
 *   transaction, every run only finishes the refund, whose idempotency key is the same each time;
 * - a mined attempt is never followed by a refund: every later run finds it first and only
 *   projects it;
 * - the job is committed from its first run: a passing condition (node or provider outage) never
 *   sends it `dead` (`runUntilSettled`). Only a payload or payment that is not this top-up's ends
 *   it `dead`, loudly: nothing can be credited or refunded against data that disagrees.
 */
class BudgetTopUp {
  private readonly options: ResolvedJobHandlerOptions;
  private readonly base: string;

  constructor(
    private readonly deps: JobHandlerDeps,
    private readonly log: Logger,
    private readonly ctx: JobContext,
    private readonly payload: TopUpBudgetJob,
  ) {
    this.options = resolveOptions(deps.options);
    this.base = topUpTxKey(payload.paymentIntentId);
  }

  private fields(row: TopUpRow): Record<string, unknown> {
    return {
      campaignId: row.campaign_id,
      requestId: row.request_id,
      paymentIntentId: row.stripe_pi,
      amount: row.amount.toString(),
    };
  }

  async run(): Promise<void> {
    const row = await loadTopUp(this.deps, this.payload.paymentIntentId);
    if (row === null) {
      throw new PermanentJobError(`no top-up has payment ${this.payload.paymentIntentId}`);
    }
    const mismatch = payloadMismatch(row, this.payload);
    if (mismatch !== null) {
      this.log.error({ ...this.fields(row), mismatch }, "top-up job refused");
      throw new PermanentJobError(`top-up ${row.stripe_pi}: ${mismatch}`);
    }
    switch (row.status) {
      case "credited":
      case "refunded":
        this.log.info({ ...this.fields(row), status: row.status }, "top-up already final");
        return;
      case "refunding":
        await this.refund(row);
        return;
      case "failed":
        throw new PermanentJobError(`top-up ${row.stripe_pi} was cancelled before it was paid`);
      case "requires_payment":
        // The webhook writes `processing` in the transaction that enqueues this job.
        throw new JobStateError(`top-up ${row.stripe_pi} has a job but is not marked paid`);
      case "processing":
        break;
    }

    const sent = await sendOrResume(
      this.deps,
      this.options,
      this.ctx,
      this.base,
      () => this.prepare(row),
      { resendAfter: (reason) => !FINAL_TOP_UP_FAILURES.has(reason) },
    );
    if (sent === null) return;
    if (sent.outcome.status === "mined") {
      await this.finalize(row, sent.txId);
      return;
    }
    const reason = sent.outcome.error ?? "unknown error";
    if (FINAL_TOP_UP_FAILURES.has(reason)) {
      await this.decideRefund(row, `the escrow refused the top-up (${reason})`);
      return;
    }
    const delayMs = resendDelay(this.options, sent.attempt);
    this.log.error(
      {
        ...this.fields(row),
        txId: sent.txId,
        attempt: sent.attempt,
        status: sent.outcome.status,
        reason,
        retryInMs: delayMs,
      },
      "top-up failed on-chain; a new attempt follows, and the card is refunded if the campaign can no longer take it",
    );
    throw new RetryLaterError(
      delayMs,
      `topUpBudgetFor of payment ${row.stripe_pi} ended '${sent.outcome.status}' (${reason}); attempt ${(sent.attempt + 1).toString()} follows`,
    );
  }

  /**
   * The checks made before an attempt is sent (no attempt is mined or in flight here), then the
   * call. Returns null when the job ended here: the campaign can no longer take the top-up, and
   * the card is refunded.
   */
  private async prepare(row: TopUpRow): Promise<PreparedTx | null> {
    const intent = await this.retrieve(row.stripe_pi);
    if (intent === null) {
      throw new PermanentJobError(`top-up payment ${row.stripe_pi} is unknown to the gateway`);
    }
    const mismatch = intentMismatch(row, intent);
    if (mismatch !== null) {
      this.log.error({ ...this.fields(row), mismatch }, "top-up payment refused");
      throw new PermanentJobError(`top-up payment ${row.stripe_pi}: ${mismatch}`);
    }
    if (intent.status === "canceled") {
      throw new PermanentJobError(`top-up payment ${row.stripe_pi} was canceled`);
    }
    if (intent.status !== "succeeded") {
      throw new RetryLaterError(
        this.options.retryDelayMs,
        `top-up payment ${row.stripe_pi} is '${intent.status}', not succeeded yet`,
      );
    }
    const blocked = cannotTakeTopUp(row, this.deps.clock());
    if (blocked !== null || row.onchain_id === null) {
      await this.decideRefund(row, blocked ?? "the campaign is not on-chain");
      return null;
    }
    return {
      signer: "relayer",
      kind: "topUpBudgetFor",
      to: this.deps.escrowAddress,
      data: encodeFunctionData({
        abi: winzEscrowAbi,
        functionName: "topUpBudgetFor",
        args: [row.onchain_id, row.amount],
      }),
      payload: {
        campaignId: row.campaign_id,
        amount: row.amount.toString(),
        paymentIntentId: row.stripe_pi,
        requestId: row.request_id,
      },
    };
  }

  private async retrieve(id: string): Promise<PaymentIntentView | null> {
    try {
      return await this.deps.payments.retrievePaymentIntent(id);
    } catch (error: unknown) {
      if (error instanceof PaymentGatewayError && !error.retryable) {
        throw new PermanentJobError(`top-up payment ${id} cannot be read`, { cause: error });
      }
      throw new RetryLaterError(
        this.options.retryDelayMs,
        `top-up payment ${id} cannot be read now`,
      );
    }
  }

  /** Writes the refund decision first (no run sends anything after it), then refunds. */
  private async decideRefund(row: TopUpRow, reason: string): Promise<void> {
    await this.deps.db`
      update budget_top_ups set status = 'refunding', message = ${reason}
      where stripe_pi = ${row.stripe_pi} and status = 'processing'
    `;
    this.log.warn({ ...this.fields(row), reason }, "top-up cannot be credited: refunding the card");
    await this.refund(row);
  }

  /** The refund of a top-up whose decision is written; the same key on every run. */
  private async refund(row: TopUpRow): Promise<void> {
    try {
      await this.deps.payments.refundPaymentIntent(row.stripe_pi, topUpRefundKey(row.stripe_pi));
    } catch (error: unknown) {
      if (error instanceof PaymentGatewayError && !error.retryable) {
        this.log.error(
          { ...this.fields(row), code: error.code },
          "top-up refund refused by the payment gateway: the top-up stays 'refunding'",
        );
        throw new PermanentJobError(`top-up payment ${row.stripe_pi} cannot be refunded`, {
          cause: error,
        });
      }
      throw new RetryLaterError(
        this.options.retryDelayMs,
        `top-up payment ${row.stripe_pi} cannot be refunded now`,
      );
    }
    await this.deps.db`
      update budget_top_ups set status = 'refunded', refunded_at = coalesce(refunded_at, now())
      where stripe_pi = ${row.stripe_pi} and status = 'refunding'
    `;
    this.log.warn(this.fields(row), "top-up refunded to the merchant's card");
  }

  /**
   * One database transaction: the receipt's `BudgetToppedUp` (exactly one, for this campaign and
   * this amount) is projected through the code path of every other source, which recomputes the
   * campaign's budget from `chain_events`, and the top-up is marked credited.
   */
  private async finalize(row: TopUpRow, txId: string): Promise<void> {
    const tx = await readTxAttempt(this.deps.db, this.base, txId);
    if (tx.txHash === null) throw new JobStateError(`mined transaction ${txId} has no hash`);
    const txHash = tx.txHash;
    const onchainId = row.onchain_id;
    if (onchainId === null) {
      throw new JobStateError(`campaign ${row.campaign_id} has a mined top-up but no onchain_id`);
    }
    await this.deps.db.begin(async (sql) => {
      const [locked] = await sql<{ status: TopUpStatus }[]>`
        select status from budget_top_ups where stripe_pi = ${row.stripe_pi} for update
      `;
      if (locked === undefined) throw new JobStateError(`top-up ${row.stripe_pi} vanished`);
      const events = await lockTransactionEvents(sql, txHash);
      const topUps = events.filter((event) => event.name === "BudgetToppedUp");
      const [event] = topUps;
      if (
        event === undefined ||
        topUps.length !== 1 ||
        uintArg(event, "id") !== onchainId ||
        uintArg(event, "amount") !== row.amount
      ) {
        throw new JobStateError(
          `transaction ${txHash} does not carry the BudgetToppedUp of this top-up`,
        );
      }
      await projectEvents(sql, events);
      await sql`
        update budget_top_ups set status = 'credited', tx_hash = ${txHash.toLowerCase()}, message = null
        where stripe_pi = ${row.stripe_pi} and status in ('processing', 'credited')
      `;
    });
    this.log.info({ ...this.fields(row), txHash }, "top-up credited on-chain");
  }
}

/**
 * The budget top-up job (SPEC CA-6, task A-08), key `campaign.top_up:<payment id>`: the
 * merchant's card paid a top-up of a running campaign; `topUpBudgetFor(onchainId, amount)` is
 * sent through the transaction sender under `topUpBudget:<payment id>` (then
 * `topUpBudget:<payment id>:<n>` for a new attempt after a failure that may change), and its
 * receipt projected, which raises the campaign's budget. A campaign that can no longer take it
 * (settled, released, sales closed meanwhile) has the card refunded, once. Safe to run twice, and
 * twice at once (see the invariant of `BudgetTopUp`).
 *
 * `topUpBudgetFor` is not listed in `INDEPENDENT_TX_KINDS`, so it is a barrier: prepared only
 * once nothing else of the relayer is in flight, and nothing queued after it signed before it is
 * mined. Nothing shows it safe in flight with others: it pulls from the treasury that every
 * in-flight `buyFor` also pulls from (simulated on the latest block, a purchase could count on
 * funds the top-up then takes, and revert on-chain), and it raises the budget the purchases
 * queued after it are checked against. A merchant's top-up is rare, so travelling alone costs
 * nothing. The close it may race is a barrier too: a top-up mined just before a close is credited,
 * and, unspent, it goes back to the merchant with the rest of the budget at `release`.
 */
export function createBudgetTopUpHandler(deps: JobHandlerDeps): JobHandler<TopUpBudgetJob> {
  const log = deps.logger.child({ module: "jobs.top-up-budget" });
  const { retryDelayMs } = resolveOptions(deps.options);
  return (payload, ctx) =>
    runUntilSettled(
      deps,
      log,
      ctx,
      { campaignId: payload.campaignId, paymentIntentId: payload.paymentIntentId },
      // The card is charged before the job exists: the job is committed from its first run.
      () => Promise.resolve(true),
      () =>
        withExclusiveLock(deps.db, `job:topUpBudget:${payload.paymentIntentId}`, retryDelayMs, () =>
          new BudgetTopUp(deps, log, ctx, payload).run(),
        ),
    );
}
