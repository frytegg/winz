"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuth, type AuthStatus } from "./auth-context";

/**
 * BRIEF section 7: not signed in → `/start`; signed in without a merchant → `/business`;
 * otherwise the screen asked for.
 *
 * - `anonymous`: the sign-in screen, for someone who is not signed in (anyone else is sent on).
 * - `signed-in`: the business screen, for a user who has no merchant yet.
 * - `merchant`: everything else of the merchant space.
 */
export type RouteNeed = "anonymous" | "signed-in" | "merchant";

export const SIGN_IN_PATH = "/start";
export const BUSINESS_PATH = "/business";
export const WIZARD_PATH = "/new?step=game";
export const HOME_PATH = "/home";

export interface GuardDecision {
  /** The screen can render. */
  ready: boolean;
  redirect: string | null;
}

/** Pure, so every case can be tested. */
export function resolveGuard(
  need: RouteNeed,
  status: AuthStatus,
  hasMerchant: boolean,
): GuardDecision {
  if (status === "loading") return { ready: false, redirect: null };
  if (need === "anonymous") {
    if (status === "anonymous") return { ready: true, redirect: null };
    return { ready: false, redirect: hasMerchant ? HOME_PATH : BUSINESS_PATH };
  }
  if (status === "anonymous") return { ready: false, redirect: SIGN_IN_PATH };
  if (need === "signed-in") {
    return hasMerchant ? { ready: false, redirect: WIZARD_PATH } : { ready: true, redirect: null };
  }
  return hasMerchant ? { ready: true, redirect: null } : { ready: false, redirect: BUSINESS_PATH };
}

/** Redirects when the user is not where they belong; returns whether the screen can render. */
export function useRouteGuard(need: RouteNeed): boolean {
  const { status, me } = useAuth();
  const router = useRouter();
  const decision = resolveGuard(need, status, me?.merchant != null);
  const { redirect } = decision;

  useEffect(() => {
    if (redirect !== null) router.replace(redirect);
  }, [redirect, router]);

  return decision.ready;
}
