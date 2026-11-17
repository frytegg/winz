import { describe, expect, it } from "vitest";

import { EnvValidationError, loadEngineEnv } from "./env";

const valid = {
  APP_ADMIN_DEMO_KEY: "a-long-enough-admin-key",
  DB_URL: "postgres://user:pass@localhost:5432/winz",
  ARC_RPC_URL: "https://example.quiknode.pro/abc",
  ARC_ESCROW_ADDRESS: "0x1111111111111111111111111111111111111111",
  ARC_RELAYER_PRIVATE_KEY: `0x${"11".repeat(32)}`,
  ARC_ORACLE_PRIVATE_KEY: `0x${"22".repeat(32)}`,
  STRIPE_SECRET_KEY: "sk_test_123",
  PRIVY_APP_ID: "app",
  PRIVY_APP_SECRET: "secret",
};

describe("loadEngineEnv", () => {
  it("applies defaults for Arc testnet and Gemini", () => {
    const env = loadEngineEnv(valid);
    expect(env.ARC_CHAIN_ID).toBe(5_042_002);
    expect(env.ARC_USDC_ADDRESS).toBe("0x3600000000000000000000000000000000000000");
    expect(env.GEMINI_API_URL).toBe("https://api.gemini.com");
    expect(env.APP_EXECUTION_VENUE).toBe("paper");
    expect(env.APP_API_MOCK).toBe(false);
  });

  it("lists every missing variable in one error", () => {
    expect.assertions(3);
    try {
      loadEngineEnv({});
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const issues = (error as EnvValidationError).issues.join("\n");
      expect(issues).toContain("DB_URL");
      expect(issues).toContain("ARC_ORACLE_PRIVATE_KEY");
    }
  });

  it("treats an empty string as unset", () => {
    const env = loadEngineEnv({ ...valid, GEMINI_SANDBOX_API_KEY: "", ARC_CHAIN_ID: "" });
    expect(env.GEMINI_SANDBOX_API_KEY).toBeUndefined();
    expect(env.ARC_CHAIN_ID).toBe(5_042_002);
  });

  it("refuses a live Stripe key", () => {
    expect(() => loadEngineEnv({ ...valid, STRIPE_SECRET_KEY: "sk_live_123" })).toThrow(
      EnvValidationError,
    );
  });
});
