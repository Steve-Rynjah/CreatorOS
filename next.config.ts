import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native binaries / ML runtimes must be loaded with plain Node require.
  serverExternalPackages: ["ffmpeg-static", "@huggingface/transformers", "onnxruntime-node", "msedge-tts"],
  // Keep the dev badge away from the timeline track labels.
  devIndicators: { position: "top-right" },
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
