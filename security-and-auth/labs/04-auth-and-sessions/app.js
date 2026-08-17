// Lab 04 — Client auth & sessions.
//
// The server issues a short-lived signed access token and a rotating refresh token in an HttpOnly
// cookie. Everything interesting here is about WHERE the client puts the access token and WHAT
// that choice costs when a script you did not write runs on your page.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

// The "memory" strategy: a module-scoped variable. Not reachable from another script's scope,
// not persisted, gone on reload. That last property is a feature and a cost.
let inMemoryToken = null;
let store = 'memory';
let lastRefreshCookieHint = null;

const put = (token) => {
  inMemoryToken = null;
  localStorage.removeItem('access_token');
  sessionStorage.removeItem('access_token');
  document.cookie = 'access_token=; Path=/; Max-Age=0';
  if (store === 'local') localStorage.setItem('access_token', token);
  else if (store === 'session') sessionStorage.setItem('access_token', token);
  else if (store === 'cookie') document.cookie = `access_token=${token}; Path=/; SameSite=Lax`;
  else inMemoryToken = token;
};

const get = () => {
  if (store === 'local') return localStorage.getItem('access_token');
  if (store === 'session') return sessionStorage.getItem('access_token');
  if (store === 'cookie') return document.cookie.split('; ').find((c) => c.startsWith('access_token='))?.split('=')[1] ?? null;
  return inMemoryToken;
};

function paintToken() {
  const t = get();
  if (!t) { $('tok').textContent = 'no access token held'; return; }
  const [h, p, s] = t.split('.');
  $('tok').innerHTML = `<b>${h}</b>.<i>${p}</i>.<u>${s}</u>` +
    `<br><span class="hint">header . claims . signature — the first two are base64url, i.e. PUBLIC.</span>`;
}

async function login(kind) {
  store = kind;
  const r = await fetch('/api/auth?action=login&ttl=8', { credentials: 'same-origin' })
    .then((x) => x.json());
  put(r.accessToken);
  paintToken();
  log.ok(`logged in — access token in ${kind}, valid ${r.expiresIn}s; refresh token in an HttpOnly cookie`);
  out.textContent =
    `Access token stored in: ${kind}. Refresh token: HttpOnly cookie (try document.cookie — it is\n` +
    'not there).\n\n' +
    'The split is the point. The access token is short-lived and gets attached to API calls, so it\n' +
    'has to be reachable by JavaScript. The refresh token is long-lived and therefore must NOT be —\n' +
    'it lives in a cookie the page cannot read and only travels to the refresh endpoint (Path is\n' +
    'scoped to /api/auth).\n\n' +
    'Now run the exfiltration script and see what a single XSS would have taken.';
}

on('s-local', () => login('local'));
on('s-session', () => login('session'));
on('s-memory', () => login('memory'));
on('s-cookie', () => login('cookie'));

on('xss', () => {
  // This is what one line of injected script does. It does not need a vulnerability in your auth
  // design — only the ability to run in your origin.
  const captured = {
    'localStorage.access_token': localStorage.getItem('access_token'),
    'sessionStorage.access_token': sessionStorage.getItem('access_token'),
    'document.cookie (readable)': document.cookie || '(nothing readable)',
    'the HttpOnly refresh cookie': null,
    'the in-memory variable': null,
  };
  renderTable('#results', Object.entries(captured).map(([what, value]) => ({
    what,
    captured: value ? `${String(value).slice(0, 28)}…` : 'nothing',
    _capturedClass: value ? 'no' : 'ok',
  })), { columns: ['what', 'captured'] });

  const got = Object.entries(captured).filter(([, v]) => v).map(([k]) => k);
  log[got.length ? 'bad' : 'ok'](`exfiltration captured: ${got.join(', ') || 'nothing'}`);

  out.textContent =
    (got.length
      ? `An injected script just read: ${got.join(', ')}.\n\n`
      : 'The injected script got nothing directly.\n\n') +
    'Now the honest part, because this is where most advice is wrong:\n\n' +
    'STORING THE TOKEN IN MEMORY IS BETTER, NOT SAFE. An attacker running script in your origin\n' +
    'does not need your token — they can simply call your API from your page, with your session,\n' +
    'and get the data. Every mitigation here is about limiting what an attacker can do AFTER the\n' +
    'page closes: exfiltrating a localStorage token gives them offline, long-lived, portable\n' +
    'access from their own machine. That is a materially worse outcome than "they abused the\n' +
    'session while the tab was open", which is why the ranking below is real but modest.\n\n' +
    '  HttpOnly cookie   the token is never in the JS heap at all              ← best\n' +
    '  memory            gone on reload; not readable by a later injected script\n' +
    '  sessionStorage    survives across the tab; readable by any script in the origin\n' +
    '  localStorage      survives forever, across tabs; readable; the worst option\n\n' +
    'The correct order of work: fix XSS first (labs 01–02). Storage choice is a mitigation, not a\n' +
    'substitute.';
});

