import type {
  CheckoutStatusResponse,
  DemoBookRequest,
  DemoResponse,
  DemoResultRequest,
  DemoSaleRequest,
} from "@winz/shared";

import { ApiError, apiFetch, isAbortError, isApiError } from "@/lib/api/client";

import { clearAdminKey, readAdminKey } from "./key";

/**
 * The calls of the demo panel. The key is read here, at the moment of the call, and goes out in the
 * `x-admin-key` header only (`apiFetch` sets it). It is not returned, not put in an error and not
 * written anywhere. A 401 means the server no longer accepts the key: it is forgotten at once, so
 * the panel goes back to the key screen instead of sending the next action into the same refusal.
 */

/** Thrown when an action is sent with no key in the tab. */
function noKey(): ApiError {
  return new ApiError(401, "unauthenticated", "Missing admin key");
}

async function withKey<T>(send: (key: string) => Promise<T>): Promise<T> {
  const key = readAdminKey();
  if (key === null) throw noKey();
  try {
    return await send(key);
  } catch (error: unknown) {
    if (isApiError(error) && error.status === 401) clearAdminKey();
    throw error;
  }
}

export function setBook(request: DemoBookRequest, signal?: AbortSignal): Promise<DemoResponse> {
  return withKey((adminKey) => apiFetch("demoBook", { body: request, adminKey, signal }));
}

export function forceResult(
  request: DemoResultRequest,
  signal?: AbortSignal,
): Promise<DemoResponse> {
  return withKey((adminKey) => apiFetch("demoResult", { body: request, adminKey, signal }));
}

export function replaySale(request: DemoSaleRequest, signal?: AbortSignal): Promise<DemoResponse> {
  return withKey((adminKey) => apiFetch("demoSale", { body: request, adminKey, signal }));
}

export function resetDemo(signal?: AbortSignal): Promise<DemoResponse> {
  return withKey((adminKey) => apiFetch("demoReset", { body: {}, adminKey, signal }));
}

// ---------------------------------------------------------------------------------------------
// Checking a key that has just been typed
// ---------------------------------------------------------------------------------------------

/**
 * A book the server refuses on purpose: prices off the 100 bps tick and an empty depth. The server
 * checks the key first, then the body (`route.ts`: authenticate, then readBody) and refuses this
 * one in `demoBookOf` before it reads or writes anything, so a good key meets a 400 and a wrong key
 * a 401, and neither changes a row. There is no other admin route that is free of effects.
 */
const PROBE: DemoBookRequest = { instrumentSymbol: "key-check", bidBps: 0, askBps: 0, depth: "0" };

export type KeyCheck =
  /** The server answered 400 or 404: it got past the key check. */
  | { outcome: "accepted" }
  /** The server answered 200 to a book it would refuse: the API is the simulated one, which checks no key. */
  | { outcome: "unchecked" }
  | { outcome: "rejected" }
  /** No answer, or a server error: nothing is known about the key. */
  | { outcome: "unknown"; message: string };

export async function checkAdminKey(key: string, signal?: AbortSignal): Promise<KeyCheck> {
  try {
    await apiFetch("demoBook", { body: PROBE, adminKey: key, signal });
    return { outcome: "unchecked" };
  } catch (error: unknown) {
    if (isAbortError(error)) throw error;
    if (isApiError(error)) {
      if (error.status === 401) return { outcome: "rejected" };
      if (error.status === 400 || error.status === 404) return { outcome: "accepted" };
      return { outcome: "unknown", message: error.message };
    }
    return { outcome: "unknown", message: "Something went wrong. Try again." };
  }
}

// ---------------------------------------------------------------------------------------------
// Following a replayed sale
// ---------------------------------------------------------------------------------------------

export type SaleOutcome =
  | { kind: "ticketed"; ticketToken: string }
  | { kind: "cancelled_paused" | "failed"; message: string | null }
  /** Still `processing` when the wait ran out: the ticket may yet arrive. */
  | { kind: "timeout" }
  /** The payment could not be read several times in a row: its state is unknown. */
  | { kind: "lost"; message: string };

export interface FollowSaleOptions {
  signal: AbortSignal;
  read: (paymentIntentId: string, signal: AbortSignal) => Promise<CheckoutStatusResponse>;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  pollMs?: number;
  timeoutMs?: number;
  maxReadFailures?: number;
  now?: () => number;
}

export const SALE_POLL_MS = 1_000;
export const SALE_TIMEOUT_MS = 90_000;
const MAX_READ_FAILURES = 5;

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * Reads `GET /api/checkout/:pi` until the payment reaches an end: `ticketed`, `failed` or
 * `cancelled_paused` (the same three a card payment ends in). Stops quietly when `signal` aborts
 * (the person left the page) and gives up after `timeoutMs`, saying so rather than guessing.
 */
export async function followSale(
  paymentIntentId: string,
  options: FollowSaleOptions,
): Promise<SaleOutcome | null> {
  const {
    signal,
    read,
    sleep = defaultSleep,
    pollMs = SALE_POLL_MS,
    timeoutMs = SALE_TIMEOUT_MS,
    maxReadFailures = MAX_READ_FAILURES,
    now = Date.now,
  } = options;
  const deadline = now() + timeoutMs;
  let failures = 0;
  for (;;) {
    if (signal.aborted) return null;
    try {
      const status = await read(paymentIntentId, signal);
      failures = 0;
      if (status.status === "ticketed" && status.ticketToken !== null) {
        return { kind: "ticketed", ticketToken: status.ticketToken };
      }
      if (status.status === "failed" || status.status === "cancelled_paused") {
        return { kind: status.status, message: status.message };
      }
    } catch (error: unknown) {
      if (signal.aborted || isAbortError(error)) return null;
      failures += 1;
      if (failures >= maxReadFailures) {
        const message = isApiError(error) ? error.message : "Something went wrong. Try again.";
        return { kind: "lost", message };
      }
    }
    if (now() >= deadline) return { kind: "timeout" };
    await sleep(pollMs, signal);
  }
}

export function readCheckoutStatus(
  paymentIntentId: string,
  signal: AbortSignal,
): Promise<CheckoutStatusResponse> {
  return apiFetch("checkoutStatus", { params: { pi: paymentIntentId }, signal });
}
