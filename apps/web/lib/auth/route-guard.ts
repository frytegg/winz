"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuth, type AuthStatus } from "./auth-context";

/**
 * BRIEF section 7: not signed in → `/start`; signed in without a merchant → `/business`;
 * otherwise the screen asked for. A fan is not a merchant to be (review 2.7, ID-1): whoever signs
 * in from the fan's entry lands on « My tickets ».
 *
 * - `anonymous`: the sign-in screen, for someone who is not signed in (anyone else is sent on).
 * - `signed-in`: the business screen, for a user who has no merchant yet.
 * - `merchant`: everything else of the merchant space.
 * - `account`: « My tickets » (C4), for anyone signed in, merchant or not.
 */
export type RouteNeed = "anonymous" | "signed-in" | "merchant" | "account";

/**
 * Where the person came to the sign-in from: the merchant's entry (« Start a promo », the merchant
 * space) or the fan's (M0's « I'm a fan », `/tickets` itself). Carried by the sign-in's URL
 * (`ENTRY_PARAM`), so that it survives the code step and a reload.
 */
export type SignInEntry = "merchant" | "fan";

export const ENTRY_PARAM = "from";
export const FAN_ENTRY_VALUE = "tickets";

export const SIGN_IN_PATH = "/start";
export const BUSINESS_PATH = "/business";
export const WIZARD_PATH = "/new?step=game";
export const HOME_PATH = "/home";
export const TICKETS_PATH = "/tickets";
/** The sign-in from the fan's entry: it ends on « My tickets ». */
export const FAN_SIGN_IN_PATH = `${SIGN_IN_PATH}?${ENTRY_PARAM}=${FAN_ENTRY_VALUE}`;

/** The entry a sign-in URL's query says (`?from=tickets` is the fan's), the merchant's otherwise. */
export function entryFromQuery(value: string | null): SignInEntry {
  return value === FAN_ENTRY_VALUE ? "fan" : "merchant";
}

export interface GuardDecision {
  /** The screen can render. */
  ready: boolean;
  redirect: string | null;
}

/**
 * Pure, so every case can be tested. `entry` only matters to the sign-in screen and to
 * « My tickets »: the merchant space keeps its own path whoever opens it. A person's roles
 * (`GET /api/me`) need no case of their own: a fan, a new user and a merchant who come in through
 * the fan's entry all land on their tickets, and through the merchant's entry only the merchant
 * profile decides between `/home` and `/business`.
 */
export function resolveGuard(
  need: RouteNeed,
  status: AuthStatus,
  hasMerchant: boolean,
  entry: SignInEntry = "merchant",
): GuardDecision {
  // `unreachable`: the screen waits behind « can't reach Winz » (UnreachableGate), nobody moves.
  if (status === "loading" || status === "unreachable") return { ready: false, redirect: null };
  if (need === "anonymous") {
    if (status === "anonymous") return { ready: true, redirect: null };
    if (entry === "fan") return { ready: false, redirect: TICKETS_PATH };
    return { ready: false, redirect: hasMerchant ? HOME_PATH : BUSINESS_PATH };
  }
  if (need === "account") {
    if (status === "anonymous") return { ready: false, redirect: FAN_SIGN_IN_PATH };
    return { ready: true, redirect: null };
  }
  if (status === "anonymous") return { ready: false, redirect: SIGN_IN_PATH };
  if (need === "signed-in") {
    return hasMerchant ? { ready: false, redirect: WIZARD_PATH } : { ready: true, redirect: null };
  }
  return hasMerchant ? { ready: true, redirect: null } : { ready: false, redirect: BUSINESS_PATH };
}

/**
 * Redirects when the user is not where they belong; returns whether the screen can render. The
 * sign-in screen passes the entry it read from its URL (`entryFromQuery`); no other screen needs to.
 */
export function useRouteGuard(need: RouteNeed, entry: SignInEntry = "merchant"): boolean {
  const { status, me } = useAuth();
  const router = useRouter();
  const decision = resolveGuard(need, status, me?.merchant != null, entry);
  const { redirect } = decision;

  useEffect(() => {
    if (redirect !== null) router.replace(redirect);
  }, [redirect, router]);

  return decision.ready;
}
