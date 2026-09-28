/**
 * Runs once when the Next.js server starts: the app's own background work — the live worker and daily
 * database backups (src/server/background.ts). Node.js runtime only.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startBackground } = await import('./server/background');
  await startBackground();
}
