import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // One throwaway Postgres per run, with the migrations applied (see src/testing).
    globalSetup: ["src/testing/pg-global-setup.ts"],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts", "src/testing/**"],
    },
  },
});
