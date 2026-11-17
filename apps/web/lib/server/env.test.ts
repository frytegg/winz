import { describe, expect, it } from "vitest";

import { EnvValidationError, isApiMock, webEnv } from "./env";

describe("isApiMock", () => {
  it("is on only when APP_API_MOCK is exactly true", () => {
    expect(isApiMock({ APP_API_MOCK: "true" })).toBe(true);
    expect(isApiMock({ APP_API_MOCK: "1" })).toBe(false);
    expect(isApiMock({})).toBe(false);
  });

  it("is never honoured in production", () => {
    expect(isApiMock({ APP_API_MOCK: "true", APP_ENV: "production" })).toBe(false);
    expect(isApiMock({ APP_API_MOCK: "true", VERCEL_ENV: "production" })).toBe(false);
    expect(isApiMock({ APP_API_MOCK: "true", VERCEL_ENV: "preview" })).toBe(true);
  });
});

describe("webEnv", () => {
  it("names every missing variable in one error", () => {
    expect.assertions(3);
    try {
      webEnv({});
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const issues = (error as EnvValidationError).issues.join("\n");
      expect(issues).toContain("DB_URL");
      expect(issues).toContain("STRIPE_WEBHOOK_SECRET");
    }
  });

  it("refuses a live Stripe key", () => {
    expect(() =>
      webEnv({
        APP_BASE_URL: "https://winz.example",
        APP_ADMIN_DEMO_KEY: "a-long-enough-admin-key",
        DB_URL: "postgres://user:pass@localhost:5432/winz",
        STRIPE_SECRET_KEY: "sk_live_123",
        STRIPE_WEBHOOK_SECRET: "whsec_x",
        PRIVY_APP_SECRET: "secret",
        NEXT_PUBLIC_PRIVY_APP_ID: "app",
        QUICKNODE_STREAMS_TOKEN: "token",
      }),
    ).toThrow(EnvValidationError);
  });
});
