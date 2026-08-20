/**
 * The world the auth-flow drills run against: a store that COUNTS its reads, and a clock you
 * control.
 *
 * The counter matters. "Revoke a stateless token" has an easy correct answer (look it up on every
 * request) and the whole difficulty is doing it without turning every request into a scan — so the
 * drill measures reads, not just outcomes.
 */

export function makeClock(start = Date.UTC(2026, 0, 1, 12, 0, 0)) {
  let t = start;
  return {
    now: () => t,
    advance(ms) { t += ms; },
    set(ms) { t = ms; },
  };
}

export function makeStore() {
  const users = new Map();      // id -> { id, email, passwordHash, ... }
  const byEmail = new Map();    // email -> id
  const sessions = new Map();   // sessionId -> { id, userId, ... }
  const counters = { reads: 0, writes: 0, scans: 0 };

  return {
    counters,
    reset() { counters.reads = 0; counters.writes = 0; counters.scans = 0; },

    async getUserByEmail(email) {
      counters.reads++;
      const id = byEmail.get(email);
      return id == null ? null : { ...users.get(id) };
    },
    async getUserById(id) {
      counters.reads++;
      const u = users.get(String(id));
      return u ? { ...u } : null;
    },
    async putUser(user) {
      counters.writes++;
      users.set(String(user.id), { ...user });
      byEmail.set(user.email, String(user.id));
      return { ...user };
    },

    async getSession(id) {
      counters.reads++;
      const s = sessions.get(String(id));
      return s ? { ...s } : null;
    },
    async putSession(session) {
      counters.writes++;
      sessions.set(String(session.id), { ...session });
      return { ...session };
    },
    async deleteSession(id) {
      counters.writes++;
      return sessions.delete(String(id));
    },
    /**
     * A SCAN. Every call is counted separately, because "list this user's sessions" is a
     * legitimate feature and "check a denylist on every request" is not — and they look identical
     * in code.
     */
    async sessionsForUser(userId) {
      counters.scans++;
      return [...sessions.values()].filter((s) => String(s.userId) === String(userId)).map((s) => ({ ...s }));
    },

    /** For the harness only. */
    _allSessions() { return [...sessions.values()]; },
    _userCount() { return users.size; },
  };
}

// ---------------------------------------------------------------------------
// An authorization server that follows the spec, so the only variable in drill 02 is your client.

import crypto from 'node:crypto';

const s256 = (v) => crypto.createHash('sha256').update(v).digest('base64url');

export function makeAuthServer({ issuer = 'https://idp.example.com', clientId = 'lab-client',
                                registeredRedirect = 'https://app.example.com/callback' } = {}) {
  const codes = new Map();      // code -> { used, challenge, method, redirectUri, nonce, sub, clientId }
  const log = { authorizeUrls: [], tokenRequests: [] };

  return {
    issuer, clientId, registeredRedirect, log,

    /**
     * The user visits the authorize URL and approves. Returns the redirect the browser is sent to.
     * The server enforces exact redirect_uri matching and requires a client_id — the parts that
     * are its job, not yours.
     */
    authorize(url) {
      log.authorizeUrls.push(url);
      const u = new URL(url);
      const p = u.searchParams;
      if (p.get('client_id') !== clientId) throw new Error('unknown client_id');
      if (p.get('response_type') !== 'code') throw new Error('unsupported response_type');
      // EXACT match, not prefix. A prefix match is an open redirect and therefore a code leak.
      if (p.get('redirect_uri') !== registeredRedirect) throw new Error('redirect_uri mismatch');

      const code = 'code_' + crypto.randomBytes(16).toString('base64url');
      codes.set(code, {
        used: false,
        challenge: p.get('code_challenge'),
        method: p.get('code_challenge_method'),
        redirectUri: p.get('redirect_uri'),
        nonce: p.get('nonce'),
        clientId: p.get('client_id'),
        sub: 'user-42',
      });

      const back = new URL(p.get('redirect_uri'));
      back.searchParams.set('code', code);
      if (p.get('state')) back.searchParams.set('state', p.get('state'));
      back.searchParams.set('iss', issuer);   // RFC 9207, so a client can tell WHO answered
      return back.toString();
    },

    /** The back-channel exchange. This is where PKCE is enforced. */
    token({ code, codeVerifier, redirectUri, clientId: cid }) {
      log.tokenRequests.push({ code, codeVerifier, redirectUri, clientId: cid });
      const entry = codes.get(code);
      if (!entry) throw new Error('invalid_grant: unknown code');
      if (entry.used) throw new Error('invalid_grant: code already redeemed');
      if (cid !== entry.clientId) throw new Error('invalid_grant: client mismatch');
      if (redirectUri !== entry.redirectUri) throw new Error('invalid_grant: redirect_uri mismatch');

      if (entry.challenge) {
        if (!codeVerifier) throw new Error('invalid_grant: code_verifier required');
        const derived = entry.method === 'S256' ? s256(codeVerifier) : codeVerifier;
        if (derived !== entry.challenge) throw new Error('invalid_grant: code_verifier mismatch');
      }
      // NOTE: no challenge means no PKCE, and this server — like most real ones for public
      // clients — still issues the token. That is the hole PKCE closes.

      entry.used = true;
      const idToken = Buffer.from(JSON.stringify({
        iss: issuer, aud: entry.clientId, sub: entry.sub, nonce: entry.nonce,
        iat: Math.floor(Date.now() / 1000),
      })).toString('base64url');
      return { access_token: 'at_' + crypto.randomBytes(16).toString('base64url'), id_token: idToken, token_type: 'Bearer' };
    },

    /** What an attacker gets by watching the browser: the redirect URL, and nothing else. */
    peekLastRedirect() { return log.authorizeUrls.at(-1); },
  };
}

export const sha256b64 = s256;
