/** Drill 02 — reference. */

import crypto from 'node:crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const s256 = (v) => crypto.createHash('sha256').update(v).digest('base64url');

// A PKCE verifier is 43-128 characters of unreserved alphabet (RFC 7636). 32 random bytes
// base64url-encoded is 43 characters — the minimum, and enough: 256 bits.
const newVerifier = () => b64url(crypto.randomBytes(32));

const decodeJwtPayload = (token) => {
  const parts = String(token).split('.');
  // The lab's id_token is a bare base64url payload; a real one is header.payload.signature.
  const payload = parts.length >= 2 ? parts[1] : parts[0];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
};

const timingSafeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export function createClient({ clientId, redirectUri, issuer, tokenEndpoint, authorizeUrl = 'https://idp.example.com/authorize' }) {
  // Every state we have issued and not yet consumed. In a real client this is a signed,
  // HttpOnly, SameSite=Lax cookie or a server-side session entry with a few minutes' TTL — NOT
  // localStorage, which any XSS can read and any tab can share.
  const pending = new Map();

  return {
    async begin() {
      const verifier = newVerifier();
      const state = b64url(crypto.randomBytes(32));
      const nonce = b64url(crypto.randomBytes(32));

      const url = new URL(authorizeUrl);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('scope', 'openid profile');
      url.searchParams.set('state', state);
      url.searchParams.set('nonce', nonce);
      // THE VERIFIER NEVER LEAVES THE CLIENT. Only its hash goes in the front channel, which is
      // exactly why seeing this URL does not help an attacker.
      url.searchParams.set('code_challenge', s256(verifier));
      url.searchParams.set('code_challenge_method', 'S256');

      // `plain` is also in the spec and is worth understanding as a non-option: it sends the
      // verifier itself as the challenge, so anyone who sees the authorize URL has both halves.
      // It exists for constrained devices that cannot compute SHA-256. Yours can.

      pending.set(state, { verifier, nonce, createdAt: Date.now() });
      return { url: url.toString(), handle: { state } };
    },

    async callback(callbackUrl, handle) {
      const params = new URL(callbackUrl).searchParams;

      if (params.get('error')) throw new Error(`authorization failed: ${params.get('error')}`);

      // 1. STATE. Two checks, and both are needed: it must be the state THIS flow issued (so a
      //    callback from someone else's flow is refused), and it must still be pending (so a
      //    replayed callback is refused). Consume it before anything else can throw, so a failed
      //    exchange cannot leave it reusable.
      const returnedState = params.get('state');
      if (!returnedState) throw new Error('callback has no state');
      if (!handle?.state || !timingSafeEq(returnedState, handle.state)) {
        throw new Error('state mismatch — this callback belongs to a different flow');
      }
      const entry = pending.get(returnedState);
      if (!entry) throw new Error('state already used or expired');
      pending.delete(returnedState);                     // SINGLE USE

      // 2. ISSUER (RFC 9207). With one provider this looks like ceremony. With two, it is the
      //    control that stops the MIX-UP ATTACK: the attacker starts a flow at the honest provider,
      //    gets you to complete it at theirs, and your client exchanges the code at the wrong
      //    endpoint — handing the attacker's provider a code for your account, or handing you an
      //    identity from a provider you do not trust.
      const returnedIss = params.get('iss');
      if (issuer && returnedIss && returnedIss !== issuer) {
        throw new Error(`issuer mismatch: got ${returnedIss}, expected ${issuer}`);
      }
      if (issuer && !returnedIss) {
        // Absent is acceptable from a server that predates RFC 9207 — but if you support several
        // providers and none of them send it, you need another way to attribute the callback
        // (a per-provider redirect_uri is the usual answer).
      }

      const code = params.get('code');
      if (!code) throw new Error('callback has no code');

      // 3. THE BACK CHANNEL, with the verifier and the same redirect_uri. The server recomputes
      //    S256(verifier) and compares it to the challenge it stored — which is what makes a
      //    stolen code useless. redirect_uri is repeated so the server can confirm the code is
      //    being redeemed for the flow it was issued to.
      const tokens = await tokenEndpoint({ code, codeVerifier: entry.verifier, redirectUri, clientId });

      // 4. THE ID TOKEN. In a real client you VERIFY THE SIGNATURE first, against the provider's
      //    JWKS, with the algorithm pinned — never trusting the `alg` header, which is how the
      //    "alg: none" and RS256-to-HS256 confusion attacks work. Then the claims:
      let claims = null;
      if (tokens?.id_token) {
        claims = decodeJwtPayload(tokens.id_token);
        if (claims.iss !== issuer) throw new Error(`id_token iss ${claims.iss} != ${issuer}`);
        if (claims.aud !== clientId) throw new Error(`id_token aud ${claims.aud} != ${clientId}`);
        // The nonce binds this token to the request we started. Without it, an id_token the
        // attacker obtained in their own session can be replayed into yours.
        if (!timingSafeEq(claims.nonce ?? '', entry.nonce)) throw new Error('id_token nonce mismatch');
      }

      return { tokens, claims };
    },

    /** Exposed so the drill can attack it directly. */
    verifyIdToken(idToken, { nonce, issuer: iss, clientId: aud }) {
      const claims = decodeJwtPayload(idToken);
      if (claims.iss !== iss) throw new Error('iss mismatch');
      if (claims.aud !== aud) throw new Error('aud mismatch');
      if (!timingSafeEq(claims.nonce ?? '', nonce)) throw new Error('nonce mismatch');
      return claims;
    },
  };
}

