import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  // A verification build can be sent elsewhere with NEXT_DIST_DIR, so it never overwrites the
  // artifacts a running `npm start` is serving. Unset, this is exactly the default.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  logging: { incomingRequests: { ignore: [/^\/api\/outlook\/callback(?:\?|$)/] } },
};

export default nextConfig;
