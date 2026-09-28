import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Node-only libraries: keep them out of the server bundle (loaded from node_modules at runtime).
  serverExternalPackages: ['pg', 'kiteconnect'],
  poweredByHeader: false,
  turbopack: {
    // The local database and its backups use files chosen at run time (DATABASE_FILE, BACKUP_DIR); that only matters for "standalone"
    // output, which this app doesn't use.
    ignoreIssue: [{ path: /src[\/]server[\/]db[\/](sqlite|backup)\.ts$/, title: /Dynamic filesystem access/ }],
  },
  // V2 is the app: the home page and every retired page (V1, MCX, MCX V2) lead there.
  async redirects() {
    const retired = ['/', '/alerts', '/strategies', '/configuration', '/mcx', '/mcx-v2', '/library', '/builder', '/builder/:id', '/analyzer', '/strategy/:id', '/history', '/analytics'];
    return retired.map((source) => ({ source, destination: '/v2', permanent: false }));
  },
};

export default nextConfig;
