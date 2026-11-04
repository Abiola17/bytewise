import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The shared package ships TypeScript source, so Next.js compiles it.
  transpilePackages: ["@bytewise/shared"],
  reactStrictMode: true,
  // Lets a production check build (`pnpm build:check`) run without clobbering a
  // running `next dev`, which also uses `.next`.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

export default nextConfig;
