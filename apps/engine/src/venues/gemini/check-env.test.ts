import { describe, expect, it } from "vitest";

import { CheckUsageError, parseCheckCommand } from "./check-env";

const keys = {
  GEMINI_SANDBOX_API_KEY: "account-abc",
  GEMINI_SANDBOX_API_SECRET: "the-secret-value-1234",
  DB_URL: "postgres://user:pass@localhost:5432/winz",
};

function usage(source: Record<string, string | undefined>, argv: string[] = []): string {
  try {
    parseCheckCommand(source, argv);
  } catch (error: unknown) {
    if (error instanceof CheckUsageError) return error.message;
    throw error;
  }
  throw new Error("expected a usage error");
}

describe("venue:check command line", () => {
  it("reads the keys, the defaults and the arguments", () => {
    const command = parseCheckCommand(keys, ["--symbol", "GEMI-X", "--accept-terms"]);
    expect(command.settings).toEqual({
      baseUrl: "https://api.sandbox.gemini.com",
      apiKey: "account-abc",
      apiSecret: "the-secret-value-1234",
      nonceMode: "incremental",
      symbol: "GEMI-X",
      acceptTerms: true,
    });
    expect(command.dbUrl).toBe(keys.DB_URL);
    expect(command.logLevel).toBe("warn");
  });

  it("names the missing keys, never a value", () => {
    const message = usage({
      DB_URL: keys.DB_URL,
      GEMINI_SANDBOX_API_SECRET: "the-secret-value-1234",
    });
    expect(message).toContain("GEMINI_SANDBOX_API_KEY: required");
    expect(message).not.toContain("the-secret-value-1234");
  });

  it("requires a database to record the proof, unless --no-record", () => {
    const withoutDb = { ...keys, DB_URL: undefined };
    expect(usage(withoutDb)).toContain("DB_URL");
    expect(parseCheckCommand(withoutDb, ["--no-record"]).dbUrl).toBeNull();
  });

  it("refuses an unknown argument and a --symbol without value", () => {
    expect(usage(keys, ["--live"])).toContain("unknown argument --live");
    expect(usage(keys, ["--symbol"])).toContain("--symbol needs a value");
  });

  it("an empty variable counts as unset", () => {
    expect(usage({ ...keys, GEMINI_SANDBOX_API_KEY: "" })).toContain("GEMINI_SANDBOX_API_KEY");
  });
});
