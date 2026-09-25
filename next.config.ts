import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Node-only libraries: keep them out of the server bundle (loaded from node_modules at runtime).
  serverExternalPackages: ['pg', 'kiteconnect'],
  poweredByHeader: false,
  // Merged pages: keep old links working.
  async redirects() {
    return [
      { source: '/library', destination: '/strategies', permanent: true },
      { source: '/builder', destination: '/strategies?tab=builder', permanent: true },
      { source: '/builder/:id', destination: '/strategies?tab=builder&id=:id', permanent: true },
      { source: '/analyzer', destination: '/strategies?tab=backtest', permanent: true },
      { source: '/strategy/:id', destination: '/strategies?tab=backtest&strategy=:id', permanent: true },
      // Live Alerts + Alert History → Alerts; Analytics → the Dashboard's Performance section.
      { source: '/history', destination: '/alerts?view=table', permanent: true },
      { source: '/analytics', destination: '/#performance', permanent: true },
    ];
  },
};

export default nextConfig;
