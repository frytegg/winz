import { z } from "zod";

/**
 * Jobs the web app enqueues and the engine executes (SPEC section 7: web routes only insert
 * jobs; every on-chain write happens in the engine). This file is the contract between the two:
 * the job kind, its payload, and the idempotency key that makes a replayed webhook harmless.
 *
 * Delivery is at-least-once: every handler must be safe to run twice.
 */

/** A merchant's budget payment succeeded: create the campaign on-chain and put it live. */
export const createCampaignJobSchema = z.object({
  campaignId: z.uuid(),
});

/** A customer's card was authorized: resolve the buyer, quote, buy the ticket, capture. */
export const purchaseJobSchema = z.object({
  paymentIntentId: z.string().min(1),
});

/** The merchant paused or resumed sales by hand (the only pause written on-chain). */
export const setPausedJobSchema = z.object({
  campaignId: z.uuid(),
  paused: z.boolean(),
  /** Distinguishes two successive pauses of the same campaign. */
  requestId: z.uuid(),
});

/** The merchant closed sales early. */
export const closeSalesJobSchema = z.object({
  campaignId: z.uuid(),
});

/**
 * The merchant's card paid a top-up of a running campaign's hedge budget (SPEC CA-6): add it to
 * the escrow with `topUpBudgetFor`, or refund the card when the campaign can no longer take it.
 */
export const topUpBudgetJobSchema = z.object({
  campaignId: z.uuid(),
  /** The top-up, micro-USDC as a string of digits (the amount the card paid). */
  amount: z.string().regex(/^[1-9]\d*$/, "a positive amount of micro-USDC as a string of digits"),
  /** The PaymentIntent of the top-up. */
  paymentIntentId: z.string().min(1),
  /** The merchant's `requestId` of POST /api/campaigns/:id/top-up. */
  requestId: z.uuid(),
});

export const JOB_KINDS = {
  createCampaign: "campaign.create",
  purchase: "purchase",
  setPaused: "campaign.set_paused",
  closeSales: "campaign.close_sales",
  topUpBudget: "campaign.top_up",
} as const;

export type JobKind = (typeof JOB_KINDS)[keyof typeof JOB_KINDS];

export const JOB_PAYLOAD_SCHEMAS = {
  [JOB_KINDS.createCampaign]: createCampaignJobSchema,
  [JOB_KINDS.purchase]: purchaseJobSchema,
  [JOB_KINDS.setPaused]: setPausedJobSchema,
  [JOB_KINDS.closeSales]: closeSalesJobSchema,
  [JOB_KINDS.topUpBudget]: topUpBudgetJobSchema,
} as const;

export type CreateCampaignJob = z.infer<typeof createCampaignJobSchema>;
export type PurchaseJob = z.infer<typeof purchaseJobSchema>;
export type SetPausedJob = z.infer<typeof setPausedJobSchema>;
export type CloseSalesJob = z.infer<typeof closeSalesJobSchema>;
export type TopUpBudgetJob = z.infer<typeof topUpBudgetJobSchema>;

/**
 * Idempotency keys are unique across ALL job kinds, so each starts with its kind.
 * Enqueueing the same key twice returns the first job.
 */
export const jobIdempotencyKey = {
  createCampaign: (campaignId: string): string => `${JOB_KINDS.createCampaign}:${campaignId}`,
  purchase: (paymentIntentId: string): string => `${JOB_KINDS.purchase}:${paymentIntentId}`,
  setPaused: (requestId: string): string => `${JOB_KINDS.setPaused}:${requestId}`,
  closeSales: (campaignId: string): string => `${JOB_KINDS.closeSales}:${campaignId}`,
  /** One job per top-up payment: a duplicate webhook delivery enqueues nothing. */
  topUpBudget: (paymentIntentId: string): string => `${JOB_KINDS.topUpBudget}:${paymentIntentId}`,
} as const;

/** What `metadata.kind` says on a Stripe PaymentIntent, so the webhook knows what was paid. */
export const STRIPE_PAYMENT_KINDS = {
  /** The merchant funds a campaign budget (captured at once). */
  campaignBudget: "campaign_budget",
  /** A customer buys units (authorized, captured only once the ticket exists). */
  purchase: "purchase",
  /** The merchant adds hedge budget to a running campaign (captured at once, like the budget). */
  campaignBudgetTopUp: "campaign_budget_top_up",
} as const;

export type StripePaymentKind = (typeof STRIPE_PAYMENT_KINDS)[keyof typeof STRIPE_PAYMENT_KINDS];
