import withSerwistInit from "@serwist/next";
import type { NextConfig } from "next";

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  // Only in a production build: in development a worker would cache stale code.
  disable: process.env.NODE_ENV !== "production",
  // No page or route caching: only what app/sw.ts lists.
  cacheOnNavigation: false,
  // Do not reload the app when the phone comes back online: it could cut a payment in progress.
  reloadOnOnline: false,
  // Precache only the brand files; the sport and onboarding images are cached when first seen.
  globPublicPatterns: ["brand/*.svg", "icons/*"],
});

const nextConfig: NextConfig = {
  // Workspace packages are consumed as TypeScript source.
  transpilePackages: ["@winz/shared", "@winz/pricing"],
  // Linting runs once for the whole monorepo (`pnpm lint`), not per build.
  eslint: { ignoreDuringBuilds: true },
  // The generated images read their fonts and the wordmark from disk at render time. The file tracer
  // cannot see a path built from `process.cwd()`, so without this a deployed function would not have
  // them: the fonts would silently fall back to the renderer's default and the wordmark would vanish.
  outputFileTracingIncludes: {
    "/c/*/opengraph-image*": ["./lib/og/fonts/*", "./public/brand/logo-winz-lime.svg"],
  },
};

export default withSerwist(nextConfig);
