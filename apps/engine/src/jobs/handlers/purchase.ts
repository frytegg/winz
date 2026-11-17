import { randomBytes } from "node:crypto";

import type { Logger } from "pino";
import { encodeFunctionData, getAddress, type Address, type Hex } from "viem";

import {
  computeQuote,
  maxCostBps,
  type AcceptedQuote,
  type QuoteRefusalReason,
} from "@winz/pricing";
import {
  QUOTE_TTL_SECONDS,
  QUOTE_TYPES,
  STRIPE_PAYMENT_KINDS,
  quoteDomain,
  winzEscrowAbi,
  type Book,
  type CheckoutStatus,
  type PurchaseJob,
  type Quote,
} from "@winz/shared";

import type { TxOutcome } from "../../chain";
import {
  IdentityConflictError,
  IdentityResponseError,
  InvalidEmailError,
  resolveUserWallet,
} from "../../identity";
import { readCachedBook } from "../../market-data";
import { PaymentGatewayError, type PaymentIntentView } from "../../payments";
import { PermanentJobError, RetryLaterError } from "../errors";
import type { JobContext, JobHandler } from "../worker";
import {
  attemptKey,
  awaitOutcome,
  isNodeUnavailable,
  JobStateError,
  listTxAttempts,
  lockTransactionEvents,
  projectEvents,
  readTxAttempt,
  runUntilSettled,
  uintArg,
  withExclusiveLock,
  type TxAttempt,
} from "./common";
import { resolveOptions, type JobHandlerDeps, type ResolvedJobHandlerOptions } from "./deps";

/** What the customer reads on the checkout page (SPEC CO-4). Never more than this. */
export const PURCHASE_MESSAGES = {
  cancelledPaused: "Promo just paused, you were not charged",
  failed: "Something went wrong, you were not charged",
  cancelled: "Your payment was cancelled, you were not charged",
  captureFailed: "Your payment could not be completed, you were not charged",
} as const;

/** Payment statuses after which the job has nothing left to do. */
const FINISHED: ReadonlySet<CheckoutStatus> = new Set(["ticketed", "cancelled_paused", "failed"]);

/**
 * Reverts that mean the sale cannot happen now (the campaign paused, its sales closed, its budget
 * ran out): the customer is told the promo paused and is not charged.
 */
const SALE_CLOSED_REASONS: ReadonlySet<string> = new Set([
  "SalesArePaused",
  "SalesAreClosed",
  "BudgetExceeded",
  "AlreadySettled",
]);

/** Why the sale cannot go on-chain now: a pricing refusal, or the campaign's own state. */
export type SaleRefusalReason = QuoteRefusalReason | "paused" | "closed" | "not_live";

interface PaymentRow {
  stripe_pi: string;
  campaign_id: string;
  email: string | null;
  buyer: string | null;
  qty: number;
  amount: bigint;
  status: CheckoutStatus;
  unit_price: bigint;
}

interface CampaignRow {
  id: string;
  onchain_id: bigint | null;
  status: string;
  sale_state: string;
  sales_close: Date;
  instrument: string;
  unit_price: bigint;
  refund_bps: number;
  usual_margin_bps: number;
  min_margin_bps: number;
  pause_threshold_bps: number;
}

type SaleDecision =
  | { ok: true; campaignOnchainId: bigint; quote: AcceptedQuote }
  | { ok: false; reason: SaleRefusalReason };

/** A fresh, random 256-bit quote nonce. */
function randomNonce(): bigint {
  return BigInt(`0x${randomBytes(32).toString("hex")}`);
}

/** The secret of the `/t/<token>` link: 192 random bits, URL-safe. */
function newAccessToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Why the PaymentIntent does not pay for this payment row, or null when it does. */
function intentMismatch(payment: PaymentRow, intent: PaymentIntentView): string | null {
  if (intent.metadata.kind !== STRIPE_PAYMENT_KINDS.purchase) {
    return "the PaymentIntent is not a purchase";
  }
  if (intent.metadata.campaignId !== payment.campaign_id) {
    return "the PaymentIntent is for another campaign";
  }
  if (intent.metadata.qty !== payment.qty.toString()) {
    return "the PaymentIntent is for another quantity";
  }
  if (intent.currency !== "usd") return "the PaymentIntent is not in USD";
  if (intent.amount !== payment.amount) return "the PaymentIntent is for another amount";
  if (payment.amount !== BigInt(payment.qty) * payment.unit_price) {
    return "the payment amount is not quantity × unit price";
  }
  return null;
}

