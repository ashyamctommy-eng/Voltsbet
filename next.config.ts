import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    /**
     * Client Router Cache.
     *
     * Next 15/16 default `staleTimes.dynamic` to 0, so EVERY tab click
     * re-fetched the whole RSC payload from the server — and because the app
     * had no `loading.tsx` boundaries, `<Link>` prefetch could not warm those
     * segments either. That is the structural reason tab switches felt dead
     * (2026-10-07), independent of how fast the server render is. Reusing a
     * dynamic segment for 30s makes forward/back and tab revisits instant.
     */
    staleTimes: { dynamic: 30, static: 180 },
  },
};

export default nextConfig;
