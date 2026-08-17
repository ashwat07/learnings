// Lab 03 — CSRF.
//
// Two variables: the cookie's SameSite attribute (a browser-side control) and the server-side
// defence (token / Origin check). The balance is the metric — if it drops, the attack worked.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
const EVIL = 'http://127.0.0.1:8081/security-and-auth/labs/03-csrf/attacker.html';

let before = null;

async function state() {
  const s = await fetch('/api/csrf?action=state', { cache: 'no-store' }).then((r) => r.json());
  $('balance').textContent = s.balance;
  $('#cfg').textContent = `defence: ${s.defense} · ${s.authenticated ? 'logged in' : 'logged out'}`;
  renderTable('#ledger', s.ledger.map((e) => ({
    at: e.at, to: e.to, amount: e.amount, result: e.result,
    _resultClass: e.result === 'TRANSFERRED' ? 'no' : 'ok',
  })), { columns: ['at', 'to', 'amount', 'result'] });
  return s;
}

async function login(samesite) {
  const r = await fetch(`/api/csrf?action=login&samesite=${samesite}`, { credentials: 'same-origin' })
    .then((x) => x.json());
  log.ok(`logged in — bank_session with SameSite=${r.sameSite}, balance reset to ${r.balance}`);
  await state();
  out.textContent =
    `The session cookie is HttpOnly with SameSite=${r.sameSite}.\n\n` +
    (samesite === 'None'
      ? 'SameSite=None means "send me on every cross-site request". This is the pre-2020 web, and it\n'
        + 'is what every CSRF tutorial assumes. Run any attack: it will work.'
      : samesite === 'Lax'
        ? "Lax is what Chrome applies when a cookie has no SameSite at all. It blocks cookies on\n"
          + 'cross-site POSTs and subresource requests, but STILL SENDS THEM on top-level GET\n'
          + 'navigations — which is why the "top-level GET" attack button exists.'
        : 'Strict never sends the cookie on any cross-site request, including a link someone clicks\n'
          + 'to your site. That is why it logs users out of their own inbound links, and why most\n'
          + 'apps run Lax on the session and Strict on a second, sensitive-action cookie.');
}

on('login-lax', () => login('Lax'));
on('login-strict', () => login('Strict'));
on('login-none', () => login('None'));
on('logout', async () => {
  await fetch('/api/csrf?action=logout');
  log.muted('logged out');
  await state();
});

for (const [id, defense] of [['def-none', 'none'], ['def-token', 'token'], ['def-origin', 'origin']]) {
  on(id, async () => {
    await fetch(`/api/csrf?action=config&defense=${defense}`);
    log.head(`defence: ${defense}`);
    await state();
  });
}

async function attack(mode) {
  before = (await state()).balance;
  log.head(`— attack: ${mode} —`);
  $('#evil').src = `${EVIL}?attack=${mode}&t=${Date.now()}`;
  setTimeout(verdict, 1200);
}

async function verdict() {
  const s = await state();
  if (s.balance < before) {
    log.bad(`ATTACK SUCCEEDED — balance ${before} → ${s.balance}`);
    out.textContent =
      `The attacker moved ${before - s.balance} out of the account.\n\n` +
      'Nothing was "hacked". The evil page could not read one byte of the bank\'s response — CORS\n' +
      'saw to that — and it did not need to. It caused a state-changing request, and your browser\n' +
      'attached your session cookie because that is what cookies do: they are attached by\n' +
      'DESTINATION, not by who asked.\n\n' +
      'That sentence is the whole of CSRF. Every defence is a way of adding a second signal that a\n' +
      'cross-site page cannot forge.';
  } else {
    const last = s.ledger.at(-1);
    log.ok(`blocked — ${last?.result ?? 'no request reached the server'}`);
    out.textContent =
      `Balance unchanged. Server ledger says: ${last?.result ?? '(the request never arrived)'}\n\n` +
      'Note WHERE it was stopped:\n' +
      '  "no session cookie was sent"  → the BROWSER stopped it, because of SameSite. The request\n' +
      '                                  still reached your server, just unauthenticated.\n' +
      '  "no CSRF token"               → your APPLICATION stopped it. Works regardless of browser.\n' +
      '  "Origin was …"                → your APPLICATION stopped it, using a header the attacker\n' +
      '                                  page cannot set.\n\n' +
      'Defence in depth means you want two of those, not one — SameSite has real gaps (see the\n' +
      'matrix), and a token is only as good as its rollout across every mutating route.';
  }
}

on('atk-post', () => attack('post'));
on('atk-get', () => attack('get'));
on('atk-fetch', () => attack('fetch'));

