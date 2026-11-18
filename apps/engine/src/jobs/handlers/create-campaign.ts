import type { Logger } from "pino";
import { encodeFunctionData, getAddress, type Hex } from "viem";

import { STRIPE_PAYMENT_KINDS, winzEscrowAbi, type CreateCampaignJob } from "@winz/shared";

import {
  IdentityConflictError,
  IdentityResponseError,
  InvalidEmailError,
  resolveUserWallet,
} from "../../identity";
import { PaymentGatewayError, type PaymentIntentView } from "../../payments";
import { PermanentJobError, RetryLaterError } from "../errors";
import type { JobContext, JobHandler } from "../worker";
import {
  JobStateError,
  lockTransactionEvents,
  projectEvents,
  listTxAttempts,
  readTxAttempt,
  resendDelay,
  runUntilSettled,
  sendOrResume,
  uintArg,
  withExclusiveLock,
  type PreparedTx,
} from "./common";
import { resolveOptions, type JobHandlerDeps, type ResolvedJobHandlerOptions } from "./deps";
import { allocateSlug, campaignSlugBase } from "./slug";

/**
 * Reverts after which the campaign can never be created as it is: its budget is refunded and it
 * is closed. Every other failure is retried with a new attempt.
 */
const FINAL_CREATION_FAILURES: ReadonlySet<string> = new Set(["InvalidParams"]);

interface CampaignRow {
  id: string;
  onchain_id: bigint | null;
  status: string;
  slug: string | null;
  budget: bigint;
  budget_pi: string | null;
  unit_price: bigint;
  refund_bps: number;
  sales_close: Date;
  condition_label: string;
  merchant_name: string;
  merchant_email: string;
  merchant_wallet: string | null;
  instrument_onchain_id: string;
  instrument_active: boolean;
  instrument_outcome: string | null;
  event_status: string;
}

async function loadCampaign(deps: JobHandlerDeps, campaignId: string): Promise<CampaignRow | null> {
  const [row] = await deps.db<CampaignRow[]>`
    select c.id, c.onchain_id, c.status, c.slug, c.budget, c.budget_pi, c.unit_price, c.refund_bps,
           c.sales_close, c.condition_label,
           m.name as merchant_name, u.email as merchant_email, u.wallet as merchant_wallet,
           i.onchain_id as instrument_onchain_id, i.active as instrument_active,
           i.outcome as instrument_outcome, e.status as event_status
    from campaigns c
    join merchants m on m.id = c.merchant_id
    join users u on u.id = m.user_id
    join instruments i on i.symbol = c.instrument
    join events e on e.ticker = c.event_ticker
    where c.id = ${campaignId}
  `;
  return row ?? null;
}

/** Why a funded campaign can never go live, or null when it still can. */
function cannotGoLive(row: CampaignRow, nowMs: number): string | null {
  if (row.sales_close.getTime() <= nowMs) return "sales close is not in the future any more";
  if (!row.instrument_active) return "the instrument is no longer listed";
  if (
    row.instrument_outcome !== null ||
    row.event_status === "settled" ||
    row.event_status === "void"
  ) {
    return "the instrument is already settled";
  }
  return null;
}

/** Why the budget payment cannot be trusted for this campaign, or null when it can. */
function budgetMismatch(row: CampaignRow, intent: PaymentIntentView): string | null {
  if (intent.metadata.kind !== STRIPE_PAYMENT_KINDS.campaignBudget) {
    return "the PaymentIntent is not a campaign budget";
  }
  if (intent.metadata.campaignId !== row.id) return "the PaymentIntent pays another campaign";
  if (intent.currency !== "usd") return "the PaymentIntent is not in USD";
  if (intent.amount !== row.budget) return "the PaymentIntent amount is not the campaign budget";
  return null;
}

class CampaignCreation {
  private readonly options: ResolvedJobHandlerOptions;
  private readonly base: string;

  constructor(
    private readonly deps: JobHandlerDeps,
    private readonly log: Logger,
    private readonly ctx: JobContext,
    private readonly campaignId: string,
  ) {
    this.options = resolveOptions(deps.options);
    this.base = `createCampaign:${campaignId}`;
  }

