import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A lockfile in a parent directory otherwise makes Next guess the wrong root.
  outputFileTracingRoot: import.meta.dirname,
  // Uploaded files live outside `public/` and are streamed through an
  // authenticated route, so nothing in ./storage is statically served.
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  // The dev overlay badge sits on top of the sidebar's collapse control.
  devIndicators: false,
  experimental: {
    // Server Actions receive invoice attachments; the default 1MB body cap
    // rejects ordinary scanned PDFs.
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