on('decode', () => {
  const t = get();
  if (!t) return log.bad('no token');
  const claims = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  renderTable('#results', Object.entries(claims).map(([claim, value]) => ({
    claim, value: claim === 'exp' || claim === 'iat' ? `${value} (${new Date(value * 1000).toLocaleTimeString()})` : String(value),
  })), { columns: ['claim', 'value'] });
  out.textContent =
    'You just decoded a token in the browser with no key and no server call, because a JWT is\n' +
    'base64url — SIGNED, NOT ENCRYPTED. Two consequences:\n\n' +
    '1. Never put anything in a JWT you would not print on the page. Emails, internal ids, feature\n' +
    '   flags describing unreleased work — all of it is readable by the user and by anything that\n' +
    '   logs the token.\n' +
    '2. Decoding is fine for UI hints (show the username, pre-empt an expiry). It is NEVER\n' +
    '   authorisation. The client cannot verify a signature it does not have the key for, and even\n' +
    '   if it could, the client is the thing being attacked. The server re-checks every claim on\n' +
    '   every request. "The token says role=admin so we show the admin page" is a UI decision; the\n' +
    '   API must behave identically whether or not the page renders that button.';
});

on('tamper', async () => {
  const t = get();
  if (!t) return log.bad('no token');
  const [h, p, s] = t.split('.');
  const claims = JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/')));
  claims.role = 'admin';
  const forgedPayload = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const forged = `${h}.${forgedPayload}.${s}`;
  const r = await fetch('/api/auth?action=me', { headers: { authorization: `Bearer ${forged}` } });
  const body = await r.json();
  log[r.ok ? 'bad' : 'ok'](`forged role=admin → ${r.status} ${body.error ?? JSON.stringify(body)}`);
  out.textContent =
    `The server rejected it: ${r.status} "${body.error}".\n\n` +
    'The signature covers header + claims, so changing one byte of the payload invalidates it, and\n' +
    'you cannot recompute the signature without the key. That is the entire value of a JWT.\n\n' +
    'The failure modes worth knowing, because they are all real CVEs:\n' +
    '  · alg: "none"  — a verifier that trusts the header\'s algorithm field accepts unsigned\n' +
    '    tokens. Pin the expected algorithm; never read it from the token.\n' +
    '  · HS256 vs RS256 confusion — a verifier handed an RSA public key that accepts an HS256\n' +
    '    token signed WITH that public key as an HMAC secret. Pin the algorithm.\n' +
    '  · Not checking exp, or checking it with a client clock.\n' +
    '  · Not checking aud/iss, so a token minted for another service of yours is accepted here.\n\n' +
    'The comparison itself matters too: this server uses crypto.timingSafeEqual, because a\n' +
    'byte-by-byte string compare leaks the signature one character at a time.';
});

on('call', async () => {
  const token = get();
  const r = await fetch('/api/auth?action=me', { headers: token ? { authorization: `Bearer ${token}` } : {} });
  const body = await r.json();
  log[r.ok ? 'ok' : 'bad'](`GET /me → ${r.status} ${JSON.stringify(body)}`);
});

on('expire', async () => {
  log.muted('waiting 9s for the 8s token to expire…');
  await new Promise((r) => setTimeout(r, 9000));
  const r = await fetch('/api/auth?action=me', { headers: { authorization: `Bearer ${get()}` } });
  const body = await r.json();
  log.bad(`GET /me → ${r.status} ${body.error}`);
  out.textContent =
    'A 401 with "expired". This is the moment your interceptor exists for.\n\n' +
    'SILENT REFRESH, and the three things people get wrong:\n\n' +
    '1. THE STAMPEDE. Ten requests 401 at once, ten refresh calls fire, nine of them present a\n' +
    '   token that the first one already rotated — and reuse detection logs the user out. Fix: one\n' +
    '   in-flight refresh promise, shared; every 401 awaits it and then retries once.\n' +
    '2. THE RETRY LOOP. A refresh that also 401s must fail closed and log out, not retry forever.\n' +
    '   Retry each request AT MOST once after a successful refresh.\n' +
    '3. MULTI-TAB. Five tabs each refresh independently and rotate each other out. Fix: elect one\n' +
    '   tab via the Web Locks API (navigator.locks.request) or a BroadcastChannel, and have it\n' +
    '   broadcast the new token.\n\n' +
    'Better than reacting to a 401: refresh PROACTIVELY at ~75% of the token lifetime, and treat\n' +
    'the 401 path as the fallback. And never trust the client clock for expiry — use the server\n' +
    'expiresIn you were handed, measured against your own monotonic timer.';
});

