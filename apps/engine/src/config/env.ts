import { z } from "zod";

const hexAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 20-byte hex address");
const privateKey = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a 32-byte hex private key");
const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");

/**
 * Everything the engine reads from the environment. Parsed once at startup:
 * a missing or malformed variable stops the process with the full list, before any I/O.
 */
export const engineEnvSchema = z
  .object({
    APP_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    APP_EXECUTION_VENUE: z.enum(["paper", "gemini-sandbox"]).default("paper"),
    APP_ADMIN_DEMO_KEY: z.string().min(16),

    DB_URL: z.string().url(),
    // Connections of the engine's pool. The job worker holds one per running job for its lock, and
    // the sender, the chain reader, hedging, settlement and the sale states share the rest.
    DB_POOL_MAX: z.coerce.number().int().min(6).max(100).default(20),

    ARC_CHAIN_ID: z.coerce.number().int().positive().default(5_042_002),
    ARC_RPC_URL: z.string().url(),
    ARC_RPC_FALLBACK_URL: z.string().url().default("https://rpc.testnet.arc.io"),
    ARC_ESCROW_ADDRESS: hexAddress,
    // Block the escrow was deployed at: where the event reader starts when it has no cursor yet.
    ARC_ESCROW_DEPLOY_BLOCK: z.coerce.bigint().nonnegative(),
    ARC_USDC_ADDRESS: hexAddress.default("0x3600000000000000000000000000000000000000"),
    ARC_RELAYER_PRIVATE_KEY: privateKey,
    ARC_ORACLE_PRIVATE_KEY: privateKey,
    // Limits every request of the engine keeps towards its node (chain/rpc-limiter.ts). Unset:
    // 10 requests a second, 4 of them heavy, the heavy one being eth_getLogs.
    ARC_RPC_MAX_REQUESTS_PER_SECOND: z.coerce.number().positive().max(10_000).optional(),
    ARC_RPC_MAX_HEAVY_REQUESTS_PER_SECOND: z.coerce.number().positive().max(10_000).optional(),
    ARC_RPC_HEAVY_METHODS: z
      .string()
      .transform((value) =>
        value
          .split(",")
          .map((method) => method.trim())
          .filter((method) => method !== ""),
      )
      .pipe(
        z
          .array(z.string().regex(/^[a-z][a-z0-9]*_[A-Za-z0-9]+$/, "must be JSON-RPC method names"))
          .min(1, "must name at least one method"),
      )
      .optional(),

    GEMINI_API_URL: z.string().url().default("https://api.gemini.com"),
    GEMINI_WS_URL: z.string().url().default("wss://ws.gemini.com"),
    GEMINI_SANDBOX_API_URL: z.string().url().default("https://api.sandbox.gemini.com"),
    // Only where direct outbound connections are blocked: the Gemini WebSocket is then opened
    // through this HTTPS proxy, trusting the CA bundle in the given file.
    APP_HTTPS_PROXY_URL: z.string().url().optional(),
    APP_PROXY_CA_FILE: z.string().min(1).optional(),
    GEMINI_SANDBOX_API_KEY: z.string().min(1).optional(),
    GEMINI_SANDBOX_API_SECRET: z.string().min(1).optional(),

    // Card payments. Without a key the engine can only sell the sales replayed by the demo mode
    // (payments whose id starts with pi_demo_), and refuses any other payment.
    STRIPE_SECRET_KEY: z
      .string()
      .startsWith("sk_test_", "only Stripe test keys are allowed")
      .optional(),

    // Buyers' embedded wallets. The app id is the one the web app reads, under the same name.
    NEXT_PUBLIC_PRIVY_APP_ID: z.string().min(1).optional(),
    PRIVY_APP_SECRET: z.string().min(1).optional(),
    // Only without Privy: buyers then get wallets derived from this 32-byte secret, whose keys the
    // engine can re-derive to sweep test funds back. Demo only: these are not customers' wallets.
    APP_DEMO_WALLET_SEED: privateKey.optional(),

    APP_API_MOCK: booleanString.default(false),
  })
  .superRefine((env, context) => {
    const privyId = env.NEXT_PUBLIC_PRIVY_APP_ID !== undefined;
    const privySecret = env.PRIVY_APP_SECRET !== undefined;
    if (privyId !== privySecret) {
      context.addIssue({
        code: "custom",
        path: [privyId ? "PRIVY_APP_SECRET" : "NEXT_PUBLIC_PRIVY_APP_ID"],
        message: "NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_APP_SECRET must be set together",
      });
    }
    if (!privyId && !privySecret && env.APP_DEMO_WALLET_SEED === undefined) {
      context.addIssue({
        code: "custom",
        path: ["APP_DEMO_WALLET_SEED"],
        message:
          "required when Privy is not configured: buyers then get demo wallets derived from it",
      });
    }
  });

export type EngineEnv = z.infer<typeof engineEnvSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: readonly string[]) {
    super(`Invalid environment:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
    this.name = "EnvValidationError";
  }
}

/** Parses the environment, or throws one error naming every variable that is missing or malformed. */
export function loadEngineEnv(source: Record<string, string | undefined> = process.env): EngineEnv {
  // An empty string in a .env file means "not set".
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ""));
  const result = engineEnvSchema.safeParse(cleaned);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  return result.data;
}
