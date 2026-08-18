/**
 * HASH BOTH SIDES FIRST, then compare the digests with timingSafeEqual.
 *
 * Why hash rather than compare the raw strings? Because timingSafeEqual requires equal lengths,
 * and returning early on a length mismatch leaks the LENGTH of the secret. Hashing makes every
 * comparison fixed-width, so neither the length nor the content of the candidate affects timing.
 *
 * A plain sha256 is correct here — this is not password storage, there is nothing to brute-force
 * offline, and the only property needed is constant-time equality. (An HMAC with a server-side key
 * is the belt-and-braces version.)
 */
import crypto from 'node:crypto';

export function tokensMatch(candidate, secret) {
  const a = crypto.createHash('sha256').update(String(candidate)).digest();
  const b = crypto.createHash('sha256').update(String(secret)).digest();
  return crypto.timingSafeEqual(a, b);
}
