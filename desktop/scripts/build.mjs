/**
 * Bundles the Electron main process and the windows' preload into dist/ (everything but Electron itself inside).
 *
 * Like the token line in start-algo-hunt.bat, the app carries what it needs to download the code:
 *   ALGO_HUNT_GITHUB_TOKEN   a GitHub token that can read the repository (or put it in desktop/github-token.txt,
 *                            which git ignores) — fine-grained, only this repository, Contents: Read-only
 *   ALGO_HUNT_REPO           default harshgupta20/algo-hunt
 *   ALGO_HUNT_BRANCH         default main
 */
import { build } from 'esbuild';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tokenFile = path.join(here, '..', 'github-token.txt');
const token = (process.env.ALGO_HUNT_GITHUB_TOKEN || (existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8') : '')).trim();
const repo = process.env.ALGO_HUNT_REPO || 'harshgupta20/algo-hunt';
const branch = process.env.ALGO_HUNT_BRANCH || 'main';
if (!token) console.warn('⚠ No GitHub token (ALGO_HUNT_GITHUB_TOKEN or desktop/github-token.txt): the app can only download a public repository.');

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: false,
  logLevel: 'info',
  external: ['electron', 'pg-native'],
  define: { __REPO__: JSON.stringify(repo), __BRANCH__: JSON.stringify(branch), __GITHUB_TOKEN__: JSON.stringify(token) },
};
await build({ ...common, entryPoints: ['src/main.ts'], outfile: 'dist/main.js' });
await build({ ...common, entryPoints: ['src/preload.ts'], outfile: 'dist/preload.js' });
console.log(`✓ Built for ${repo} (${branch})${token ? ' with a GitHub token' : ''}`);
