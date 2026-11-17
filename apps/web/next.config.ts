import type { NextConfig } from "next";

// Allow `next/image` to optimize remote previews coming from Backblaze B2.
// Presigned download URLs use the bucket-specific S3 hostname pattern:
//   <bucket>.s3.<region>.backblazeb2.com    (path-style and virtual-host)
//   s3.<region>.backblazeb2.com             (path-style)
// One wildcard covers every region + bucket, so this config drops in
// without per-deployment tweaks.
const nextConfig: NextConfig = {
  // `next dev` serves its dev-only assets (HMR, client chunks) to localhost
  // only. Opening the app as http://127.0.0.1:3000 otherwise blocks them and
  // every client-rendered page sits on its loading skeleton with no error.
  allowedDevOrigins: ["127.0.0.1"],
  transpilePackages: ["@anomalib-defect-inspection-archive/shared"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.backblazeb2.com",
      },
    ],
  },
};

export default nextConfig;
