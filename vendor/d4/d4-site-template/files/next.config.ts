import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // otplib is used by d4-cms-core when installed; an unused entry here is harmless.
  transpilePackages: ["otplib"],
  images: {
    // Serve images directly instead of through the on-demand optimizer endpoint,
    // which is unreliable on self-hosted / shared Node hosting.
    unoptimized: true,
  },
};

export default nextConfig;
