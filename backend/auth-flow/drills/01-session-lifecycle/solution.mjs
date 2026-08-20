/**
 * Drill 01 — the session lifecycle.
 *
 * The starting point below is assembled from pieces that are each correct, and several of them are
 * the recommended practice:
 *
 *   · scrypt for the password                       — correct
 *   · a signed, short-lived, stateless access token — correct, and the standard advice
 *   · a rotating refresh token                      — correct
 *
 * It fails six of the checks, and every failure is at a JOIN between two of those pieces.
 *
 * The one to think about first: LOGOUT. A signed JWT is valid until it expires — no server is
 * consulted, which is the entire reason to use one. So `logout()` can delete every row it likes
 * and the access token in the user's browser keeps working for the rest of its lifetime. That is
 * not a bug in the JWT and not a bug in the logout; it is what happens when you put them together
 * and nobody decides what verify() checks.
 *
 * You have to pick a position. The three real ones:
 *
 *   1. LOOK UP THE SESSION on every request. Correct, simple, and now every request reads the
 *      database — which is the thing you adopted stateless tokens to avoid.
 *   2. A DENYLIST of revoked token ids, checked per request. Correct, and it grows forever, and
 *      the check gets slower as it grows. Measured by the last check in this drill.
 *   3. A VERSION/EPOCH on the user, embedded in the token and compared on verify. One number, one
 *      cheap read, and revoking everything is a single increment.
 *
 * Only one of those passes both the correctness checks and the cost check.
 */

import crypto from 'node:crypto';

const ACCESS_TTL = 15 * 60_000;
const REFRESH_TTL = 30 * 24 * 60 * 60_000;

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (payload, secret) => {
  const body = b64(payload);
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
};
const open = (token, secret) => {
  const [body, mac] = String(token).split('.');
  if (!body || !mac) throw new Error('malformed token');
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) {
    throw new Error('bad signature');
  }
  return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
};

// Deliberately cheap so this suite runs in seconds, and deliberately a fixed salt so it is
// reproducible. BOTH are wrong for production — choosing scrypt's parameters and using a per-user
// salt is auth-and-security drill 01. This drill is about everything that surrounds it.
const hashPassword = (password) =>
  `$scrypt$${crypto.scryptSync(password, 'lab-salt', 32, { N: 2 ** 12 }).toString('hex')}`;

export function createAuth({ store, secret, clock }) {
  let nextUserId = 1;
  let nextSessionId = 1;

  return {
    async register(email, password) {
      const user = { id: nextUserId++, email, passwordHash: hashPassword(password) };
      await store.putUser(user);
      return { id: user.id, email };
    },

    async login(email, password, device) {
      const user = await store.getUserByEmail(email);
      if (!user || user.passwordHash !== hashPassword(password)) throw new Error('invalid credentials');

      const session = {
        id: nextSessionId++,
        userId: user.id,
        device,
        createdAt: clock.now(),
        lastUsedAt: clock.now(),
        refreshToken: crypto.randomBytes(32).toString('base64url'),
      };
      await store.putSession(session);

      return {
        accessToken: sign({ userId: user.id, sessionId: session.id, exp: clock.now() + ACCESS_TTL }, secret),
        refreshToken: session.refreshToken,
      };
    },

    // Stateless: no store read at all. Fast, and it cannot know about a logout.
    async verify(accessToken) {
      const claims = open(accessToken, secret);
      if (claims.exp <= clock.now()) throw new Error('expired');
      return claims;
    },

    async refresh(refreshToken) {
      const all = await store.sessionsForUser(1);              // a scan, and it assumes one user
      const session = all.find((x) => x.refreshToken === refreshToken);
      if (!session) throw new Error('invalid refresh token');

      session.refreshToken = crypto.randomBytes(32).toString('base64url');
      session.lastUsedAt = clock.now();
      await store.putSession(session);

      return {
        accessToken: sign({ userId: session.userId, sessionId: session.id, exp: clock.now() + ACCESS_TTL }, secret),
        refreshToken: session.refreshToken,
      };
    },

    async logout(refreshToken) {
      const all = await store.sessionsForUser(1);
      const session = all.find((x) => x.refreshToken === refreshToken);
      if (session) await store.deleteSession(session.id);
    },

    async logoutEverywhere(userId) {
      for (const s of await store.sessionsForUser(userId)) await store.deleteSession(s.id);
    },

    async changePassword(userId, oldPassword, newPassword) {
      const user = await store.getUserById(userId);
      if (!user || user.passwordHash !== hashPassword(oldPassword)) throw new Error('invalid password');
      user.passwordHash = hashPassword(newPassword);
      await store.putUser(user);
    },

    async sessions(userId) {
      return store.sessionsForUser(userId);
    },
  };
}
