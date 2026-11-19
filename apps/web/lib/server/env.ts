import { EXECUTION_VENUES } from "@winz/shared";
import { z } from "zod";

const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");

/**
 * QuickNode's name of Arc testnet in a delivery's metadata, the default of
 * `QUICKNODE_STREAMS_NETWORK`. QuickNode's documentation names networks `<chain>-<network>`
 * (`ethereum-mainnet`) but lists Arc's without its identifier: the first real delivery confirms it.
 */
export const DEFAULT_QUICKNODE_STREAMS_NETWORK = "arc-testnet";

/**
 * Server-side environment of the web app. Read lazily (first call), never at import time,
 * so `next build` does not need production secrets.
 */
export const webEnvSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  APP_BASE_URL: z.string().url(),
  APP_API_MOCK: booleanString.default(false),
  APP_ADMIN_DEMO_KEY: z.string().min(16),
  /**
   * Where the engine executes hedge orders, shown in clear on the Hedge desk (MDB-3). Must match
   * the engine's own `APP_EXECUTION_VENUE`: the web app only displays it.
   */
  APP_EXECUTION_VENUE: z.enum(EXECUTION_VENUES).default("paper"),
  DB_URL: z.string().url(),
  /**
   * Connections one server instance keeps to the database (default 3). Small on purpose: through
   * Supabase's session pooler every client connection holds a Postgres connection, and every
   * instance of the web app has its own pool (docs/deploy.md, step 1.4).
   */
  DB_POOL_MAX: z.coerce.number().int().min(1).max(20).default(3),
  STRIPE_SECRET_KEY: z.string().startsWith("sk_test_", "only Stripe test keys are allowed"),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  PRIVY_APP_SECRET: z.string().min(1),
  NEXT_PUBLIC_PRIVY_APP_ID: z.string().min(1),
  /**
   * Security token of the QuickNode Stream (docs/quicknode.md). Optional: without it,
   * `POST /api/webhooks/quicknode` answers 503 and the engine's two other sources carry the events.
   */
  QUICKNODE_STREAMS_TOKEN: z.string().min(1).optional(),
  /** QuickNode's name of the stream's network, checked on every delivery. Default `arc-testnet`. */
  QUICKNODE_STREAMS_NETWORK: z.string().min(1).default(DEFAULT_QUICKNODE_STREAMS_NETWORK),
  /**
   * Address of the deployed WinzEscrow on Arc testnet, shown in the collapsed "technical details"
   * of a campaign. Optional: until the contract is deployed, `onchain` is null in the answers.
   */
  ARC_ESCROW_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "an address: 0x followed by 40 hex digits")
    .optional(),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

/**
 * Variables of the browser's bundle, inlined by Next.js at build time and never read by the
 * server: `webEnv` does not check them (a server without them still answers), `pnpm env:check web`
 * does, with the same rules as the code that reads them.
 */
export const webBuildEnvSchema = z.object({
  /**
   * Stripe's publishable key, for every payment screen. apps/web/lib/stripe/client.ts uses only a
   * test key (`pk_test_`) and otherwise shows "payment unavailable".
   */
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z
    .string()
    .startsWith(
      "pk_test_",
      "only a Stripe test publishable key (pk_test_...) is used by the front",
    ),
});

export class EnvValidationError extends Error {
  constructor(public readonly issues: readonly string[]) {
    super(`Invalid environment:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
    this.name = "EnvValidationError";
  }
}

function clean(source: Record<string, string | undefined>): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ""));
}

/**
 * In mock mode the routes serve example payloads and need no backing service.
 * Never honoured in production: a stray `APP_API_MOCK=true` there would serve fake data
 * to real users, with no authentication.
 */
export function isApiMock(source: Record<string, string | undefined> = process.env): boolean {
  if (source.APP_API_MOCK !== "true") return false;
  return source.APP_ENV !== "production" && source.VERCEL_ENV !== "production";
}

let cached: WebEnv | undefined;

/** Full server environment. Throws one error naming every missing or malformed variable. */
export function webEnv(source: Record<string, string | undefined> = process.env): WebEnv {
  if (cached && source === process.env) return cached;
  const result = webEnvSchema.safeParse(clean(source));
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  if (source === process.env) cached = result.data;
  return result.data;
}
