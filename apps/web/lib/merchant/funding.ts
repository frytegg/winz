import type { CreateCampaignResponse, TopUpCampaignResponse } from "@winz/shared";

import { isApiError } from "@/lib/api/client";

/**
 * What the budget payment of a promo needs, whether it is the first budget (M7) or a top-up. The
 * back end creates the campaign (or the top-up) and its Stripe payment in one call; this is what
 * the payment buttons take from the answer.
 */
export interface PaymentToMake {
  paymentIntentId: string;
  clientSecret: string;
}

export interface FundingPlan {
  /** The campaign to open once the budget is paid (M8 for a new promo). */
  campaignId: string;
  /**
   * The payment to make, or `null` when there is nothing left to pay: the answer to a repeated
   * request for a campaign that is already live, or a top-up that is already credited. The screen
   * then goes on without opening the payment sheet.
   */
  payment: PaymentToMake | null;
}

/**
 * `POST /api/campaigns`. Only a `funding` campaign has something to pay (the payment of a campaign
 * that is already paid says so to Stripe, which the payment step handles); a `live`, paused, closed
 * or settled one is the answer to a request repeated after the budget was paid.
 */
export function planFromCreate(response: CreateCampaignResponse): FundingPlan {
  return {
    campaignId: response.campaignId,
    payment:
      response.status === "funding"
        ? {
            paymentIntentId: response.budgetPayment.paymentIntentId,
            clientSecret: response.budgetPayment.clientSecret,
          }
        : null,
  };
}

/**
 * `POST /api/campaigns/:id/top-up`: only a `requires_payment` top-up can be paid. `status` is
 * optional in the answer; without it the top-up is a new one, to be paid.
 */
export function planFromTopUp(response: TopUpCampaignResponse): FundingPlan {
  return {
    campaignId: response.campaignId,
    payment:
      response.status === undefined || response.status === "requires_payment"
        ? {
            paymentIntentId: response.budgetPayment.paymentIntentId,
            clientSecret: response.budgetPayment.clientSecret,
          }
        : null,
  };
}

/**
 * The `requestId` of a "Fund" request: a uuid chosen once and kept for every retry of the same
 * request, so a double tap or a retry after a dropped connection pays one campaign, not two. A new
 * request (other terms, or a request the back end says is over) gets a new one.
 */
export class RequestIds {
  private key: string | null = null;
  private id: string | null = null;

  /** The `requestId` for the request described by `key`; a different `key` is a new request. */
  idFor(key: string): string {
    if (this.id === null || this.key !== key) {
      this.key = key;
      this.id = crypto.randomUUID();
    }
    return this.id;
  }

  /** The next call starts a new request. */
  renew(): void {
    this.key = null;
    this.id = null;
  }
}

/** `503`: "This promo is still being created; try again in a moment". Nothing was cancelled. */
export function isStillCreating(error: unknown): boolean {
  return isApiError(error) && error.status === 503;
}

/**
 * `409 conflict`: the `requestId` was already used for other terms (or another top-up), so the same
 * `requestId` can never succeed: the next tap must be a new request.
 */
export function isRequestSpent(error: unknown): boolean {
  return isApiError(error) && error.status === 409 && error.code === "conflict";
}

/** How long to wait before sending the same `requestId` again after a `503`, one entry per retry. */
export const STILL_CREATING_DELAYS_MS: readonly number[] = [2000, 3000, 5000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `request`; while the back end answers 503 ("still being created"), sends it again after a
 * pause, with the same `requestId` (the caller's closure keeps it). After the last retry the 503 is
 * thrown, and the next tap starts the same request again. Any other error is thrown at once.
 */
export async function retryWhileCreating<T>(
  request: () => Promise<T>,
  wait: (ms: number) => Promise<void> = sleep,
  delays: readonly number[] = STILL_CREATING_DELAYS_MS,
): Promise<T> {
  for (const delay of delays) {
    try {
      return await request();
    } catch (error: unknown) {
      if (!isStillCreating(error)) throw error;
      await wait(delay);
    }
  }
  return request();
}
