import { z } from "zod";

import { NONCE_MODES } from "./nonce";
import type { SandboxSettings } from "./run";

/**
 * What `venue:check` reads, and nothing else of the engine's configuration: it runs on a laptop
 * with the two sandbox keys and a database URL, without the chain's keys.
 *
 *   GEMINI_SANDBOX_API_KEY, GEMINI_SANDBOX_API_SECRET   required
 *   GEMINI_SANDBOX_API_URL        default https://api.sandbox.gemini.com
 *   GEMINI_SANDBOX_NONCE_MODE     incremental (default) or time
 *   GEMINI_SANDBOX_CHECK_SYMBOL   a contract instead of the one the check chooses
 *   APP_VENUE_CHECK_ACCEPT_TERMS  true: accept the latest Prediction Markets terms if needed
 *   DB_URL                        where the proof is recorded; required unless --no-record
 *   APP_LOG_LEVEL                 default "warn" (the report itself is printed)
 *
 * Arguments: `--symbol <instrumentSymbol>`, `--accept-terms`, `--no-record`.
 */
const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");

export const checkEnvSchema = z.object({
  GEMINI_SANDBOX_API_URL: z.string().url().default("https://api.sandbox.gemini.com"),
  GEMINI_SANDBOX_API_KEY: z.string().min(1),
  GEMINI_SANDBOX_API_SECRET: z.string().min(1),
  GEMINI_SANDBOX_NONCE_MODE: z.enum(NONCE_MODES).default("incremental"),
  GEMINI_SANDBOX_CHECK_SYMBOL: z.string().min(1).optional(),
  APP_VENUE_CHECK_ACCEPT_TERMS: booleanString.default(false),
  DB_URL: z.string().url().optional(),
  APP_LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("warn"),
});

export interface CheckCommand {
  settings: SandboxSettings;
  dbUrl: string | null;
  logLevel: z.infer<typeof checkEnvSchema>["APP_LOG_LEVEL"];
}

export class CheckUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckUsageError";
  }
}

/** The command's settings from the environment and the arguments, or a usage error naming every problem. */
export function parseCheckCommand(
  source: Record<string, string | undefined>,
  argv: readonly string[],
): CheckCommand {
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ""));
  const problems: string[] = [];
  let symbol: string | undefined;
  let acceptTerms = false;
  let record = true;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--symbol") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) problems.push("--symbol needs a value");
      else symbol = value;
      index += 1;
    } else if (arg === "--accept-terms") acceptTerms = true;
    else if (arg === "--no-record") record = false;
    else problems.push(`unknown argument ${String(arg)}`);
  }
  const parsed = checkEnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    // Names and zod's message only: never a value.
    for (const issue of parsed.error.issues) {
      problems.push(
        `${issue.path.join(".")}: ${issue.message.includes("received undefined") ? "required" : issue.message}`,
      );
    }
  }
  if (record && cleaned.DB_URL === undefined) {
    problems.push("DB_URL: required to record the proof (or pass --no-record)");
  }
  if (problems.length > 0 || !parsed.success) throw new CheckUsageError(problems.join("\n"));
  const env = parsed.data;
  return {
    settings: {
      baseUrl: env.GEMINI_SANDBOX_API_URL,
      apiKey: env.GEMINI_SANDBOX_API_KEY,
      apiSecret: env.GEMINI_SANDBOX_API_SECRET,
      nonceMode: env.GEMINI_SANDBOX_NONCE_MODE,
      symbol: symbol ?? env.GEMINI_SANDBOX_CHECK_SYMBOL,
      acceptTerms: acceptTerms || env.APP_VENUE_CHECK_ACCEPT_TERMS,
    },
    dbUrl: record ? (env.DB_URL ?? null) : null,
    logLevel: env.APP_LOG_LEVEL,
  };
}
