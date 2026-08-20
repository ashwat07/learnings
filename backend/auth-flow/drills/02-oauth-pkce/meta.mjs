import { makeAuthServer, sha256b64 } from '../../world.mjs';

export const title = 'OAuth2 authorization code + PKCE — the runner is the attacker';
export const task = `You are the CLIENT. The authorization server in world.mjs follows the spec
correctly, so the only thing under test is what your client sends and what it checks on the way
back.

  createClient({ clientId, redirectUri, issuer }) -> {
    begin()                  -> { url, handle }      build the authorize URL; keep what you need
    callback(url, handle)    -> { tokens, claims }   handle the redirect and exchange the code
    verifyIdToken(t, opts)   -> claims               check iss, aud and nonce; throw otherwise
  }

The attacker in these checks can see THE REDIRECT URL — a malicious app registered for your
scheme, a referrer leak, a shared machine, a proxy, an open redirect on your own domain. That is
the realistic threat model, and it is enough to steal an authorization code.

An authorization code alone must not be enough to get a token. Make that true.`;
export const passIf = 'the code is useless to whoever steals it, the callback cannot be forged or replayed, and the id_token is bound to your request';

const CLIENT_ID = 'lab-client';
const REDIRECT = 'https://app.example.com/callback';

const decodeIdToken = (t) => { try { return JSON.parse(Buffer.from(String(t), 'base64url').toString('utf8')); } catch { return null; } };