on('atk-toplevel', async () => {
  before = (await state()).balance;
  log.head('— attack: top-level GET navigation —');
  open('http://localhost:8080/api/csrf?action=transfer&to=attacker&amount=250&via=toplevel', '_blank');
  setTimeout(async () => {
    const s = await state();
    if (s.balance < before) {
      log.bad('SUCCEEDED even with SameSite=Lax');
      out.textContent =
        'This is the Lax gap worth memorising.\n\n' +
        'SameSite=Lax sends the cookie on cross-site TOP-LEVEL GET NAVIGATIONS — a clicked link, a\n' +
        'window.open, a redirect. That is deliberate: without it, every link into your site would\n' +
        'land the user logged out.\n\n' +
        'The consequence: Lax protects you only if your mutating endpoints are not GETs. Which is\n' +
        'the real rule — GET MUST BE SAFE. Not "should". A GET that changes state is exploitable by\n' +
        'a link, an <img>, a prefetch, a link preview in a chat app, and the browser\'s own\n' +
        'speculative loading.';
    } else {
      log.ok('blocked');
      await verdict();
    }
  }, 1500);
});

on('legit', async () => {
  before = (await state()).balance;
  // The real app can read the readable double-submit cookie and echo it back. An attacker page
  // cannot: it can cause the cookie to be SENT, but it cannot READ it (different origin).
  const csrf = document.cookie.split('; ').find((c) => c.startsWith('bank_csrf='))?.split('=')[1] ?? '';
  const r = await fetch('/api/csrf?action=transfer', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ to: 'landlord', amount: '100', csrf }),
  }).then((x) => x.json());
  log[r.ok ? 'ok' : 'bad'](`legitimate transfer: ${r.message}`);
  await state();
  out.textContent =
    'The legitimate request passes every defence, and it is worth being precise about why:\n\n' +
    '  · the cookie is sent because this is a same-site request\n' +
    `  · the CSRF token is present because this page could READ document.cookie (${csrf ? 'yes' : 'no cookie yet — log in'})\n` +
    '  · the Origin header is http://localhost:8080, set by the browser and unforgeable by script\n\n' +
    'That third point is the one to hold on to: Origin and Referer are FORBIDDEN HEADERS. A page\n' +
    'cannot set them, which is what makes checking them a real defence rather than a formality.';
});

on('matrix', () => {
  renderTable('#ledger', [
    { defence: 'SameSite=Strict', stops: 'all cross-site requests', misses: 'nothing cross-site — but breaks inbound links, and same-site subdomains are still "same site"', cost: 'users arrive logged out' },
    { defence: 'SameSite=Lax (default)', stops: 'cross-site POST, img, iframe, fetch', misses: 'top-level GET navigation → any state-changing GET is still exploitable', cost: 'none' },
    { defence: 'SameSite=None', stops: 'nothing', misses: 'everything', cost: 'requires Secure; needed for genuine third-party embedding' },
    { defence: 'CSRF token (synchroniser)', stops: 'everything, if applied to every mutating route', misses: 'routes you forgot; leaks via XSS', cost: 'server session state' },
    { defence: 'Double-submit cookie', stops: 'same, statelessly', misses: 'a subdomain that can set cookies on the parent domain can forge it', cost: 'sign the token to close that' },
    { defence: 'Origin / Referer check', stops: 'everything cross-site; headers are unforgeable', misses: 'requests with no Origin at all — decide your default', cost: 'careful with proxies stripping headers' },
    { defence: 'Custom header (X-Requested-With)', stops: 'forms and img (they cannot set headers)', misses: 'nothing modern — it forces a CORS preflight', cost: 'useless if you enable permissive CORS' },
    { defence: 'CORS', stops: 'the attacker READING the response', misses: 'the request still arrives and still mutates', cost: '— not a CSRF defence at all' },
  ], { columns: ['defence', 'stops', 'misses', 'cost'] });

  out.textContent =
    'What to actually ship, in order:\n\n' +
    '1. GET IS SAFE. No state change behind a GET, ever. This one rule removes the Lax gap, the\n' +
    '   <img> vector, the prefetch vector and the chat-link-preview vector at once.\n' +
    '2. SameSite=Lax on the session cookie (browsers do this by default now, but SET IT — the\n' +
    '   default is not universal and being explicit survives a browser changing its mind).\n' +
    '3. A CSRF token, or an Origin check, on every mutating route — enforced by the framework in\n' +
    '   one place, not by developers remembering. "Deny by default, opt out per route."\n' +
    '4. For JSON APIs: require a content-type of application/json AND a custom header. Neither can\n' +
    '   be produced by a cross-site form, and both force a preflight the attacker cannot satisfy.\n\n' +
    'The two things people get wrong:\n' +
    '  · "We have CORS, so we are safe from CSRF." CORS governs READING a response. The write\n' +
    '    already happened. Prove it to yourself with the fetch attack above — the fetch throws in\n' +
    '    the attacker page while the balance drops.\n' +
    '  · "SameSite fixed CSRF." It changed the default from dangerous to mostly-safe. It does not\n' +
    '    cover state-changing GETs, does not cover sibling subdomains, and does not exist on a\n' +
    '    request that carries an Authorization header instead of a cookie (that one is immune for a\n' +
    '    different reason: the browser never attaches it automatically).';
});

on('refresh', state);
on('clear', () => { log.clear(); $('#evil').src = 'about:blank'; });

state();
