import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  // Components are .tsx and tsconfig keeps `jsx: preserve` for Next, so tests render them with the
  // automatic runtime (renderToStaticMarkup): the landing's sections are tested that way.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["**/*.test.ts", "**/*.test.tsx"],
    // e2e/ui is the Playwright suite (`pnpm e2e:ui`), not vitest's.
    exclude: ["node_modules/**", ".next/**", "e2e/ui/**"],
    // One throwaway Postgres per run, with every migration applied (shared with the engine).
    globalSetup: ["../engine/src/testing/pg-global-setup.ts"],
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