  async run(): Promise<void> {
    const row = await loadCampaign(this.deps, this.campaignId);
    if (row === null) throw new PermanentJobError(`campaign ${this.campaignId} does not exist`);
    if (row.onchain_id !== null && row.status !== "funding") {
      this.log.info(
        { campaignId: row.id, onchainId: row.onchain_id.toString(), status: row.status },
        "campaign already created on-chain",
      );
      return;
    }
    if (row.status !== "funding") {
      if (row.status === "closed") {
        this.log.info({ campaignId: row.id }, "campaign already closed without going live");
        return;
      }
      throw new PermanentJobError(
        `campaign ${row.id} is '${row.status}', only a 'funding' campaign can be created`,
      );
    }
    const budgetPi = row.budget_pi;
    if (budgetPi === null) {
      throw new PermanentJobError(`campaign ${row.id} has no budget payment`);
    }

    const sent = await sendOrResume(
      this.deps,
      this.options,
      this.ctx,
      this.base,
      () => this.prepare(row, budgetPi),
      // Only invalid parameters are final. Anything else (the treasury short of USDC, the relayer
      // short of gas or not authorised yet) may be fixed: a later run sends a new attempt, after
      // checking again that the campaign can still go live (else its budget is refunded).
      { resendAfter: (reason) => !FINAL_CREATION_FAILURES.has(reason) },
    );
    if (sent === null) return;
    if (sent.outcome.status === "mined") {
      await this.finalize(row, sent.txId);
      return;
    }
    const reason = sent.outcome.error ?? "unknown error";
    if (FINAL_CREATION_FAILURES.has(reason)) {
      await this.refundAndClose(row, budgetPi, "the escrow refused the campaign's parameters");
      return;
    }
    const delayMs = resendDelay(this.options, sent.attempt);
    this.log.error(
      {
        campaignId: row.id,
        txId: sent.txId,
        attempt: sent.attempt,
        status: sent.outcome.status,
        reason,
        retryInMs: delayMs,
      },
      "campaign creation failed on-chain; a new attempt follows, and the budget is refunded if the campaign can no longer go live",
    );
    throw new RetryLaterError(
      delayMs,
      `createCampaignFor of campaign ${row.id} ended '${sent.outcome.status}' (${reason}); attempt ${(sent.attempt + 1).toString()} follows`,
    );
  }

  /**
   * The checks made before anything is sent, then the call. Returns null when the job ended here
   * (the campaign can never go live: refunded and closed).
   */
  private async prepare(row: CampaignRow, budgetPi: string): Promise<PreparedTx | null> {
    const intent = await this.retrieve(budgetPi);
    if (intent === null) {
      throw new PermanentJobError(`budget payment ${budgetPi} is unknown to the payment gateway`);
    }
    const mismatch = budgetMismatch(row, intent);
    if (mismatch !== null) {
      this.log.error({ campaignId: row.id, budgetPi, mismatch }, "budget payment refused");
      throw new PermanentJobError(`budget payment ${budgetPi}: ${mismatch}`);
    }
    if (intent.status === "canceled") {
      throw new PermanentJobError(`budget payment ${budgetPi} was canceled`);
    }
    if (intent.status !== "succeeded") {
      throw new RetryLaterError(
        this.options.retryDelayMs,
        `budget payment ${budgetPi} is '${intent.status}', not succeeded yet`,
      );
    }

    const blocked = cannotGoLive(row, this.deps.clock());
    if (blocked !== null) {
      await this.refundAndClose(row, budgetPi, blocked);
      return null;
    }

    const merchant = getAddress(await this.merchantWallet(row));
    const data = encodeFunctionData({
      abi: winzEscrowAbi,
      functionName: "createCampaignFor",
      args: [
        merchant,
        {
          instrument: row.instrument_onchain_id as Hex,
          salesClose: BigInt(Math.floor(row.sales_close.getTime() / 1000)),
          unitPrice: row.unit_price,
          refundBps: row.refund_bps,
        },
        row.budget,
      ],
    });
    return {
      signer: "relayer",
      kind: "createCampaignFor",
      to: this.deps.escrowAddress,
      data,
      payload: { campaignId: row.id, budget: row.budget.toString() },
    };
  }

  private async retrieve(id: string): Promise<PaymentIntentView | null> {
    try {
      return await this.deps.payments.retrievePaymentIntent(id);
    } catch (error: unknown) {
      if (error instanceof PaymentGatewayError && !error.retryable) {
        throw new PermanentJobError(`budget payment ${id} cannot be read`, { cause: error });
      }
      throw new RetryLaterError(
        this.options.retryDelayMs,
        `budget payment ${id} cannot be read now`,
      );
    }
  }

  /** `users.wallet` of the merchant, resolved through the identity directory when missing. */
  private async merchantWallet(row: CampaignRow): Promise<string> {
    if (row.merchant_wallet !== null) return row.merchant_wallet;
    try {
      const user = await resolveUserWallet(
        this.deps.db,
        this.deps.identity,
        row.merchant_email,
        "merchant",
        { logger: this.log },
      );
      this.log.info(
        { campaignId: row.id },
        "merchant wallet resolved through the identity directory",
      );
      return user.walletAddress;
    } catch (error: unknown) {
      if (
        error instanceof IdentityConflictError ||
        error instanceof IdentityResponseError ||
        error instanceof InvalidEmailError
      ) {
        throw new PermanentJobError(`the merchant of campaign ${row.id} has no usable wallet`, {
          cause: error,
        });
      }
      // The cause is left out on purpose: a directory's message may quote the e-mail.
      const name = error instanceof Error ? error.name : "unknown error";
      throw new RetryLaterError(
        this.options.retryDelayMs,
        `the identity directory could not resolve the merchant's wallet (${name})`,
      );
    }
  }

