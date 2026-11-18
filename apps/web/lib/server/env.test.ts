import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { serverConfigOf } from "./deps";
import {
  DEFAULT_QUICKNODE_STREAMS_NETWORK,
  EnvValidationError,
  isApiMock,
  webEnv,
  webEnvSchema,
} from "./env";
import { DEFAULT_STREAMS_NETWORK, streamsSettingsOf } from "./quicknode-webhook";

/** A complete environment of the web app (dummy values, never keys of anything). */
const COMPLETE = {
  APP_BASE_URL: "https://winz.example/",
  APP_ADMIN_DEMO_KEY: "a-long-enough-admin-key",
  DB_URL: "postgres://user:pass@localhost:5432/winz",
  STRIPE_SECRET_KEY: "sk_test_123",
  STRIPE_WEBHOOK_SECRET: "whsec_x",
  PRIVY_APP_SECRET: "secret",
  NEXT_PUBLIC_PRIVY_APP_ID: "app",
  ARC_ESCROW_ADDRESS: "0x2222222222222222222222222222222222222222",
};

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

describe("the QuickNode Stream's settings: one reader, the server's configuration", () => {
  it("has one default network, the schema's, which the route and the deliveries use", () => {
    expect(DEFAULT_STREAMS_NETWORK).toBe(DEFAULT_QUICKNODE_STREAMS_NETWORK);
    expect(webEnvSchema.shape.QUICKNODE_STREAMS_NETWORK.parse(undefined)).toBe(
      DEFAULT_STREAMS_NETWORK,
    );
    expect(serverConfigOf(webEnv(COMPLETE)).streamsNetwork).toBe(DEFAULT_STREAMS_NETWORK);
  });

  it("hands the route exactly what the environment says, an empty or blank token as unset", () => {
    const config = serverConfigOf(
      webEnv({
        ...COMPLETE,
        QUICKNODE_STREAMS_TOKEN: " qn-token ",
        QUICKNODE_STREAMS_NETWORK: "arc-mainnet",
      }),
    );
    expect(streamsSettingsOf(config)).toEqual({
      token: "qn-token",
      network: "arc-mainnet",
      escrowAddress: COMPLETE.ARC_ESCROW_ADDRESS,
    });
    for (const token of [undefined, "", "   "]) {
      const unset = serverConfigOf(webEnv({ ...COMPLETE, QUICKNODE_STREAMS_TOKEN: token }));
      expect(streamsSettingsOf(unset).token).toBeNull();
    }
    const blankNetwork = serverConfigOf(webEnv({ ...COMPLETE, QUICKNODE_STREAMS_NETWORK: " " }));
    expect(blankNetwork.streamsNetwork).toBe(DEFAULT_STREAMS_NETWORK);
  });

  it("is never read from process.env by the route itself", () => {
    const route = readFileSync(
      fileURLToPath(new URL("../../app/api/webhooks/quicknode/route.ts", import.meta.url)),
      "utf8",
    );
    expect(route).not.toContain("process.env");
    expect(route).toContain("streamsSettingsOf(deps.config())");
  });
});