class Purchase {
  private readonly options: ResolvedJobHandlerOptions;
  private readonly base: string;

  constructor(
    private readonly deps: JobHandlerDeps,
    private readonly log: Logger,
    private readonly ctx: JobContext,
    private readonly paymentIntentId: string,
  ) {
    this.options = resolveOptions(deps.options);
    this.base = `buyFor:${paymentIntentId}`;
  }

  private get fields(): { paymentIntentId: string; jobId: string } {
    return { paymentIntentId: this.paymentIntentId, jobId: this.ctx.jobId };
  }

  async run(): Promise<void> {
    const payment = await this.loadPayment();
    if (payment === null) {
      throw new PermanentJobError(`no payment row for PaymentIntent ${this.paymentIntentId}`);
    }
    if (FINISHED.has(payment.status)) {
      this.log.info({ ...this.fields, status: payment.status }, "payment already settled");
      return;
    }
    if (payment.status !== "processing") {
      throw new PermanentJobError(
        `payment ${this.paymentIntentId} is '${payment.status}', the purchase job expects 'processing'`,
      );
    }

    const intent = await this.retrieve();
    if (intent === null) {
      await this.refuse(payment, null, "the PaymentIntent is unknown to the payment gateway");
      return;
    }
    const mismatch = intentMismatch(payment, intent);
    if (mismatch !== null) {
      await this.refuse(payment, intent, mismatch);
      return;
    }

    // What earlier runs left: a ticket bought, a transaction in flight, or attempts that failed.
    const attempts = await listTxAttempts(this.deps.db, this.base);
    const mined = attempts.find((attempt) => attempt.status === "mined");
    if (mined !== undefined) {
      await this.settle(payment, intent, mined.id);
      return;
    }
    let attempt: number;
    const open = attempts.find((row) => row.status === "queued" || row.status === "sent");
    if (open !== undefined) {
      const outcome = await awaitOutcome(this.deps, this.options, this.ctx, open.id);
      if ((await this.afterOutcome(payment, intent, open.attempt, open.id, outcome)) === "done") {
        return;
      }
      attempt = open.attempt + 1;
    } else {
      const last: TxAttempt | undefined = attempts[attempts.length - 1];
      attempt = (last?.attempt ?? 0) + 1;
      if (last !== undefined && attempt > this.options.maxBuyAttempts) {
        await this.giveUp(payment, intent, last.error ?? "unknown error");
        return;
      }
    }

    if (intent.status !== "requires_capture") {
      await this.notAuthorized(payment, intent);
      return;
    }
    const buyer = await this.resolveBuyer(payment, intent);

    for (;;) {
      const decision = await this.decide(payment);
      if (!decision.ok) {
        await this.cancelPaused(payment, intent, decision.reason);
        return;
      }
      const txId = await this.sendBuy(payment, buyer, decision, attempt);
      const outcome = await awaitOutcome(this.deps, this.options, this.ctx, txId);
      if ((await this.afterOutcome(payment, intent, attempt, txId, outcome)) === "done") return;
      attempt += 1;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------------------------

  private async loadPayment(): Promise<PaymentRow | null> {
    const [row] = await this.deps.db<PaymentRow[]>`
      select p.stripe_pi, p.campaign_id, p.email, p.buyer, p.qty, p.amount, p.status,
             c.unit_price
      from payments p
      join campaigns c on c.id = p.campaign_id
      where p.stripe_pi = ${this.paymentIntentId}
    `;
    return row ?? null;
  }

  private async loadCampaign(campaignId: string): Promise<CampaignRow> {
    const [row] = await this.deps.db<CampaignRow[]>`
      select id, onchain_id, status, sale_state, sales_close, instrument, unit_price, refund_bps,
             usual_margin_bps, min_margin_bps, pause_threshold_bps
      from campaigns where id = ${campaignId}
    `;
    if (row === undefined) throw new JobStateError(`campaign ${campaignId} vanished`);
    return row;
  }

  private async retrieve(): Promise<PaymentIntentView | null> {
    try {
      return await this.deps.payments.retrievePaymentIntent(this.paymentIntentId);
    } catch (error: unknown) {
      if (error instanceof PaymentGatewayError && !error.retryable) {
        throw new PermanentJobError(`PaymentIntent ${this.paymentIntentId} cannot be read`, {
          cause: error,
        });
      }
      throw new RetryLaterError(
        this.options.retryDelayMs,
        `PaymentIntent ${this.paymentIntentId} cannot be read now`,
      );
    }
  }

  /** The newest of the in-memory book and the cached one; null when neither exists. */
  private async currentBook(symbol: string, nowMs: number): Promise<Book | null> {
    const live = this.deps.books.getBook(symbol);
    if (live !== null && nowMs - live.observedAtMs <= this.options.staleAfterMs) return live;
    const cached = await readCachedBook(this.deps.db, symbol);
    if (live === null) return cached;
    if (cached === null) return live;
    return cached.observedAtMs > live.observedAtMs ? cached : live;
  }

  /** Exposure sold on the instrument and not hedged yet: exposure − held, at least 0. */
  private async pendingExposure(symbol: string): Promise<bigint> {
    const [row] = await this.deps.db<{ exposure: bigint; held: bigint }[]>`
      select exposure, held from positions where instrument = ${symbol}
    `;
    if (row === undefined) return 0n;
    const pending = row.exposure - row.held;
    return pending > 0n ? pending : 0n;
  }

  /** `availableBudget` of the campaign, read from the contract: the source of truth. */
  private async availableBudget(onchainId: bigint): Promise<bigint> {
    try {
      return await this.deps.publicClient.readContract({
        address: this.deps.escrowAddress,
        abi: winzEscrowAbi,
        functionName: "availableBudget",
        args: [onchainId],
      });
    } catch {
      throw new RetryLaterError(
        this.options.retryDelayMs,
        `the escrow's available budget of campaign ${onchainId.toString()} cannot be read now`,
      );
    }
  }

  // -------------------------------------------------------------------------------------------
  // Deciding and buying
  // -------------------------------------------------------------------------------------------

  /** SPEC 9.2: can this sale go on-chain now, and at what guaranteed cost. */
  private async decide(payment: PaymentRow): Promise<SaleDecision> {
    const campaign = await this.loadCampaign(payment.campaign_id);
    const nowMs = this.deps.clock();
    if (campaign.status === "paused") return { ok: false, reason: "paused" };
    if (campaign.status !== "live") {
      return {
        ok: false,
        reason:
          campaign.status === "draft" || campaign.status === "funding" ? "not_live" : "closed",
      };
    }
    if (campaign.onchain_id === null) return { ok: false, reason: "not_live" };
    // Pricing decides the automatic pauses below; these states are decided elsewhere
    // (the merchant, the close, the circuit breaker) and no quote is signed under them.
    if (campaign.sale_state === "closed") return { ok: false, reason: "closed" };
    if (campaign.sale_state === "paused_manual" || campaign.sale_state === "paused_breaker") {
      return { ok: false, reason: "paused" };
    }
    if (nowMs >= campaign.sales_close.getTime()) return { ok: false, reason: "closed" };

    const [book, pending, availableBudget] = await Promise.all([
      this.currentBook(campaign.instrument, nowMs),
      this.pendingExposure(campaign.instrument),
      this.availableBudget(campaign.onchain_id),
    ]);
    const quote = computeQuote({
      book,
      pending,
      nowMs,
      staleAfterMs: this.options.staleAfterMs,
      qty: BigInt(payment.qty),
      unitPrice: campaign.unit_price,
      refundBps: BigInt(campaign.refund_bps),
      pauseThresholdBps: BigInt(campaign.pause_threshold_bps),
      maxCostBps: maxCostBps(BigInt(campaign.usual_margin_bps), BigInt(campaign.min_margin_bps)),
      availableBudget,
    });
    if (!quote.ok) return { ok: false, reason: quote.reason };
    return { ok: true, campaignOnchainId: campaign.onchain_id, quote };
  }

  /** Signs the quote with the oracle key and queues `buyFor` as the relayer. Returns the row id. */
  private async sendBuy(
    payment: PaymentRow,
    buyer: Address,
    decision: Extract<SaleDecision, { ok: true }>,
    attempt: number,
  ): Promise<string> {
    const quote: Quote = {
      campaignId: decision.campaignOnchainId,
      buyer,
      qty: payment.qty,
      maxHedgeCost: decision.quote.maxHedgeCost,
      expiry: BigInt(Math.floor(this.deps.clock() / 1000)) + BigInt(QUOTE_TTL_SECONDS),
      nonce: randomNonce(),
    };
    const signature = await this.deps.oracle.signTypedData({
      domain: quoteDomain(this.deps.chainId, this.deps.escrowAddress),
      types: QUOTE_TYPES,
      primaryType: "Quote",
      message: quote,
    });
    const data = encodeFunctionData({
      abi: winzEscrowAbi,
      functionName: "buyFor",
      args: [quote, signature],
    });
    const { id, created } = await this.deps.txSender.enqueue({
      idempotencyKey: attemptKey(this.base, attempt, true),
      signer: "relayer",
      kind: "buyFor",
      to: this.deps.escrowAddress,
      data,
      payload: {
        paymentIntentId: this.paymentIntentId,
        attempt,
        campaignOnchainId: quote.campaignId.toString(),
        qty: quote.qty,
        maxHedgeCost: quote.maxHedgeCost.toString(),
        expiry: quote.expiry.toString(),
        quoteNonce: quote.nonce.toString(),
      },
    });
    this.log.info(
      {
        ...this.fields,
        attempt,
        txId: id,
        created,
        campaignOnchainId: quote.campaignId.toString(),
        maxHedgeCost: quote.maxHedgeCost.toString(),
        hedgeCost: decision.quote.hedgeCost.toString(),
      },
      "quote signed, buyFor queued",
    );
    return id;
  }

  /**
   * What a final outcome means. Mined: the ticket is settled. QuoteExpired: quote again with the
   * next attempt (`requote`), up to the limit. Anything else ends the payment.
   */
  private async afterOutcome(
    payment: PaymentRow,
    intent: PaymentIntentView,
    attempt: number,
    txId: string,
    outcome: TxOutcome,
  ): Promise<"done" | "requote"> {
    if (outcome.status === "mined") {
      await this.settle(payment, intent, txId);
      return "done";
    }
    const reason = outcome.error ?? "unknown error";
    const last = attempt >= this.options.maxBuyAttempts;
    if (reason === "QuoteExpired" && !last) {
      this.log.info(
        { ...this.fields, attempt, txId },
        "quote expired before buyFor ran; quoting again",
      );
      return "requote";
    }
    if (isNodeUnavailable(reason) && !last) {
      throw new RetryLaterError(
        this.options.retryDelayMs,
        `buyFor attempt ${attempt.toString()} was never sent (node unavailable); the next run quotes again`,
      );
    }
    await this.giveUp(payment, intent, reason, { attempt, txId, status: outcome.status });
    return "done";
  }

  /** No more attempts: the authorization is released and the payment ends. */
  private async giveUp(
    payment: PaymentRow,
    intent: PaymentIntentView,
    reason: string,
    context: Record<string, unknown> = {},
  ): Promise<void> {
    if (reason === "QuoteExpired" || SALE_CLOSED_REASONS.has(reason)) {
      await this.cancelPaused(payment, intent, reason);
      return;
    }
    this.log.error({ ...this.fields, ...context, reason }, "buyFor failed; authorization released");
    await this.cancelAuthorization(intent);
    await this.finish(payment, "failed", PURCHASE_MESSAGES.failed);
    throw new PermanentJobError(
      `buyFor of PaymentIntent ${this.paymentIntentId} failed: ${reason}`,
    );
  }

  // -------------------------------------------------------------------------------------------
  // Settling a bought ticket
  // -------------------------------------------------------------------------------------------

  /**
   * The ticket exists on-chain. One database transaction projects the receipt (ticket and lot,
   * idempotently) and links ticket and payment; then the payment is captured, and only then is
   * it `ticketed`.
   */
  private async settle(
    payment: PaymentRow,
    intent: PaymentIntentView,
    txId: string,
  ): Promise<void> {
    const tx = await readTxAttempt(this.deps.db, this.base, txId);
    if (tx.txHash === null) throw new JobStateError(`mined transaction ${txId} has no hash`);
    const txHash: Hex = tx.txHash;
    const nonce = tx.payload.quoteNonce;
    if (typeof nonce !== "string" || !/^[0-9]+$/.test(nonce)) {
      throw new JobStateError(`buyFor row ${txId} has no quote nonce in its payload`);
    }
    const token = newAccessToken();
    const ticket = await this.deps.db.begin(async (sql) => {
      const events = await lockTransactionEvents(sql, txHash);
      const purchased = events.filter((event) => event.name === "TicketPurchased");
      const [event] = purchased;
      if (event === undefined || purchased.length !== 1) {
        throw new JobStateError(
          `transaction ${txHash} carries ${purchased.length.toString()} TicketPurchased events`,
        );
      }
      await projectEvents(sql, events);
      const ticketOnchainId = uintArg(event, "ticketId");
      const [row] = await sql<{ id: string }[]>`
        update tickets
        set access_token = case when payment_pi is null then ${token} else access_token end,
            payment_pi = ${this.paymentIntentId},
            quote_nonce = coalesce(quote_nonce, ${nonce}::numeric)
        where onchain_id = ${ticketOnchainId.toString()}::bigint
          and (payment_pi is null or payment_pi = ${this.paymentIntentId})
        returning id
      `;
      if (row === undefined) {
        throw new JobStateError(
          `ticket ${ticketOnchainId.toString()} is missing or linked to another payment`,
        );
      }
      await sql`update payments set ticket_id = ${row.id} where stripe_pi = ${this.paymentIntentId}`;
      return { id: row.id, onchainId: ticketOnchainId };
    });

    const ticketFields = { ...this.fields, ticketOnchainId: ticket.onchainId.toString(), txHash };
    if (intent.status !== "succeeded") {
      try {
        await this.deps.payments.capturePaymentIntent(
          this.paymentIntentId,
          `capture:${this.paymentIntentId}`,
        );
      } catch (error: unknown) {
        if (error instanceof PaymentGatewayError && !error.retryable) {
          // The ticket stands on-chain and the customer was not charged: Winz paid for it.
          this.log.error(
            {
              ...ticketFields,
              campaignId: payment.campaign_id,
              code: error.code,
              amount: payment.amount.toString(),
            },
            "capture failed for good after the ticket was issued: the ticket stays, the platform bears the loss",
          );
          await this.finish(payment, "failed", PURCHASE_MESSAGES.captureFailed);
          return;
        }
        throw new RetryLaterError(
          this.options.retryDelayMs,
          `capture of PaymentIntent ${this.paymentIntentId} failed for now; the ticket exists, the retry captures`,
        );
      }
    }
    await this.finish(payment, "ticketed", null);
    this.log.info(ticketFields, "ticket issued and payment captured");
  }

  // -------------------------------------------------------------------------------------------
  // Ending without a ticket
  // -------------------------------------------------------------------------------------------

  /** Writes the final status of the payment, once (a finished payment is never rewritten). */
  private async finish(
    payment: PaymentRow,
    status: "ticketed" | "cancelled_paused" | "failed",
    message: string | null,
  ): Promise<void> {
    await this.deps.db`
      update payments set status = ${status}, message = ${message}
      where stripe_pi = ${payment.stripe_pi} and status = 'processing'
    `;
  }

  /** Releases the authorization. Only called once no transaction of this payment can be mined. */
  private async cancelAuthorization(intent: PaymentIntentView | null): Promise<void> {
    if (intent !== null && intent.status !== "requires_capture") return;
    try {
      await this.deps.payments.cancelPaymentIntent(
        this.paymentIntentId,
        `cancel:${this.paymentIntentId}`,
      );
    } catch (error: unknown) {
      if (error instanceof PaymentGatewayError && !error.retryable) {
        this.log.error(
          { ...this.fields, code: error.code },
          "the authorization cannot be released",
        );
        throw new PermanentJobError(
          `the authorization of PaymentIntent ${this.paymentIntentId} cannot be cancelled`,
          { cause: error },
        );
      }
      throw new RetryLaterError(
        this.options.retryDelayMs,
        `the authorization of PaymentIntent ${this.paymentIntentId} cannot be cancelled now`,
      );
    }
  }

  /** SPEC CO-4: the sale cannot happen now; the customer is not charged. */
  private async cancelPaused(
    payment: PaymentRow,
    intent: PaymentIntentView,
    reason: string,
  ): Promise<void> {
    await this.cancelAuthorization(intent);
    await this.finish(payment, "cancelled_paused", PURCHASE_MESSAGES.cancelledPaused);
    this.log.info({ ...this.fields, reason }, "sale refused: authorization released, promo paused");
  }

  /** The PaymentIntent does not pay for this payment: released if authorized, then failed. */
  private async refuse(
    payment: PaymentRow,
    intent: PaymentIntentView | null,
    reason: string,
  ): Promise<never> {
    this.log.error({ ...this.fields, reason }, "PaymentIntent refused");
    if (intent !== null) await this.cancelAuthorization(intent);
    await this.finish(payment, "failed", PURCHASE_MESSAGES.failed);
    throw new PermanentJobError(`PaymentIntent ${this.paymentIntentId} refused: ${reason}`);
  }

  /** The intent is not authorized any more (cancelled, expired, never confirmed). */
  private async notAuthorized(payment: PaymentRow, intent: PaymentIntentView): Promise<never> {
    const message =
      intent.status === "canceled" ? PURCHASE_MESSAGES.cancelled : PURCHASE_MESSAGES.failed;
    this.log.warn({ ...this.fields, intentStatus: intent.status }, "PaymentIntent not authorized");
    await this.finish(payment, "failed", message);
    throw new PermanentJobError(
      `PaymentIntent ${this.paymentIntentId} is '${intent.status}', not awaiting capture`,
    );
  }

  /** The buyer's wallet from the payment e-mail, stored on the payment. */
  private async resolveBuyer(payment: PaymentRow, intent: PaymentIntentView): Promise<Address> {
    const email = payment.email ?? intent.payerEmail;
    if (email === null) {
      return this.refuse(payment, intent, "no e-mail to give the buyer a wallet");
    }
    let wallet: string;
    let normalised: string;
    try {
      const user = await resolveUserWallet(this.deps.db, this.deps.identity, email, "fan");
      wallet = user.walletAddress;
      normalised = user.email;
    } catch (error: unknown) {
      if (
        error instanceof IdentityConflictError ||
        error instanceof IdentityResponseError ||
        error instanceof InvalidEmailError
      ) {
        return this.refuse(payment, intent, `the buyer has no usable wallet (${error.name})`);
      }
      // The cause is left out on purpose: a directory's message may quote the e-mail.
      const name = error instanceof Error ? error.name : "unknown error";
      throw new RetryLaterError(
        this.options.retryDelayMs,
        `the identity directory could not resolve the buyer's wallet (${name})`,
      );
    }
    const stored = await this.deps.db`
      update payments set buyer = ${wallet}, email = coalesce(email, ${normalised})
      where stripe_pi = ${this.paymentIntentId} and (buyer is null or buyer = ${wallet})
      returning stripe_pi
    `;
    if (stored.length === 0) {
      return this.refuse(payment, intent, "the payment already names another buyer wallet");
    }
    return getAddress(wallet);
  }
}

/**
 * J-03, the purchase job (SPEC CO-2, CO-3, CO-4, PR-3, 9.2): the customer's card is authorized;
 * resolve their wallet, price the sale on the fresh book, sign the quote with the oracle key,
 * `buyFor` as the relayer, then capture. Never captures without a ticket, never buys twice for
 * one payment (key `buyFor:<payment intent id>:<attempt>`, attempts recorded in `chain_txs`), and
 * never releases an authorization while a transaction for it may still be mined. A passing
 * condition never sends the job to `dead` (see `runUntilSettled`): it ends when the payment is
 * `ticketed`, `cancelled_paused` or `failed`.
 */
export function createPurchaseHandler(deps: JobHandlerDeps): JobHandler<PurchaseJob> {
  const log = deps.logger.child({ module: "jobs.purchase" });
  const { retryDelayMs } = resolveOptions(deps.options);
  return (payload, ctx) =>
    runUntilSettled(
      deps,
      log,
      ctx,
      { paymentIntentId: payload.paymentIntentId },
      // Always committed: the customer's card is authorized and only this job settles the
      // payment. A deferral is a passing condition (a payment, identity or node outage, a
      // transaction not final yet, a ticket issued and not captured yet) and is retried until
      // the payment is settled; before anything is bought, a lapsed authorization settles it.
      () => Promise.resolve(true),
      () =>
        withExclusiveLock(deps.db, `job:purchase:${payload.paymentIntentId}`, retryDelayMs, () =>
          new Purchase(deps, log, ctx, payload.paymentIntentId).run(),
        ),
    );
}