export async function check(s) {
  if (typeof s.createClient !== 'function') return [{ check: 'exports createClient(config)', actual: 'missing', pass: false }];
  const out = [];
  const guard = async (label, fn) => {
    try { const r = await fn(); out.push({ check: label, actual: r === true ? 'ok' : String(r), pass: r === true }); }
    catch (e) { out.push({ check: label, actual: `threw: ${e.message}`.slice(0, 66), pass: false }); }
  };
  const fresh = () => {
    const as = makeAuthServer({ clientId: CLIENT_ID, registeredRedirect: REDIRECT });
    const client = s.createClient({
      clientId: CLIENT_ID, redirectUri: REDIRECT, issuer: as.issuer,
      // The back channel. Your client calls this instead of doing HTTP.
      tokenEndpoint: (body) => as.token(body),
    });
    return { as, client };
  };
  const ok = async (p) => p.then(() => true, () => false);

  await guard('the happy path works end to end', async () => {
    const { as, client } = fresh();
    const { url, handle } = await client.begin();
    const redirect = as.authorize(url);
    const result = await client.callback(redirect, handle);
    return result?.tokens?.access_token ? true : `callback returned ${JSON.stringify(result)?.slice(0, 60)}`;
  });

  await guard('the authorize URL sends a PKCE challenge, method S256', async () => {
    const { client } = fresh();
    const { url } = await client.begin();
    const p = new URL(url).searchParams;
    if (!p.get('code_challenge')) return 'no code_challenge — an intercepted code is a token';
    const method = p.get('code_challenge_method');
    if (method !== 'S256') {
      return method === 'plain'
        ? 'code_challenge_method=plain — the challenge IS the verifier, so anyone who sees the ' +
          'authorize URL can complete the exchange. S256 is one-way; plain is decoration.'
        : `code_challenge_method=${method}, want S256`;
    }
    return true;
  });

  await guard('the verifier NEVER appears in the authorize URL', async () => {
    const { as, client } = fresh();
    const { url, handle } = await client.begin();
    const p = new URL(url).searchParams;
    const challenge = p.get('code_challenge');
    // Whatever the client kept, none of it may be derivable from the front-channel URL.
    for (const [k, v] of p) {
      if (k === 'code_challenge') continue;
      if (v && challenge && sha256b64(v) === challenge) {
        return `the parameter "${k}" hashes to the code_challenge — the verifier is in the URL, ` +
          `which defeats the whole mechanism`;
      }
    }
    void as; void handle;
    return true;
  });

  // THE attack.
  await guard('ATTACK: a stolen authorization code cannot be exchanged', async () => {
    const { as, client } = fresh();
    const { url, handle } = await client.begin();
    const redirect = as.authorize(url);

    // The attacker sees the redirect and lifts the code. They also saw the authorize URL, so they
    // have the challenge — and, without PKCE or with method=plain, that is everything they need.
    const stolenCode = new URL(redirect).searchParams.get('code');
    const seenChallenge = new URL(url).searchParams.get('code_challenge');

    let attackerWon = false;
    for (const guess of [undefined, seenChallenge, stolenCode]) {
      try {
        as.token({ code: stolenCode, codeVerifier: guess, redirectUri: REDIRECT, clientId: CLIENT_ID });
        attackerWon = true;
        break;
      } catch { /* refused, good */ }
    }
    if (attackerWon) {
      return 'the attacker exchanged the stolen code for a token using only what the browser ' +
        'exposed. That is the entire attack PKCE exists to stop.';
    }
    // ...and the legitimate client must still work.
    return (await ok(client.callback(redirect, handle))) ? true : 'the legitimate exchange also failed';
  });

  await guard('ATTACK: replaying the code a second time fails', async () => {
    const { as, client } = fresh();
    const { url, handle } = await client.begin();
    const redirect = as.authorize(url);
    if (!(await ok(client.callback(redirect, handle)))) return 'the first exchange failed';
    return (await ok(client.callback(redirect, handle)))
      ? 'the same authorization code was exchanged twice — a code is single-use, and a client that ' +
        'retries on a network error must not silently re-redeem'
      : true;
  });

  await guard('state is present and unguessable', async () => {
    const { client } = fresh();
    const seen = new Set();
    for (let i = 0; i < 20; i++) {
      const { url } = await client.begin();
      const state = new URL(url).searchParams.get('state');
      if (!state) return 'no state parameter — the callback is CSRF-able';
      if (state.length < 16) return `state is only ${state.length} characters — it has to be unguessable`;
      seen.add(state);
    }
    return seen.size === 20 ? true : `${20 - seen.size} of 20 states repeated — state must be per-request`;
  });

  // CSRF on the callback: the attacker starts their OWN flow and feeds the victim the redirect.
  await guard('ATTACK: a callback with someone else\'s state is rejected', async () => {
    const { as, client } = fresh();
    const { url: victimUrl, handle: victimHandle } = await client.begin();
    void victimUrl;

    // The attacker's own legitimate flow, against the same client.
    const attackerFlow = s.createClient({ clientId: CLIENT_ID, redirectUri: REDIRECT, issuer: as.issuer, tokenEndpoint: (b) => as.token(b) });
    const { url: attackerUrl } = await attackerFlow.begin();
    const attackerRedirect = as.authorize(attackerUrl);

    // The victim's browser is made to visit the attacker's callback. If the client accepts it, the
    // victim's session is now linked to the ATTACKER's identity at the provider.
    return (await ok(client.callback(attackerRedirect, victimHandle)))
      ? 'a callback carrying a different flow\'s state and code was accepted — the victim is now ' +
        'signed in as the attacker, which is how account-linking takeovers work'
      : true;
  });

  await guard('ATTACK: state is single-use — a valid callback cannot be replayed', async () => {
    const { as, client } = fresh();
    const { url, handle } = await client.begin();
    const redirect = as.authorize(url);
    await client.callback(redirect, handle).catch(() => {});
    // Same state, a fresh code the attacker obtained separately.
    const { url: url2 } = await client.begin();
    const second = as.authorize(url2);
    const forged = new URL(second);
    forged.searchParams.set('state', new URL(redirect).searchParams.get('state'));
    return (await ok(client.callback(forged.toString(), handle)))
      ? 'a state value was accepted twice — it must be consumed on first use'
      : true;
  });

  await guard('the id_token nonce is sent AND checked', async () => {
    const { as, client } = fresh();
    const { url, handle } = await client.begin();
    const nonce = new URL(url).searchParams.get('nonce');
    if (!nonce) return 'no nonce in the authorize URL — an id_token from another flow can be replayed at you';
    const redirect = as.authorize(url);
    const result = await client.callback(redirect, handle);
    const claims = result?.claims ?? decodeIdToken(result?.tokens?.id_token);
    if (!claims) return 'the client did not surface the id_token claims, so it cannot have checked them';
    if (claims.nonce !== nonce) return `the id_token nonce is ${claims.nonce}, the request sent ${nonce}`;
    return true;
  });

  await guard('ATTACK: an id_token minted for a DIFFERENT flow is rejected', async () => {
    const { as, client } = fresh();
    if (typeof client.verifyIdToken !== 'function') {
      return 'the client does not expose verifyIdToken(idToken, { nonce, issuer, clientId }) — ' +
        'which means nothing is checking the claims';
    }
    const mint = (claims) => Buffer.from(JSON.stringify(claims)).toString('base64url');
    const base = { iss: as.issuer, aud: CLIENT_ID, sub: 'user-42' };

    // Each of these is a real attack, and each is one claim away from valid.
    const forgeries = [
      ['a foreign nonce (replayed from the attacker\'s own session)', { ...base, nonce: 'not-your-nonce' }],
      ['no nonce at all', { ...base }],
      ['a different audience (a token for another client)', { ...base, aud: 'someone-elses-client', nonce: 'the-real-nonce' }],
      ['a different issuer', { ...base, iss: 'https://evil-idp.example.com', nonce: 'the-real-nonce' }],
    ];
    for (const [why, claims] of forgeries) {
      let accepted = false;
      try {
        await client.verifyIdToken(mint(claims), { nonce: 'the-real-nonce', issuer: as.issuer, clientId: CLIENT_ID });
        accepted = true;
      } catch { /* rejected, good */ }
      if (accepted) return `accepted an id_token with ${why}`;
    }

    // ...and a legitimate one must still pass.
    try {
      await client.verifyIdToken(mint({ ...base, nonce: 'the-real-nonce' }),
        { nonce: 'the-real-nonce', issuer: as.issuer, clientId: CLIENT_ID });
    } catch (e) { return `it also rejected a valid id_token: ${e.message}`; }
    return true;
  });

  await guard('ATTACK: a callback from a DIFFERENT issuer is rejected (the mix-up attack)', async () => {
    const { as, client } = fresh();
    const { url, handle } = await client.begin();
    const evil = makeAuthServer({ issuer: 'https://evil-idp.example.com', clientId: CLIENT_ID, registeredRedirect: REDIRECT });
    const evilRedirect = evil.authorize(new URL(url).toString().replace(as.issuer, evil.issuer));
    // Keep the victim's state so only `iss` distinguishes the two.
    const forged = new URL(evilRedirect);
    forged.searchParams.set('state', new URL(url).searchParams.get('state'));
    return (await ok(client.callback(forged.toString(), handle)))
      ? 'a callback claiming a different issuer was accepted — with more than one provider ' +
        'configured, that is how a code gets exchanged at the wrong one'
      : true;
  });

  await guard('the code is exchanged on the BACK channel, with the verifier', async () => {
    const { as, client } = fresh();
    const { url, handle } = await client.begin();
    const redirect = as.authorize(url);
    await client.callback(redirect, handle);
    const req = as.log.tokenRequests.at(-1);
    if (!req) return 'no token request reached the server';
    if (!req.codeVerifier) return 'the token request carried no code_verifier';
    if (!req.redirectUri) return 'the token request omitted redirect_uri — the server cannot bind the code to it';
    return true;
  });

  return out;
}
