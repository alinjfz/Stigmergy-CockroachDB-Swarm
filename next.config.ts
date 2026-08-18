import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.VERCEL ? {} : { output: "standalone" as const }),
  serverExternalPackages: ["pg"],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
