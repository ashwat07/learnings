// Lab 04 — Credentials.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

const target = () => $('target').value;
const sameSite = () => $('samesite').value;

// ---------------------------------------------------------------------------
// Setting the cookie
//
// To Set-Cookie cross-origin the response needs the same credential rules as reading one:
// an exact origin plus Access-Control-Allow-Credentials, and the fetch must use
// credentials: 'include' — otherwise the browser discards the Set-Cookie.
// ---------------------------------------------------------------------------

on('setCookie', async () => {
  const url = `${target()}/api/set-cookie?samesite=${sameSite()}&acao=echo&acac=1` +
    (sameSite() === 'None' ? '&secure=1' : '');
  log.head(`— setting lab_session on ${target()} with SameSite=${sameSite()} —`);
  try {
    const res = await fetch(url, { credentials: 'include' });
    const data = await res.json();
    log.ok(`   server sent: Set-Cookie: ${data.set}`);
    log.muted('   whether the browser STORED it is a separate question — check ' +
      'DevTools → Application → Cookies, and the console for a warning');
    if (sameSite() === 'None') {
      log.muted('   SameSite=None requires Secure. http://localhost is a secure context in Chrome, ' +
        'so this works here but would be rejected on plain http elsewhere.');
    }
  } catch (err) {
    log.bad(`   ${err.message}`);
  }
});

on('clearCookie', async () => {
  await fetch(`${target()}/api/set-cookie?name=lab_session&value=&samesite=Lax&acao=echo&acac=1`,
    { credentials: 'include' }).catch(() => {});
  log.muted('cleared (value emptied — check Application → Cookies to be sure)');
});

// ---------------------------------------------------------------------------
// Reading /api/whoami under different configurations
// ---------------------------------------------------------------------------

async function whoami(label, { credentials, acao, acac }) {
  const params = new URLSearchParams();
  if (acao) params.set('acao', acao);
  if (acac) params.set('acac', '1');
  params.set('vary', 'Origin');
  const url = `${target()}/api/whoami?${params}`;

  log.line(`→ ${label}`, 'muted');
  try {
    const res = await fetch(url, { credentials });
    const data = await res.json();
    const sawCookie = Boolean(data.cookieHeaderSeen);
    log.line(`   readable. server saw cookie: ${sawCookie ? data.cookieHeaderSeen : 'NO COOKIE'}`,
      sawCookie ? 'good' : 'macro');
    return { label, readable: 'yes', 'server saw cookie': sawCookie ? 'yes' : 'no', error: '–' };
  } catch (err) {
    log.bad(`   blocked: ${err.message}`);
    return { label, readable: 'NO', 'server saw cookie': '?', error: err.message };
  }
}

on('omit', async () => {
  const r = await whoami("credentials: 'omit'", { credentials: 'omit', acao: '*' });
  out.textContent =
    'omit: never send cookies, never accept Set-Cookie. Because no credentials are involved, the\n' +
    'server may use ACAO: * — this is the mode where wildcards are legal.';
  show([r]);
});

on('sameOrigin', async () => {
  const r = await whoami("credentials: 'same-origin' (the default)", { credentials: 'same-origin', acao: '*' });
  out.textContent =
    "same-origin is fetch()'s default: cookies are sent to your own origin and NOT to any other.\n" +
    'So a cross-origin call made with default options carries no session, and the server sees an\n' +
    'anonymous request. This is the source of "it works in the browser bar but not from my app" —\n' +
    'a manual visit is same-origin, your fetch is not.';
  show([r]);
});

on('include', async () => {
  const r = await whoami("credentials: 'include' + ACAO echo + ACAC", { credentials: 'include', acao: 'echo', acac: true });
  show([r]);
  out.textContent =
    'If the server saw the cookie, both systems agreed: CORS allowed the credentialed request, and\n' +
    'SameSite allowed the cookie onto it. If it was readable but the server saw NO cookie, CORS is\n' +
    'fine and SameSite (or third-party cookie blocking) dropped it — switch the target to\n' +
    '127.0.0.1 to see exactly that.';
});

on('wildcard', async () => {
  const r = await whoami("include + ACAO: *", { credentials: 'include', acao: '*' });
  show([r]);
  out.textContent =
    'Blocked. "The value of the Access-Control-Allow-Origin header must not be the wildcard *\n' +
    "when the request's credentials mode is 'include'.\"\n\n" +
    'Why: `*` means "any site may read this". Combined with cookies that would mean "any site may\n' +
    'read this user\'s private data", which is precisely the attack the same-origin policy exists\n' +
    'to prevent. The spec forces you to name the origin, which forces you to have an allowlist.';
});

