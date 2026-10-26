import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Node-only libraries: keep them out of the server bundle (loaded from node_modules at runtime).
  serverExternalPackages: ['pg', 'kiteconnect'],
  poweredByHeader: false,
  // The home page is the landing page (src/app/page.tsx); V2 is the app, and every retired page (V1, MCX, MCX V2) leads there.
  async redirects() {
    const retired = ['/alerts', '/strategies', '/configuration', '/mcx', '/mcx-v2', '/library', '/builder', '/builder/:id', '/analyzer', '/strategy/:id', '/history', '/analytics'];
    return [
      ...retired.map((source) => ({ source, destination: '/v2', permanent: false })),
      { source: '/welcome', destination: '/', permanent: false },
    ];
  },
};

export default nextConfig;
