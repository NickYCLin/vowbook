import type { NextConfig } from "next";
import { normalizeBasePath } from "./src/lib/base-path";

const nextConfig: NextConfig = {
  basePath: normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH),
  output: "standalone",
  async headers() {
    return [
      {
        source:
          "/workspaces/:workspaceId/budget/:budgetItemId/attachments/:attachmentId/preview",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'",
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Cache-Control", value: "private, no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
  outputFileTracingIncludes: {
    "/*": [
      "./src/lib/budget-attachment-preview-worker.cjs",
      "./node_modules/@img/**/*",
      "./node_modules/@napi-rs/**/*",
      "./node_modules/@pdf-lib/**/*",
      "./node_modules/detect-libc/**/*",
      "./node_modules/pako/**/*",
      "./node_modules/pdf-lib/**/*",
      "./node_modules/pdfjs-dist/**/*",
      "./node_modules/semver/**/*",
      "./node_modules/sharp/**/*",
      "./node_modules/tslib/**/*",
    ],
  },
  reactStrictMode: true,
  serverExternalPackages: [
    "@napi-rs/canvas",
    "pdf-lib",
    "pdfjs-dist",
    "sharp",
  ],
};

export default nextConfig;
