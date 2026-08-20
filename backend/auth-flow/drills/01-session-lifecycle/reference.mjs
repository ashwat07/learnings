/** Drill 01 — reference. */

import crypto from 'node:crypto';

const ACCESS_TTL = 15 * 60_000;
const REFRESH_TTL = 30 * 24 * 60 * 60_000;

// ---------------------------------------------------------------------------
// Tokens. Both are SIGNED and carry a session id — which is what makes the whole design work.

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

// The refresh token is stored HASHED, exactly like a password — a database dump must not hand the
// attacker live sessions. It is a high-entropy random value, so a fast hash is correct here; the
// slow-KDF argument applies to low-entropy human-chosen secrets only.
const hashToken = (jti) => crypto.createHash('sha256').update(jti).digest('base64url');

const hashPassword = (password, salt) =>
  `$scrypt$${salt}$${crypto.scryptSync(password, salt, 32, { N: 2 ** 12 }).toString('hex')}`;

const verifyPassword = (password, stored) => {
  const [, , salt] = String(stored).split('$');
  const candidate = Buffer.from(hashPassword(password, salt));
  const actual = Buffer.from(stored);
  return candidate.length === actual.length && crypto.timingSafeEqual(candidate, actual);
};

export function createAuth({ store, secret, clock }) {
  let nextUserId = 1;
  let nextSessionId = 1;

  // A per-session lock. In a database this is not a lock at all — it is the WHERE clause of a
  // conditional update:
  //
  //     UPDATE sessions SET refresh_hash = $new
  //      WHERE id = $id AND refresh_hash = $old
  //      RETURNING *
  //
  // The loser of a race gets zero rows back and knows it lost. That is a COMPARE-AND-SWAP, and it
  // is the only correct way to rotate a token under concurrency: read-then-write with an await in
  // between is a race, in any language (postgres lab 06, the lost update).
  const locks = new Map();
  const withLock = async (key, fn) => {
    const previous = locks.get(key) ?? Promise.resolve();
    let release;
    locks.set(key, new Promise((r) => { release = r; }));
    await previous;
    try { return await fn(); } finally { release(); if (locks.get(key)) locks.delete(key); }
  };

  const issue = (session) => {
    const jti = crypto.randomBytes(32).toString('base64url');
    return {
      jti,
      accessToken: sign({ userId: session.userId, sessionId: session.id, exp: clock.now() + ACCESS_TTL }, secret),
      refreshToken: sign({ sessionId: session.id, jti, exp: clock.now() + REFRESH_TTL }, secret),
    };
  };

  return {
    async register(email, password) {
      const salt = crypto.randomBytes(16).toString('hex');
      const user = { id: nextUserId++, email, passwordHash: hashPassword(password, salt) };
      await store.putUser(user);
      return { id: user.id, email };
    },

    async login(email, password, device) {
      const user = await store.getUserByEmail(email);
      // Compare even when the user does not exist, against a dummy hash, so a missing account and
      // a wrong password take the same time (auth-and-security drill 02).
      const stored = user?.passwordHash ?? hashPassword('dummy', 'dummy-salt');
      const good = verifyPassword(password, stored);
      if (!user || !good) throw new Error('invalid credentials');

      const session = {
        id: nextSessionId++,
        userId: user.id,
        device,
        createdAt: clock.now(),
        lastUsedAt: clock.now(),
        revokedAt: null,
        refreshHash: null,
      };
      const { jti, accessToken, refreshToken } = issue(session);
      session.refreshHash = hashToken(jti);
      await store.putSession(session);
      return { accessToken, refreshToken };
    },

    /**
     * THE SEAM, RESOLVED.
     *
     * A stateless token cannot be revoked — that is not a flaw, it is the definition. So verify()
     * does exactly ONE indexed read: the session row the token names. If that row is gone or
     * revoked, the token is dead, however much validity its `exp` claims.
     *
     * That is a deliberate trade: you have given up "zero database reads per request" and bought
     * "logout works". The three positions, and why this is the one:
     *
     *   look up the session (this)   1 indexed read per request. Revocation is instant and exact.
     *   a DENYLIST of token ids      also correct, and it grows forever, and the check gets slower
     *                                as it grows — which is what the cost checks in this drill
     *                                measure.
     *   a VERSION on the user        also 1 read, and revoking EVERYTHING is one increment. But
     *                                it cannot revoke ONE device, so you end up needing both.
     *
     * And the fourth answer, which is what large systems actually do: keep the token stateless,
     * make it short (60-120 seconds), and accept that revocation takes up to that long. Then
     * logout revokes the refresh token and the access token simply expires. That is a coherent
     * position — but it means answering "how long may a signed-out session keep reading data?"
     * out loud, rather than discovering the answer during an incident.
     */
    async verify(accessToken) {
      const claims = open(accessToken, secret);
      if (!claims.exp || claims.exp <= clock.now()) throw new Error('expired');

      const session = await store.getSession(claims.sessionId);   // one read, by primary key
      if (!session || session.revokedAt != null) throw new Error('session revoked');

      // Only what a handler needs. Never the row: it holds refreshHash, and claims end up in logs.
      return { userId: session.userId, sessionId: session.id };
    },

    async refresh(refreshToken) {
      const claims = open(refreshToken, secret);
      if (!claims.exp || claims.exp <= clock.now()) throw new Error('expired');

      return withLock(claims.sessionId, async () => {
        const session = await store.getSession(claims.sessionId);
        if (!session || session.revokedAt != null) throw new Error('invalid refresh token');

        const presented = hashToken(claims.jti);
        const current = session.refreshHash ?? '';
        const matches = presented.length === current.length &&
          crypto.timingSafeEqual(Buffer.from(presented), Buffer.from(current));

        if (!matches) {
          // REUSE DETECTION. The token is validly signed and is not the current one, which means
          // it was superseded — so either it was stolen, or the legitimate holder has an old copy.
          // You cannot tell which, so you must assume the worse one: kill the session.
          //
          // This is also why the CAS above matters. Without it, two concurrent refreshes both
          // succeed and produce two live successors — and from then on reuse detection can never
          // distinguish a race from a theft, so it either fires constantly or is turned off.
          session.revokedAt = clock.now();
          session.revokedReason = 'refresh token reuse detected';
          await store.putSession(session);
          throw new Error('refresh token reuse detected — session revoked');
        }

        const { jti, accessToken, refreshToken: next } = issue(session);
        session.refreshHash = hashToken(jti);
        session.lastUsedAt = clock.now();
        await store.putSession(session);
        return { accessToken, refreshToken: next };
      });
    },

    async logout(refreshToken) {
      let claims;
      try { claims = open(refreshToken, secret); } catch { return; }   // already useless
      const session = await store.getSession(claims.sessionId);
      if (!session) return;
      // REVOKE, do not DELETE. A deleted row is indistinguishable from a token that never existed,
      // so you lose the audit trail and the ability to tell "signed out" from "forged". Keep the
      // row, with a reason and a timestamp, and let retention remove it later.
      session.revokedAt = clock.now();
      session.revokedReason = 'logout';
      session.refreshHash = null;
      await store.putSession(session);
    },

    async logoutEverywhere(userId) {
      // A scan is fine HERE: this happens once, on an explicit user action, not per request. The
      // cost checks in this drill are about verify() — the thing on the hot path.
      for (const session of await store.sessionsForUser(userId)) {
        if (session.revokedAt != null) continue;
        session.revokedAt = clock.now();
        session.revokedReason = 'logout everywhere';
        session.refreshHash = null;
        await store.putSession(session);
      }
    },

    async changePassword(userId, oldPassword, newPassword) {
      const user = await store.getUserById(userId);
      if (!user || !verifyPassword(oldPassword, user.passwordHash)) throw new Error('invalid password');

      const salt = crypto.randomBytes(16).toString('hex');
      user.passwordHash = hashPassword(newPassword, salt);
      await store.putUser(user);

      // THE SEAM. A password change is usually a response to "somebody else has my password", so
      // the sessions that other person is holding must die. Almost every hand-rolled auth system
      // forgets this, and it is the one that turns a recoverable compromise into a persistent one:
      // the attacker's session keeps working after the user has done the one thing they were told
      // to do.
      //
      // Real systems keep the CURRENT session alive so the user is not signed out of the device
      // they just used. That needs the caller to say which session it is — an argument this API
      // does not have, so this revokes all of them, which is the safe default.
      await this.logoutEverywhere(userId);
    },

    async sessions(userId) {
      const all = await store.sessionsForUser(userId);
      // A PROJECTION, not the rows. This list is rendered in a "your devices" screen, so it must
      // not contain refreshHash — and returning the row is how that leaks. Enumerate the fields
      // you mean; never `return rows`.
      return all
        .filter((x) => x.revokedAt == null)
        .map((x) => ({ id: x.id, device: x.device, createdAt: x.createdAt, lastUsedAt: x.lastUsedAt }));
    },
  };
}