  /** The budget goes back to the merchant's card and the campaign is closed. */
  private async refundAndClose(row: CampaignRow, budgetPi: string, reason: string): Promise<void> {
    try {
      await this.deps.payments.refundPaymentIntent(budgetPi, `refund:${budgetPi}`);
    } catch (error: unknown) {
      if (error instanceof PaymentGatewayError && !error.retryable) {
        this.log.error(
          { campaignId: row.id, budgetPi, code: error.code },
          "budget refund refused by the payment gateway",
        );
        throw new PermanentJobError(`budget payment ${budgetPi} cannot be refunded`, {
          cause: error,
        });
      }
      throw new RetryLaterError(
        this.options.retryDelayMs,
        `budget payment ${budgetPi} cannot be refunded now`,
      );
    }
    await this.deps.db`
      update campaigns set status = 'closed', sale_state = 'closed'
      where id = ${row.id} and status = 'funding' and onchain_id is null
    `;
    this.log.warn(
      { campaignId: row.id, budgetPi, reason },
      "campaign can never go live: budget refunded, campaign closed",
    );
  }

  /**
   * One database transaction: the on-chain id read from the receipt's `CampaignCreated`, a
   * unique slug and the open sale state are written, then the receipt's events are projected,
   * which puts the campaign live through the same code path as every other source.
   */
  private async finalize(row: CampaignRow, txId: string): Promise<void> {
    const tx = await readTxAttempt(this.deps.db, this.base, txId);
    if (tx.txHash === null) throw new JobStateError(`mined transaction ${txId} has no hash`);
    const txHash = tx.txHash;
    const result = await this.deps.db.begin(async (sql) => {
      const [current] = await sql<{ onchain_id: bigint | null; slug: string | null }[]>`
        select onchain_id, slug from campaigns where id = ${row.id} for update
      `;
      if (current === undefined) throw new JobStateError(`campaign ${row.id} vanished`);
      const events = await lockTransactionEvents(sql, txHash);
      const created = events.filter((event) => event.name === "CampaignCreated");
      const [event] = created;
      if (event === undefined || created.length !== 1) {
        throw new JobStateError(
          `transaction ${txHash} carries ${created.length.toString()} CampaignCreated events`,
        );
      }
      const onchainId = uintArg(event, "id");
      let slug = current.slug;
      if (current.onchain_id === null) {
        slug = await allocateSlug(sql, campaignSlugBase(row.merchant_name, row.condition_label));
        await sql`
          update campaigns
          set onchain_id = ${onchainId.toString()}::bigint, slug = ${slug},
              sale_state = case when status = 'funding' then 'open' else sale_state end
          where id = ${row.id}
        `;
      } else if (current.onchain_id !== onchainId) {
        throw new JobStateError(
          `campaign ${row.id} has onchain_id ${current.onchain_id.toString()}, its receipt says ${onchainId.toString()}`,
        );
      }
      await projectEvents(sql, events);
      return { onchainId, slug };
    });
    this.log.info(
      { campaignId: row.id, onchainId: result.onchainId.toString(), slug: result.slug, txHash },
      "campaign live on-chain",
    );
  }
}

/**
 * J-02, the campaign creation job (SPEC CA-2): the merchant's budget is paid, the campaign is
 * created on-chain with `createCampaignFor` (key `createCampaign:<campaign id>`, then
 * `createCampaign:<campaign id>:<n>` for a new attempt after a failure that may change), and goes
 * live in the database from its receipt. A campaign that can never go live has its budget
 * refunded and is closed. Safe to run twice, and twice at once. Once a transaction was queued,
 * a passing condition never sends the job to `dead` (`runUntilSettled`): it ends live, or closed
 * with its budget refunded once sales close has passed.
 */
export function createCampaignCreationHandler(deps: JobHandlerDeps): JobHandler<CreateCampaignJob> {
  const log = deps.logger.child({ module: "jobs.create-campaign" });
  const { retryDelayMs } = resolveOptions(deps.options);
  const base = (campaignId: string): string => `createCampaign:${campaignId}`;
  return (payload, ctx) =>
    runUntilSettled(
      deps,
      log,
      ctx,
      { campaignId: payload.campaignId },
      async () => (await listTxAttempts(deps.db, base(payload.campaignId))).length > 0,
      () =>
        withExclusiveLock(deps.db, `job:createCampaign:${payload.campaignId}`, retryDelayMs, () =>
          new CampaignCreation(deps, log, ctx, payload.campaignId).run(),
        ),
    );
}
