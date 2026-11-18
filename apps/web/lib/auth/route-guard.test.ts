import { describe, expect, it } from "vitest";

import { resolveGuard } from "./route-guard";

describe("resolveGuard", () => {
  it("waits while the session is being checked", () => {
    for (const need of ["anonymous", "signed-in", "merchant"] as const) {
      expect(resolveGuard(need, "loading", false)).toEqual({ ready: false, redirect: null });
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
});
