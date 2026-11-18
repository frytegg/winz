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

  it("reads the engine lease's three settings, with their defaults", () => {
    const defaults = loadEngineEnv(valid);
    expect(defaults.ENGINE_LEASE_TTL_MS).toBe(15_000);
    expect(defaults.ENGINE_LEASE_RENEW_MS).toBe(3_000);
    expect(defaults.ENGINE_LEASE_STANDBY_POLL_MS).toBe(1_000);
    const set = loadEngineEnv({
      ...valid,
      ENGINE_LEASE_TTL_MS: "30000",
      ENGINE_LEASE_RENEW_MS: "5000",
      ENGINE_LEASE_STANDBY_POLL_MS: "500",
    });
    expect(set.ENGINE_LEASE_TTL_MS).toBe(30_000);
    expect(set.ENGINE_LEASE_RENEW_MS).toBe(5_000);
    expect(set.ENGINE_LEASE_STANDBY_POLL_MS).toBe(500);
  });

  it.each([
    ["ENGINE_LEASE_TTL_MS", "9999"],
    ["ENGINE_LEASE_TTL_MS", "300001"],
    ["ENGINE_LEASE_TTL_MS", "15s"],
    ["ENGINE_LEASE_RENEW_MS", "199"],
    ["ENGINE_LEASE_RENEW_MS", "2.5"],
    ["ENGINE_LEASE_STANDBY_POLL_MS", "99"],
  ])("refuses %s=%s, out of its bounds", (name, value) => {
    expect(issuesOf(() => loadEngineEnv({ ...valid, [name]: value }))).toContain(name);
  });

  it("refuses a renewal that is not well under the ttl, and a standby slower than the ttl", () => {
    // Fence after 15 000 - 5 000 ms: three renewals must fit, so at most 3 333 ms each.
    expect(loadEngineEnv({ ...valid, ENGINE_LEASE_RENEW_MS: "3333" }).ENGINE_LEASE_RENEW_MS).toBe(
      3_333,
    );
    expect(issuesOf(() => loadEngineEnv({ ...valid, ENGINE_LEASE_RENEW_MS: "3334" }))).toMatch(
      /ENGINE_LEASE_RENEW_MS: the lease renewal \(3334 ms\) must be at most a third/,
    );
    expect(
      issuesOf(() =>
        loadEngineEnv({
          ...valid,
          ENGINE_LEASE_TTL_MS: "10000",
          ENGINE_LEASE_STANDBY_POLL_MS: "10001",
        }),
      ),
    ).toMatch(/ENGINE_LEASE_STANDBY_POLL_MS: the standby poll \(10001 ms\) must not exceed/);
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
