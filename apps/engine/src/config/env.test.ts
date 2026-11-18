import { describe, expect, it } from "vitest";

import { EnvValidationError, loadEngineEnv } from "./env";

const valid = {
  APP_ADMIN_DEMO_KEY: "a-long-enough-admin-key",
  DB_URL: "postgres://user:pass@localhost:5432/winz",
  ARC_RPC_URL: "https://example.quiknode.pro/abc",
  ARC_ESCROW_ADDRESS: "0x1111111111111111111111111111111111111111",
  ARC_ESCROW_DEPLOY_BLOCK: "72727350",
  ARC_RELAYER_PRIVATE_KEY: `0x${"11".repeat(32)}`,
  ARC_ORACLE_PRIVATE_KEY: `0x${"22".repeat(32)}`,
  STRIPE_SECRET_KEY: "sk_test_123",
  NEXT_PUBLIC_PRIVY_APP_ID: "app",
  PRIVY_APP_SECRET: "secret",
};
const DEMO_SEED = `0x${"33".repeat(32)}`;

/** The message of every issue of the configuration error `load` throws. */
function issuesOf(load: () => unknown): string {
  try {
    load();
  } catch (error: unknown) {
    if (error instanceof EnvValidationError) return error.issues.join("\n");
    throw error;
  }
  throw new Error("expected the environment to be refused");
}

describe("loadEngineEnv", () => {
  it("applies defaults for Arc testnet and Gemini", () => {
    const env = loadEngineEnv(valid);
    expect(env.ARC_CHAIN_ID).toBe(5_042_002);
    expect(env.ARC_ESCROW_DEPLOY_BLOCK).toBe(72_727_350n);
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

  it("starts without Stripe: only demo payments can then be sold", () => {
    const { STRIPE_SECRET_KEY: _stripe, ...withoutStripe } = valid;
    expect(loadEngineEnv(withoutStripe).STRIPE_SECRET_KEY).toBeUndefined();
  });

  it("starts without Privy only when the demo wallet seed is set", () => {
    const { NEXT_PUBLIC_PRIVY_APP_ID: _id, PRIVY_APP_SECRET: _secret, ...withoutPrivy } = valid;
    expect(issuesOf(() => loadEngineEnv(withoutPrivy))).toContain("APP_DEMO_WALLET_SEED");
    const env = loadEngineEnv({ ...withoutPrivy, APP_DEMO_WALLET_SEED: DEMO_SEED });
    expect(env.NEXT_PUBLIC_PRIVY_APP_ID).toBeUndefined();
    expect(env.APP_DEMO_WALLET_SEED).toBe(DEMO_SEED);
  });

  it("refuses half of the Privy credentials, naming the missing one", () => {
    const { PRIVY_APP_SECRET: _secret, ...idOnly } = valid;
    expect(issuesOf(() => loadEngineEnv(idOnly))).toContain("PRIVY_APP_SECRET");
    const { NEXT_PUBLIC_PRIVY_APP_ID: _id, ...secretOnly } = valid;
    expect(
      issuesOf(() => loadEngineEnv({ ...secretOnly, APP_DEMO_WALLET_SEED: DEMO_SEED })),
    ).toContain("NEXT_PUBLIC_PRIVY_APP_ID");
  });

  it("refuses a demo wallet seed that is not 32 bytes", () => {
    expect(issuesOf(() => loadEngineEnv({ ...valid, APP_DEMO_WALLET_SEED: "0x1234" }))).toContain(
      "APP_DEMO_WALLET_SEED",
    );
  });

  it("sizes the database pool, within bounds", () => {
    expect(loadEngineEnv(valid).DB_POOL_MAX).toBe(20);
    expect(loadEngineEnv({ ...valid, DB_POOL_MAX: "12" }).DB_POOL_MAX).toBe(12);
    expect(issuesOf(() => loadEngineEnv({ ...valid, DB_POOL_MAX: "2" }))).toContain("DB_POOL_MAX");
  });

  it("leaves the RPC limits unset unless given, and reads them when they are", () => {
    const unset = loadEngineEnv(valid);
    expect(unset.ARC_RPC_MAX_REQUESTS_PER_SECOND).toBeUndefined();
    expect(unset.ARC_RPC_MAX_HEAVY_REQUESTS_PER_SECOND).toBeUndefined();
    expect(unset.ARC_RPC_HEAVY_METHODS).toBeUndefined();

    const set = loadEngineEnv({
      ...valid,
      ARC_RPC_MAX_REQUESTS_PER_SECOND: "25",
      ARC_RPC_MAX_HEAVY_REQUESTS_PER_SECOND: "2.5",
      ARC_RPC_HEAVY_METHODS: " eth_getLogs, eth_estimateGas ,",
    });
    expect(set.ARC_RPC_MAX_REQUESTS_PER_SECOND).toBe(25);
    expect(set.ARC_RPC_MAX_HEAVY_REQUESTS_PER_SECOND).toBe(2.5);
    expect(set.ARC_RPC_HEAVY_METHODS).toEqual(["eth_getLogs", "eth_estimateGas"]);
  });

  it("leaves the sender's window unset unless given, and reads it when it is", () => {
    expect(loadEngineEnv(valid).ARC_TX_MAX_IN_FLIGHT).toBeUndefined();
    expect(loadEngineEnv({ ...valid, ARC_TX_MAX_IN_FLIGHT: "1" }).ARC_TX_MAX_IN_FLIGHT).toBe(1);
    expect(loadEngineEnv({ ...valid, ARC_TX_MAX_IN_FLIGHT: "12" }).ARC_TX_MAX_IN_FLIGHT).toBe(12);
  });

  it.each(["0", "65", "2.5", "many"])("refuses a sender window of %s", (value) => {
    expect(issuesOf(() => loadEngineEnv({ ...valid, ARC_TX_MAX_IN_FLIGHT: value }))).toContain(
      "ARC_TX_MAX_IN_FLIGHT",
    );
  });

  it("refuses RPC limits that cannot work", () => {
    expect(
      issuesOf(() => loadEngineEnv({ ...valid, ARC_RPC_MAX_REQUESTS_PER_SECOND: "0" })),
    ).toContain("ARC_RPC_MAX_REQUESTS_PER_SECOND");
    expect(
      issuesOf(() => loadEngineEnv({ ...valid, ARC_RPC_MAX_HEAVY_REQUESTS_PER_SECOND: "fast" })),
    ).toContain("ARC_RPC_MAX_HEAVY_REQUESTS_PER_SECOND");
    expect(issuesOf(() => loadEngineEnv({ ...valid, ARC_RPC_HEAVY_METHODS: "getLogs" }))).toContain(
      "ARC_RPC_HEAVY_METHODS",
    );
    expect(issuesOf(() => loadEngineEnv({ ...valid, ARC_RPC_HEAVY_METHODS: " , " }))).toContain(
      "ARC_RPC_HEAVY_METHODS",
    );
  });
});
