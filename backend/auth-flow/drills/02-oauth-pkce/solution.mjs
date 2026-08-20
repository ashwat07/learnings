/**
 * Drill 02 — the authorization code flow, as the client.
 *
 * The starting point is the flow as it is usually first written, and it works: the user is
 * redirected, comes back with a code, the code is exchanged, tokens arrive. Every integration test
 * passes.
 *
 * It has no PKCE, no state, and no nonce — so it is exploitable by anyone who can SEE THE REDIRECT
 * URL. That is not an exotic capability: a malicious app registered for your custom scheme, a
 * referrer leak, a proxy, a shared machine, an open redirect anywhere on your own domain, or a
 * browser extension. Any one of them turns "I saw a URL" into "I have your account".
 *
 *   createClient({ clientId, redirectUri, issuer, tokenEndpoint }) -> {
 *     begin()                 -> { url, handle }
 *     callback(url, handle)   -> { tokens, claims }
 *   }
 *
 * `handle` is whatever you need to remember between the redirect out and the redirect back — in a
 * real app it lives in a short-lived, HttpOnly cookie or a server-side session, never in
 * localStorage.
 *
 * The three parameters and what each one defends:
 *
 *   code_challenge / code_verifier (PKCE)   binds the code to the client that STARTED the flow.
 *                                           Without it, a stolen code is a token.
 *   state                                   binds the callback to a flow YOU started. Without it,
 *                                           an attacker can complete their own flow in your
 *                                           browser and you end up signed in as them.
 *   nonce                                   binds the id_token to this request, so one obtained
 *                                           elsewhere cannot be replayed at you.
 *
 * RFC 9207's `iss` is the fourth, and it matters as soon as you support more than one provider.
 */

export function createClient({ clientId, redirectUri, issuer, tokenEndpoint }) {
  return {
    async begin() {
      const url = new URL('https://idp.example.com/authorize');
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('scope', 'openid profile');
      return { url: url.toString(), handle: {} };
    },

    async callback(callbackUrl) {
      const code = new URL(callbackUrl).searchParams.get('code');
      if (!code) throw new Error('no code in the callback');
      // Whatever came back, exchange it. Nothing here proves this code belongs to a flow we
      // started, or that we are the client that started it.
      const tokens = await tokenEndpoint({ code, redirectUri, clientId });
      return { tokens };
    },
  };
}
