import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @aio/protocol is shipped as TypeScript source, not a build artefact, so the
  // single source of truth stays readable and there is no build step to forget.
  transpilePackages: ["@aio/protocol"],
};

export default nextConfig;
