import { describe, expect, it } from "vitest";

import { chooseAuthProvider, isSignInFreePath } from "./provider-choice";

describe("chooseAuthProvider", () => {
  it("uses the simulated sign-in while the mock API is on, even with a Privy app id", () => {
    expect(chooseAuthProvider({ mockApi: true, privyAppId: undefined })).toEqual({
      kind: "simulated",
    });
    expect(chooseAuthProvider({ mockApi: true, privyAppId: "an-app-id" })).toEqual({
      kind: "simulated",
    });
  });

  it("uses Privy when the mock API is off and an app id is set", () => {
    expect(chooseAuthProvider({ mockApi: false, privyAppId: "  an-app-id " })).toEqual({
      kind: "privy",
      appId: "an-app-id",
    });
  });

  it("refuses to fall back to a fake sign-in when there is no app id", () => {
    for (const privyAppId of [undefined, "", "   "]) {
      const choice = chooseAuthProvider({ mockApi: false, privyAppId });
      expect(choice.kind).toBe("misconfigured");
      if (choice.kind === "misconfigured") {
        expect(choice.reason).toContain("NEXT_PUBLIC_PRIVY_APP_ID");
        expect(choice.reason).toContain("NEXT_PUBLIC_APP_API_MOCK");
      }
    }
  });
});

describe("isSignInFreePath", () => {
  it("is true for a fan's campaign page and ticket", () => {
    expect(isSignInFreePath("/c/joes-texas")).toBe(true);
    expect(isSignInFreePath("/t/abc123")).toBe(true);
  });

  it("is true for the public Hedge desk", () => {
    expect(isSignInFreePath("/hedge-desk")).toBe(true);
  });

  it("is true for the demo panel, which has its own key and no account", () => {
    expect(isSignInFreePath("/admin")).toBe(true);
  });

  it("is true for the landing page: Privy must not load for a visitor who has not met the app", () => {
    expect(isSignInFreePath("/landing")).toBe(true);
    expect(isSignInFreePath("/landing/kit")).toBe(true);
  });

  it("is false for everything that signs someone in or needs them signed in", () => {
    for (const path of ["/", "/start", "/business", "/new", "/home", "/tickets", "/campaigns/1"]) {
      expect(isSignInFreePath(path)).toBe(false);
    }
    expect(isSignInFreePath(null)).toBe(false);
  });

  it("does not match a path that merely starts with the same letter", () => {
    expect(isSignInFreePath("/campaigns")).toBe(false);
    expect(isSignInFreePath("/tickets")).toBe(false);
  });
});
