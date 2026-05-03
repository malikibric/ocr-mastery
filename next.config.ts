import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

export default function nextConfig(phase: string): NextConfig {
  return {
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
    experimental: {
      devtoolSegmentExplorer: false,
      serverActions: {
        bodySizeLimit: "20mb"
      }
    },
    serverExternalPackages: ["pg"]
  };
}
