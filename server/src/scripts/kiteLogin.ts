/**
 * Generate a Kite Connect access token and store it in .env.
 *
 * Kite access tokens are valid only until the next trading day, so this is run
 * each morning before market open:
 *
 *   npm run kite:login
 *
 * It prints the Kite login URL. Log in in your browser; Kite redirects to your
 * app's registered Redirect URL with `?request_token=...` in the query. Paste
 * that request_token here (or pass it as an argument). The script exchanges it
 * (api_key + api_secret) for an access_token and writes KITE_ACCESS_TOKEN=... to
 * your .env.
 *
 * Fully-automated refresh (TOTP-based login) is possible but stores your Kite
 * password/TOTP secret — intentionally not implemented here.
 */
import { createInterface } from 'node:readline/promises';
import { config } from '../config/index.js';
import { resolveEnvPath, upsertEnv } from '../utils/envFile.js';

function fail(msg: string): never {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const apiKey = config.kite.apiKey;
  const apiSecret = config.kite.apiSecret;
  if (!apiKey || !apiSecret) {
    fail('Set KITE_API_KEY and KITE_API_SECRET in your .env first (from your Kite Connect app).');
  }

  const { KiteConnect } = await import('kiteconnect');
  const kc = new KiteConnect({ api_key: apiKey });

  console.log('\n1) Open this URL, log in to Kite, and approve:\n');
  console.log(`   ${kc.getLoginURL()}\n`);
  console.log("2) After login Kite redirects to your app's Redirect URL with ?request_token=... in the address bar.\n");

  const argToken = process.argv[2];
  let requestToken = argToken;
  if (!requestToken) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    requestToken = (await rl.question('3) Paste the request_token here: ')).trim();
    rl.close();
  }
  if (!requestToken) fail('No request_token provided.');

  let session: { access_token?: string };
  try {
    session = await kc.generateSession(requestToken, apiSecret);
  } catch (err) {
    fail(`Token exchange failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const accessToken = session.access_token;
  if (!accessToken) fail('Kite did not return an access_token.');

  const envPath = resolveEnvPath();
  upsertEnv('KITE_ACCESS_TOKEN', accessToken, envPath);

  console.log(`\n✓ Saved KITE_ACCESS_TOKEN to ${envPath}`);
  console.log('  Valid until the next trading day. Set MARKET_PROVIDER=kite and start the server.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
