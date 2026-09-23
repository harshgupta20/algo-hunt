/**
 * AES-256-GCM encryption for the Kite access token at rest. The key is derived
 * from KITE_API_SECRET, so a leaked database dump alone can't be used to call
 * Kite. Rotating the secret simply invalidates the stored session (re-login).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function key(secret: string): Buffer {
  return createHash('sha256').update(`ash-kite-token:${secret}`).digest();
}

export function encryptToken(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

/** Returns undefined when the payload is malformed or was sealed with another secret. */
export function decryptToken(payload: string, secret: string): string | undefined {
  try {
    const [iv, tag, enc] = payload.split('.').map((p) => Buffer.from(p, 'base64'));
    if (!iv || !tag || !enc) return undefined;
    const decipher = createDecipheriv('aes-256-gcm', key(secret), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch {
    return undefined;
  }
}
