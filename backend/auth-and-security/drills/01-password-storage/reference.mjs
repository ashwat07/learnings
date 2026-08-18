/**
 * Three properties, and each defeats a different attack:
 *
 *   PER-USER SALT   defeats rainbow tables and stops "these 4,000 users share a password" from
 *                   being visible in a leaked dump.
 *   SLOW BY DESIGN  defeats offline brute force. sha256 does billions of guesses per second on a
 *                   GPU; a tuned KDF does thousands. That ratio IS the security.
 *   TIMING-SAFE     defeats the (admittedly marginal, here) timing oracle on comparison.
 *
 * The stored string carries its own PARAMETERS, so you can raise the cost later without
 * invalidating existing hashes — verify with the parameters the hash was made with, and re-hash
 * on next successful login if they are below your current policy.
 */
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const N = 2 ** 15, r = 8, p = 1, KEYLEN = 32;      // ~50-80ms; tune to your hardware

export async function hash(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r, p, maxmem: 256 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verify(password, stored) {
  try {
    const [scheme, n, rr, pp, salt, key] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(key, 'base64');
    const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length,
      { N: Number(n), r: Number(rr), p: Number(pp), maxmem: 256 * 1024 * 1024 });
    // Lengths must match before timingSafeEqual, which throws otherwise.
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch { return false; }
}
