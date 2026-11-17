/** Environment of the one-shot catalogue sync (`sync-once.ts`): two variables, not the engine's. */
import { z } from "zod";

/** The environment of the command is unusable. Names every problem, never a value. */
export class SyncOnceConfigError extends Error {
  constructor(public readonly problems: readonly string[]) {
    super(`sync-once: invalid environment: ${problems.join("; ")}`);
    this.name = "SyncOnceConfigError";
  }
}

const envSchema = z.object({
  DB_URL: z
    .string({ error: "is required" })
    .regex(/^postgres(ql)?:\/\//, "must be a postgres:// connection string"),
  GEMINI_API_URL: z.url("must be a URL").default("https://api.gemini.com"),
  APP_LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("warn"),
});
export type SyncOnceEnv = z.infer<typeof envSchema>;

export function loadSyncOnceEnv(source: NodeJS.ProcessEnv): SyncOnceEnv {
  const parsed = envSchema.safeParse({
    DB_URL: source.DB_URL,
    GEMINI_API_URL: source.GEMINI_API_URL === "" ? undefined : source.GEMINI_API_URL,
    APP_LOG_LEVEL: source.APP_LOG_LEVEL === "" ? undefined : source.APP_LOG_LEVEL,
  });
  if (parsed.success) return parsed.data;
  throw new SyncOnceConfigError(
    parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`),
  );
}