export function verifyIdToken(idToken, opts) {
  return createClient({ clientId: opts.clientId, redirectUri: '', issuer: opts.issuer, tokenEndpoint: null })
    .verifyIdToken(idToken, opts);
}

/*
WHY PKCE, IN ONE PARAGRAPH

The authorization code arrives through the BROWSER — the front channel — which means it travels
through the URL bar, the history, the referrer, the OS's scheme handler, and any proxy on the path.
It is not a secret and cannot be made one. So the code is deliberately useless on its own: the
token exchange also requires a `code_verifier` that only ever existed inside the client that
started the flow, and the server has only ever seen its SHA-256. An attacker with the code and the
challenge has nothing, because SHA-256 does not run backwards.

That is also why PKCE replaced the implicit flow entirely. Implicit returned the ACCESS TOKEN in
the URL fragment — the token itself, in the browser — and no amount of care downstream fixes that.
If you find a codebase using `response_type=token`, that is the finding.

PKCE IS NOT ONLY FOR PUBLIC CLIENTS ANY MORE. It used to be presented as the mobile/SPA answer,
with a client secret being enough for a server-side app. OAuth 2.1 requires it for everyone,
because a client secret does not protect against code interception at the browser — it protects
against someone else pretending to be your client. Different attack, different control, and you
need both.

THE CHECKLIST FOR A CLIENT, in the order things go wrong

  · PKCE with S256. Never `plain`.
  · `state`, random per request, verified and CONSUMED on the callback.
  · `nonce`, and check it in the id_token. Nobody checks the nonce.
  · verify the id_token SIGNATURE against JWKS, with the algorithm pinned. Check `iss`, `aud`,
    `exp`, and clock skew. Do not trust the `alg` header.
  · exact `redirect_uri` registration, no wildcards, no path prefixes. A prefix match plus an open
    redirect on your domain is a code exfiltration.
  · `iss` on the callback if you support more than one provider.
  · never put tokens in localStorage. HttpOnly + Secure + SameSite cookies, or memory.
  · treat the access token as opaque. Do not parse it, do not make decisions from it — that is
    what the id_token and the userinfo endpoint are for. An access token's format is the resource
    server's business and may change.

AND THE PART THAT IS NOT A PROTOCOL PROBLEM
Once the flow succeeds you have an external identity, and you have to decide what it means. "Sign
in with Google returns an email you already have an account for" is an ACCOUNT LINKING decision,
and getting it wrong is a full takeover: if you link on an unverified email, anyone who can get a
token from any provider claiming that address becomes that user. Require `email_verified`, and
prefer linking on the provider's stable `sub` with an explicit confirmation step.
*/
