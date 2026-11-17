import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages are consumed as TypeScript source.
  transpilePackages: ["@winz/shared", "@winz/pricing"],
  // Linting runs once for the whole monorepo (`pnpm lint`), not per build.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
