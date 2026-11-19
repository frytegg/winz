import { describe, expect, it } from "vitest";

import { entryFromQuery, resolveGuard, type RouteNeed, type SignInEntry } from "./route-guard";

describe("resolveGuard", () => {
  it("waits while the session is being checked, and while the API cannot be reached", () => {
    for (const need of ["anonymous", "signed-in", "merchant", "account"] as const) {
      for (const entry of ["merchant", "fan"] as const) {
        for (const hasMerchant of [false, true]) {
          for (const status of ["loading", "unreachable"] as const) {
            expect(resolveGuard(need, status, hasMerchant, entry)).toEqual({
              ready: false,
              redirect: null,
            });
          }
        }
      }
    }
  });

  it("sends someone who is not signed in to /start", () => {
    expect(resolveGuard("merchant", "anonymous", false).redirect).toBe("/start");
    expect(resolveGuard("signed-in", "anonymous", false).redirect).toBe("/start");
    expect(resolveGuard("anonymous", "anonymous", false)).toEqual({ ready: true, redirect: null });
  });

  it("sends a signed-in user without a merchant to /business", () => {
    expect(resolveGuard("merchant", "authenticated", false).redirect).toBe("/business");
    expect(resolveGuard("anonymous", "authenticated", false).redirect).toBe("/business");
    expect(resolveGuard("signed-in", "authenticated", false)).toEqual({
      ready: true,
      redirect: null,
    });
  });

  it("lets a merchant through, and keeps them out of sign-in and business", () => {
    expect(resolveGuard("merchant", "authenticated", true)).toEqual({
      ready: true,
      redirect: null,
    });
    expect(resolveGuard("anonymous", "authenticated", true).redirect).toBe("/home");
    expect(resolveGuard("signed-in", "authenticated", true).redirect).toBe("/new?step=game");
  });

  it("sends whoever signs in from the fan's entry to « My tickets », never to /business", () => {
    expect(resolveGuard("anonymous", "authenticated", false, "fan").redirect).toBe("/tickets");
    expect(resolveGuard("anonymous", "authenticated", true, "fan").redirect).toBe("/tickets");
    expect(resolveGuard("anonymous", "anonymous", false, "fan")).toEqual({
      ready: true,
      redirect: null,
    });
  });

  it("keeps today's path for the merchant's entry", () => {
    expect(resolveGuard("anonymous", "authenticated", false, "merchant").redirect).toBe(
      "/business",
    );
    expect(resolveGuard("anonymous", "authenticated", true, "merchant").redirect).toBe("/home");
  });

  it("opens « My tickets » to anyone signed in, merchant or not, and asks the others to sign in as a fan", () => {
    for (const entry of ["merchant", "fan"] as const) {
      expect(resolveGuard("account", "authenticated", false, entry)).toEqual({
        ready: true,
        redirect: null,
      });
      expect(resolveGuard("account", "authenticated", true, entry)).toEqual({
        ready: true,
        redirect: null,
      });
      expect(resolveGuard("account", "anonymous", false, entry)).toEqual({
        ready: false,
        redirect: "/start?from=tickets",
      });
    }
  });

  it("leaves the merchant space as it was, whatever the entry", () => {
    const needs: RouteNeed[] = ["signed-in", "merchant"];
    const entries: SignInEntry[] = ["merchant", "fan"];
    for (const need of needs) {
      for (const hasMerchant of [false, true]) {
        for (const status of ["anonymous", "authenticated"] as const) {
          const merchantEntry = resolveGuard(need, status, hasMerchant, "merchant");
          for (const entry of entries) {
            expect(resolveGuard(need, status, hasMerchant, entry)).toEqual(merchantEntry);
          }
        }
      }
    }
  });
});

describe("entryFromQuery", () => {
  it("is the fan's for ?from=tickets only", () => {
    expect(entryFromQuery("tickets")).toBe("fan");
    expect(entryFromQuery(null)).toBe("merchant");
    expect(entryFromQuery("")).toBe("merchant");
    expect(entryFromQuery("home")).toBe("merchant");
  });
});