on('refresh', async () => {
  const r = await fetch('/api/auth?action=refresh', { credentials: 'same-origin' });
  const body = await r.json();
  if (r.ok) {
    put(body.accessToken);
    paintToken();
    log.ok('refreshed — the refresh cookie was ROTATED; the old one is now single-use-spent');
    lastRefreshCookieHint = true;
    out.textContent =
      'New access token, and a new refresh cookie. The old refresh token still exists on the server\n' +
      'but is marked used.\n\n' +
      'Rotation on its own buys little. What buys something is what happens when the OLD one is\n' +
      'presented again — press "replay the previous refresh token".';
  } else {
    log.bad(`refresh failed: ${body.error}`);
  }
});

on('reuse', async () => {
  // The cookie has already been rotated, so we cannot literally resend the old one from here.
  // The server exposes the replay for us: it is the same check either way.
  log.head('— simulating an attacker replaying a refresh token they copied —');
  const body = await fetch('/api/auth?action=replay', { credentials: 'same-origin' }).then((x) => x.json());
  log.bad(`replayed ${body.replayed ?? ''} → ${body.error}`);
  out.textContent =
    'REFRESH TOKEN REUSE DETECTION, which is the reason rotation is worth the complexity.\n\n' +
    'A rotated token is single-use. If it is ever presented twice, exactly one thing is true: two\n' +
    'parties hold it. You cannot tell which one is the user — so you revoke the whole FAMILY and\n' +
    'force a real login. The legitimate user is inconvenienced once; the attacker loses persistent\n' +
    'access, and you get a signal that a theft happened, which you would otherwise never have.\n\n' +
    'This is also the answer to "why not just use long-lived tokens": a stolen long-lived token is\n' +
    'silent and permanent. Rotation converts theft into a detectable event.\n\n' +
    'Press "what the server knows" to see the family marked revoked.';
});

on('sessions', async () => {
  const { families } = await fetch('/api/auth?action=sessions').then((r) => r.json());
  renderTable('#results', families.map((f) => ({
    family: f.family, tokens: f.tokens, revoked: f.revoked ? 'REVOKED' : 'active',
    _revokedClass: f.revoked ? 'ok' : 'meh',
  })), { columns: ['family', 'tokens', 'revoked'] });
  out.textContent =
    'This table is the point of server-side session state, and the honest cost of stateless JWTs.\n\n' +
    'A pure JWT design cannot do any of: "log out everywhere", "show my active sessions", "revoke\n' +
    'that laptop", "this user was just banned, cut them off now". A signed token is valid until it\n' +
    'expires, full stop — the server has nothing to check against.\n\n' +
    'So real systems keep a list anyway, and the design question becomes: what is the shortest\n' +
    'access-token lifetime you can afford (the window of un-revokable access) versus how often you\n' +
    'are willing to hit the refresh path. Five to fifteen minutes is the usual answer. If you find\n' +
    'yourself checking a revocation list on EVERY request, you have rebuilt sessions with extra\n' +
    'steps — which is fine, but then use sessions.';
});

on('logout', async () => {
  await fetch('/api/auth?action=logout', { credentials: 'same-origin' });
  store = 'memory'; put(null); inMemoryToken = null;
  localStorage.removeItem('access_token'); sessionStorage.removeItem('access_token');
  paintToken();
  log.ok('logged out — family revoked server-side, local copies cleared');
  out.textContent =
    'Logout is three separate things, and skipping any one of them is a bug:\n' +
    '  1. revoke server-side (otherwise the token still works — see the sessions table)\n' +
    '  2. clear the client copy (localStorage, memory, caches, IndexedDB, the SW cache)\n' +
    '  3. tell the other tabs (BroadcastChannel, or the storage event)\n\n' +
    'Number 3 is the one that ships broken. Log out in one tab, and the other tab keeps making\n' +
    'authenticated calls with a token it still holds in memory until something 401s.';
});

paintToken();