on('noAcac', async () => {
  const r = await whoami('include + exact origin, no ACAC', { credentials: 'include', acao: 'echo' });
  show([r]);
  out.textContent =
    'Blocked, with a different message: "The value of the \'Access-Control-Allow-Credentials\'\n' +
    'header in the response is \'\' which must be \'true\'."\n\n' +
    'Naming the origin is not enough. The server must also explicitly opt in to credentials. Note\n' +
    'that ACAC must be on BOTH the preflight and the actual response when a preflight is involved.';
});

on('correct', async () => {
  const r = await whoami('include + exact origin + ACAC: true + Vary: Origin', { credentials: 'include', acao: 'echo', acac: true });
  show([r]);
  out.textContent =
    'The complete correct configuration for a credentialed cross-origin API:\n\n' +
    '  Access-Control-Allow-Origin: https://app.example.com   ← exact, from an allowlist\n' +
    '  Access-Control-Allow-Credentials: true\n' +
    '  Vary: Origin                                            ← or caches will mix origins up\n' +
    '  (on the preflight, additionally ACAM / ACAH / Max-Age)\n\n' +
    'And on the cookie itself: SameSite=None; Secure; HttpOnly, plus Partitioned if you want it to\n' +
    'survive third-party cookie deprecation.';
});

// ---------------------------------------------------------------------------

function show(rows) {
  renderTable('#results', rows.map(({ label, readable, error, ...rest }) => ({
    scenario: label,
    'response readable': readable,
    'server saw cookie': rest['server saw cookie'],
    error: error === '–' ? '–' : String(error).slice(0, 60),
  })), { columns: ['scenario', 'response readable', 'server saw cookie', 'error'] });
}

on('matrix', async () => {
  log.clear();
  log.head(`— full matrix against ${target()} —`);
  const rows = [];
  rows.push(await whoami("omit + ACAO:*", { credentials: 'omit', acao: '*' }));
  rows.push(await whoami("same-origin + ACAO:*", { credentials: 'same-origin', acao: '*' }));
  rows.push(await whoami("include + ACAO:*", { credentials: 'include', acao: '*' }));
  rows.push(await whoami("include + echo, no ACAC", { credentials: 'include', acao: 'echo' }));
  rows.push(await whoami("include + echo + ACAC", { credentials: 'include', acao: 'echo', acac: true }));
  show(rows);
  out.textContent =
    'Run this against BOTH targets and compare.\n\n' +
    '  localhost:8081  — cross-origin, same-site. Only the CORS rules bite.\n' +
    '  127.0.0.1:8080  — cross-origin AND cross-site. Now SameSite bites too: with SameSite=Lax\n' +
    '                    (the default) the cookie is simply not attached, even when CORS is\n' +
    '                    perfect. The response is readable and the server sees no session.\n\n' +
    'That combination — "CORS is fine, the API says I am logged out" — is the single most\n' +
    'confusing bug in this area, and the fix is on the cookie, not in any CORS header.';
});

on('readCookie', () => {
  log.head('— can JS read the cookie? —');
  log.line(`document.cookie on this origin: "${document.cookie}"`, 'macro');
  log.muted('The lab_session cookie is HttpOnly and belongs to another origin, so it appears here ' +
    'under neither condition. Two separate reasons, both absolute:');
  log.muted('  1. HttpOnly cookies are invisible to document.cookie — that is their entire job ' +
    '(XSS mitigation).');
  log.muted('  2. document.cookie only ever shows cookies for the CURRENT document\'s origin/site.');
  log.muted('And you cannot read Set-Cookie from a fetch Response either: it is a forbidden ' +
    'response header name, and Access-Control-Expose-Headers cannot expose it. There is no ' +
    'combination of headers that lets JS read a Set-Cookie cross-origin.');
  out.textContent =
    'If you find yourself needing to read a session cookie from JavaScript, the design is wrong.\n' +
    'Either the server should tell you what you need in the response body, or you should be using\n' +
    'a token in memory. "Read the cookie to know if the user is logged in" fails for HttpOnly\n' +
    'cookies, which are the only kind you should be using for sessions.';
});

on('wildcardHeaders', async () => {
  log.head('— Access-Control-Allow-Headers: * with credentials —');
  const url = `${target()}/api/cors?acao=echo&acac=1&acam=*&acah=*`;
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'x-token': 'abc' },
      credentials: 'include',
      body: '{}',
    });
    await res.text();
    log.ok('   succeeded — this browser accepted the wildcards');
  } catch (err) {
    log.bad(`   blocked: ${err.message}`);
  }
  log.muted('With credentials, `*` is treated as the LITERAL header/method named "*", not as ' +
    '"any". So ACAH: * allows exactly one header — one that nobody has ever sent. Same for ' +
    'ACAM: * and ACAO: *. When credentials are involved you must enumerate everything explicitly.');
  out.textContent =
    'The rule to remember: credentials mode turns every wildcard into a literal. Origin, methods,\n' +
    'headers, and (Lab 05) exposed headers all have to be spelled out.';
});

on('clear', () => log.clear());
