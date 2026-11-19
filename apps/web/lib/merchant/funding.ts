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
 * Where a request id is kept between two loads of the page: the tab's `sessionStorage`. Only
 * what the request ids use of it.
 */
export interface RequestIdStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The tab's `sessionStorage`; `null` on the server, or where the browser refuses it. */
export function sessionRequestStorage(): RequestIdStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface StoredRequest {
  key: string;
  id: string;
}

function parseStored(raw: string | null): StoredRequest | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { key, id } = value as { key?: unknown; id?: unknown };
    return typeof key === "string" && typeof id === "string" && UUID.test(id) ? { key, id } : null;
  } catch {
    return null;
  }
}

/**
 * The `requestId` of a "Fund" request: a uuid chosen once and kept for every retry of the same
 * request, so a double tap or a retry after a dropped connection pays one campaign, not two. A new
 * request (other terms, or a request the back end says is over) gets a new one.
 *
 * With a `storageKey`, the pair (key of the request, id) is also written to the tab's storage, at
 * once, by `idFor` itself: before the request leaves, and outside React's state, whose update can
 * run after the request has started. A reload, or the screen mounted again, reads it back and asks
 * for the same request. Where the storage throws or is full (private mode), the id lives in memory
 * only, without an error.
 */
export class RequestIds {
  private key: string | null = null;
  private id: string | null = null;

  constructor(
    private readonly storageKey: string | null = null,
    private readonly storage: () => RequestIdStorage | null = sessionRequestStorage,
  ) {}

  /** The `requestId` for the request described by `key`; a different `key` is a new request. */
  idFor(key: string): string {
    const stored = this.read();
    if (stored !== null && stored.key === key) {
      this.key = stored.key;
      this.id = stored.id;
      return stored.id;
    }
    if (this.id === null || this.key !== key) {
      this.key = key;
      this.id = crypto.randomUUID();
    }
    this.write({ key, id: this.id });
    return this.id;
  }

  /** The next call starts a new request (after a success, or a request the back end says is over). */
  renew(): void {
    this.key = null;
    this.id = null;
    if (this.storageKey === null) return;
    try {
      this.storage()?.removeItem(this.storageKey);
    } catch {
      // Blocked storage: nothing was kept there either.
    }
  }

  private read(): StoredRequest | null {
    if (this.storageKey === null) return null;
    try {
      return parseStored(this.storage()?.getItem(this.storageKey) ?? null);
    } catch {
      return null;
    }
  }

  private write(request: StoredRequest): void {
    if (this.storageKey === null) return;
    try {
      this.storage()?.setItem(this.storageKey, JSON.stringify(request));
    } catch {
      // Private mode or a full storage: the id lives in memory only, for this page.
    }
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

/**
 * Sends the request described by `key` with its `requestId`, chosen (and stored) before anything
 * leaves. While the answer is 503 the same request is sent again (`retryWhileCreating`); any other
 * failure keeps the request for the next tap, except a 409 "spent", after which the next tap is a
 * new request.
 */
export async function sendRequest<T>(
  ids: RequestIds,
  key: string,
  send: (requestId: string) => Promise<T>,
  wait?: (ms: number) => Promise<void>,
): Promise<T> {
  const requestId = ids.idFor(key);
  try {
    return await retryWhileCreating(() => send(requestId), wait);
  } catch (error: unknown) {
    if (isRequestSpent(error)) ids.renew();
    throw error;
  }
}

/**
 * `sendRequest`, and when the answer is 409 "spent" (a top-up refused at the card is over: its
 * repeat answers "This top-up request is over"), a new request is sent once more within the same
 * tap, instead of showing the 409 and asking for a third tap. A second 409 is shown.
 */
export async function sendRenewingOnce<T>(
  ids: RequestIds,
  key: string,
  send: (requestId: string) => Promise<T>,
  wait?: (ms: number) => Promise<void>,
): Promise<T> {
  try {
    return await sendRequest(ids, key, send, wait);
  } catch (error: unknown) {
    if (!isRequestSpent(error)) throw error;
    return sendRequest(ids, key, send, wait);
  }
}
