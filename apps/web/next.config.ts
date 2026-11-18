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
};

export default withSerwist(nextConfig);
