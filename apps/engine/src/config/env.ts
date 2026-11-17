import { z } from "zod";

const hexAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 20-byte hex address");
const privateKey = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a 32-byte hex private key");
const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");

/**
 * Everything the engine reads from the environment. Parsed once at startup:
 * a missing or malformed variable stops the process with the full list, before any I/O.
 */
export const engineEnvSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  APP_EXECUTION_VENUE: z.enum(["paper", "gemini-sandbox"]).default("paper"),
  APP_ADMIN_DEMO_KEY: z.string().min(16),

  DB_URL: z.string().url(),

  ARC_CHAIN_ID: z.coerce.number().int().positive().default(5_042_002),
  ARC_RPC_URL: z.string().url(),
  ARC_RPC_FALLBACK_URL: z.string().url().default("https://rpc.testnet.arc.io"),
  ARC_ESCROW_ADDRESS: hexAddress,
  ARC_USDC_ADDRESS: hexAddress.default("0x3600000000000000000000000000000000000000"),
  ARC_RELAYER_PRIVATE_KEY: privateKey,
  ARC_ORACLE_PRIVATE_KEY: privateKey,

  GEMINI_API_URL: z.string().url().default("https://api.gemini.com"),
  GEMINI_WS_URL: z.string().url().default("wss://ws.gemini.com"),
  GEMINI_SANDBOX_API_URL: z.string().url().default("https://api.sandbox.gemini.com"),
  // Only where direct outbound connections are blocked: the Gemini WebSocket is then opened
  // through this HTTPS proxy, trusting the CA bundle in the given file.
  APP_HTTPS_PROXY_URL: z.string().url().optional(),
  APP_PROXY_CA_FILE: z.string().min(1).optional(),
  GEMINI_SANDBOX_API_KEY: z.string().min(1).optional(),
  GEMINI_SANDBOX_API_SECRET: z.string().min(1).optional(),

  STRIPE_SECRET_KEY: z.string().startsWith("sk_test_", "only Stripe test keys are allowed"),

  PRIVY_APP_ID: z.string().min(1),
  PRIVY_APP_SECRET: z.string().min(1),

  APP_API_MOCK: booleanString.default(false),
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
