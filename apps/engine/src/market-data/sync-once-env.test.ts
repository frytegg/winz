import { describe, expect, it } from "vitest";

import { SyncOnceConfigError, loadSyncOnceEnv } from "./sync-once-env";

describe("loadSyncOnceEnv", () => {
  it("needs DB_URL only and defaults the Gemini URL and the log level", () => {
    expect(loadSyncOnceEnv({ DB_URL: "postgres://postgres@127.0.0.1:5432/winz" })).toEqual({
      DB_URL: "postgres://postgres@127.0.0.1:5432/winz",
      GEMINI_API_URL: "https://api.gemini.com",
      APP_LOG_LEVEL: "warn",
    });
  });

  it("takes GEMINI_API_URL and APP_LOG_LEVEL from the environment, an empty value as unset", () => {
    expect(
      loadSyncOnceEnv({
        DB_URL: "postgresql://u@db.test/winz",
        GEMINI_API_URL: "https://api.sandbox.gemini.com",
        APP_LOG_LEVEL: "info",
      }),
    ).toMatchObject({ GEMINI_API_URL: "https://api.sandbox.gemini.com", APP_LOG_LEVEL: "info" });
    expect(
      loadSyncOnceEnv({
        DB_URL: "postgres://u@db.test/winz",
        GEMINI_API_URL: "",
        APP_LOG_LEVEL: "",
      }),
    ).toMatchObject({ GEMINI_API_URL: "https://api.gemini.com", APP_LOG_LEVEL: "warn" });
  });

  it("names every problem and never echoes a value", () => {
    let caught: unknown;
    try {
      loadSyncOnceEnv({ DB_URL: "mysql://user:hunter2@db.test/winz", GEMINI_API_URL: "nope" });
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SyncOnceConfigError);
    const error = caught as SyncOnceConfigError;
    expect(error.problems).toEqual([
      "DB_URL must be a postgres:// connection string",
      "GEMINI_API_URL must be a URL",
    ]);
    expect(error.message).not.toContain("hunter2");
  });

  it("says DB_URL is required when it is missing", () => {
    expect(() => loadSyncOnceEnv({})).toThrow("DB_URL is required");
  });
});
