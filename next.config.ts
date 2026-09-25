import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  // Model outputs (xG, prospects, games, WAR) are read from models/ at request time;
  // serverless hosts only ship files the build traces, so include them explicitly.
  outputFileTracingIncludes: { "/**": ["./models/**/*"] },
};

export default nextConfig;