/*
THE SIX SEAMS, AND WHY EACH ONE IS INVISIBLE IN A UNIT TEST

  1. STATELESS TOKEN + LOGOUT BUTTON. Each correct. Together, logout does not log anybody out.
     Resolved by deciding what verify() checks — and the decision costs you a read per request.

  2. ROTATION + CONCURRENCY. Two tabs, or one tab and a retry after a timeout, refresh at the same
     moment. Read-then-write gives you two valid successors and permanently poisons reuse
     detection. Resolved by a compare-and-swap.

  3. REUSE DETECTION + THE RACE ABOVE. If races produce duplicate successors, every race looks
     like theft. Teams respond by turning reuse detection off, which is the one control that
     actually catches a stolen token.

  4. PASSWORD CHANGE + OTHER SESSIONS. The user changes their password precisely because someone
     else has it. If the other sessions survive, the action they were told to take does nothing.

  5. SESSION LIST + THE ROW. `return rows` ships refreshHash to the browser. The fix is a
     projection, and the reason it gets missed is that the query was correct.

  6. REVOCATION + THE HOT PATH. Making logout work is easy; making it work without a scan on every
     request is the actual engineering. A denylist is correct and gets slower forever.

WHAT THIS DRILL DELIBERATELY LEAVES OUT, and where it lives
  · WHERE the tokens are stored client-side. HttpOnly + Secure + SameSite cookies for the refresh
    token, memory for the access token — never localStorage, which any XSS can read
    (../../../security-and-auth/ lab 04).
  · CSRF, which arrives the moment you use cookies (same lab).
  · the KDF parameters (auth-and-security drill 01) and constant-time comparison (drill 02).
  · rate limiting the login endpoint, which is the difference between a strong hash and a strong
    hash you get to try ten thousand times (caching-and-queues drill 02).
  · device fingerprinting, impossible-travel detection, step-up auth for sensitive actions.

WHAT TO USE INSTEAD OF WRITING THIS
An identity provider — Auth0, Clerk, WorkOS, Keycloak, Cognito — or your framework's battle-tested
session library. Writing it once, as here, is how you evaluate one of those: you now know which
questions to ask, and "how does logout revoke an access token, and what does it cost per request?"
is a question that separates them.
*/
