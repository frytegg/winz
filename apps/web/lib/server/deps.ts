import type { ExecutionVenueName } from "@winz/shared";

import type { AuthVerifier, IdentityDirectory } from "./auth";
import { getDb, type Db } from "./db";
import type { DemoSaleWait } from "./demo";
import { webEnv } from "./env";
import { StripePaymentGateway, type PaymentGateway } from "./payments-gateway";
import { PrivyIdentity } from "./privy";

/** Settings the read routes need, taken from the environment. */
export interface ServerConfig {
  /** `APP_ADMIN_DEMO_KEY`. */
  adminKey: string;
  /** `APP_BASE_URL` without a trailing slash, for the public campaign links. */
  baseUrl: string;
  /** `ARC_ESCROW_ADDRESS`, or null while the contract is not deployed. */
  escrowAddress: string | null;
  /** `APP_EXECUTION_VENUE`, shown on the Hedge desk. */
  executionVenue: ExecutionVenueName;
}

/** Everything a route implementation talks to. Tests build their own. */
export interface ServerDeps {
  db: Db;
  verifier: AuthVerifier;
  directory: IdentityDirectory;
  /** Card payments (Stripe in production, a fake in tests). */
  payments: PaymentGateway;
  config: () => ServerConfig;
  /** The clock. */
  now: () => Date;
  /**
   * How long `POST /api/admin/demo/sale` waits for the engine to issue the ticket, and how often it
   * looks. Absent: `DEMO_SALE_WAIT` (8 s, every 250 ms). Tests pass a short one.
   */
  demoSaleWait?: DemoSaleWait;
}

let defaults: ServerDeps | undefined;
let override: ServerDeps | undefined;

function configFromEnv(): ServerConfig {
  const env = webEnv();
  return {
    adminKey: env.APP_ADMIN_DEMO_KEY,
    baseUrl: env.APP_BASE_URL.replace(/\/+$/, ""),
    escrowAddress: env.ARC_ESCROW_ADDRESS ?? null,
    executionVenue: env.APP_EXECUTION_VENUE,
  };
}

/**
 * The dependencies of the running server, built on first use (never at import time): the shared
 * Postgres client, Privy, Stripe, the environment and the system clock.
 */
export function serverDeps(): ServerDeps {
  if (override) return override;
  if (!defaults) {
    const env = webEnv();
    const privy = new PrivyIdentity(() => ({
      appId: env.NEXT_PUBLIC_PRIVY_APP_ID,
      appSecret: env.PRIVY_APP_SECRET,
    }));
    defaults = {
      db: getDb(),
      verifier: privy,
      directory: privy,
      payments: new StripePaymentGateway(() => ({
        secretKey: env.STRIPE_SECRET_KEY,
        webhookSecret: env.STRIPE_WEBHOOK_SECRET,
      })),
      config: configFromEnv,
      now: () => new Date(),
    };
  }
  return defaults;
}

/** Test only: makes the route files use these dependencies; `undefined` restores the real ones. */
export function setServerDepsForTesting(deps: ServerDeps | undefined): void {
  override = deps;
}
