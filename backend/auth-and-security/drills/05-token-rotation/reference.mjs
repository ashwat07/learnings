/**
 * Rotation alone buys you very little. What buys something is what happens when the OLD token is
 * presented again:
 *
 *   A rotated token is single-use. If it is ever presented twice, exactly one thing is true:
 *   TWO PARTIES HOLD IT.
 *
 * You cannot tell which one is the legitimate user, so you revoke the whole FAMILY and force a
 * real login. The user is inconvenienced once; the attacker loses persistent access; and — the
 * part that matters most — YOU GET A SIGNAL THAT A THEFT HAPPENED, which a long-lived token never
 * gives you.
 *
 * That is the answer to "why not just use long-lived refresh tokens": a stolen one is silent and
 * permanent. Rotation converts theft into a detectable event.
 *
 * In production: store these hashed (they are bearer credentials), give them an absolute expiry as
 * well as rotation, and put the refresh token in an HttpOnly, SameSite cookie scoped to the refresh
 * path — see security-and-auth lab 04 for the browser half of this.
 */
import crypto from 'node:crypto';

const tokens = new Map();                    // token -> { userId, family, spent }
const revokedFamilies = new Set();

export function reset() { tokens.clear(); revokedFamilies.clear(); }

const mint = (userId, family) => {
  const refreshToken = crypto.randomBytes(24).toString('hex');
  tokens.set(refreshToken, { userId, family, spent: false });
  return refreshToken;
};

export async function issue(userId) {
  const family = crypto.randomBytes(8).toString('hex');
  return { accessToken: `access-for-${userId}`, refreshToken: mint(userId, family) };
}

export async function refresh(token) {
  const entry = tokens.get(token);
  if (!entry) throw new Error('unknown refresh token');
  if (revokedFamilies.has(entry.family)) throw new Error('family revoked after detected reuse');

  if (entry.spent) {
    // REUSE DETECTED. Assume theft and kill every token in the family.
    revokedFamilies.add(entry.family);
    throw new Error('refresh token reuse detected — all sessions revoked');
  }

  entry.spent = true;
  return { accessToken: `access-for-${entry.userId}`, refreshToken: mint(entry.userId, entry.family) };
}
