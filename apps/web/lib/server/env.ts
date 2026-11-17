import { z } from "zod";

const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");

/**
 * Server-side environment of the web app. Read lazily (first call), never at import time,
 * so `next build` does not need production secrets.
 */
const webEnvSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  APP_BASE_URL: z.string().url(),
  APP_API_MOCK: booleanString.default(false),
  APP_ADMIN_DEMO_KEY: z.string().min(16),
  DB_URL: z.string().url(),
  STRIPE_SECRET_KEY: z.string().startsWith("sk_test_", "only Stripe test keys are allowed"),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  PRIVY_APP_SECRET: z.string().min(1),
  NEXT_PUBLIC_PRIVY_APP_ID: z.string().min(1),
  QUICKNODE_STREAMS_TOKEN: z.string().min(1),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

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
