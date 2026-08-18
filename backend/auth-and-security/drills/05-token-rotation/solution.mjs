/**
 * export function reset()                     clear all state (the runner calls this first)
 * export async function issue(userId)         -> { accessToken, refreshToken }
 * export async function refresh(token)        -> { accessToken, refreshToken } or throw
 *
 * In-memory state is fine — this drill is about the ALGORITHM, not storage.
 *
 * The version below is the common one: a long-lived refresh token you can use repeatedly. It
 * works, and a stolen token grants silent, permanent access that you will never detect.
 *
 * Two things to add:
 *   1. ROTATION — each refresh issues a new token and spends the old one
 *   2. REUSE DETECTION — a spent token being presented again means TWO parties hold it. You
 *      cannot tell which one is the user, so...
 */
import crypto from 'node:crypto';

const tokens = new Map();                    // token -> { userId }

export function reset() { tokens.clear(); }

export async function issue(userId) {
  const refreshToken = crypto.randomBytes(24).toString('hex');
  tokens.set(refreshToken, { userId });
  return { accessToken: `access-for-${userId}`, refreshToken };
}

export async function refresh(token) {
  const entry = tokens.get(token);
  if (!entry) throw new Error('unknown refresh token');
  return { accessToken: `access-for-${entry.userId}`, refreshToken: token };
}
