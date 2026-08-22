import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  logging: { incomingRequests: { ignore: [/^\/api\/outlook\/callback(?:\?|$)/] } },
};

export default nextConfig;
