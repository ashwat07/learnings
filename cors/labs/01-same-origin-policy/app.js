// Lab 01 — Same-origin policy.

import { $, on, Log } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
$('here').textContent = location.origin;

const ALT = 'http://localhost:8081';
const IP = `http://127.0.0.1:${location.port}`;

// ---------------------------------------------------------------------------
// 1. The origin quiz
// ---------------------------------------------------------------------------

const PAIRS = [
  ['https://example.com/a', 'https://example.com/b/c?d=1#e', true,
    'path, query and fragment are not part of the origin'],
  ['https://example.com', 'http://example.com', false,
    'different scheme — and this is the one that makes "it works locally" stories'],
  ['https://example.com', 'https://example.com:443', true,
    'the default port for the scheme is the same port'],
  ['http://example.com', 'http://example.com:8080', false,
    'different port'],
  ['https://example.com', 'https://www.example.com', false,
    'different host. "www" is a subdomain like any other'],
  ['https://a.example.com', 'https://b.example.com', false,
    'sibling subdomains are different origins (document.domain used to relax this — it is deprecated and being removed)'],
  ['http://localhost:8080', 'http://127.0.0.1:8080', false,
    'same machine, different host string, different origin. This bites everyone in local dev'],
  ['https://example.com', 'https://example.com.evil.com', false,
    'suffix matching is not a thing — and a server that implements ACAO with a naive startsWith/endsWith check has a vulnerability here'],
  ['about:blank in an iframe from https://example.com', 'https://example.com', true,
    'about:blank inherits the origin of the document that created it'],
  ['blob: URL created by https://example.com', 'https://example.com', true,
    'blob: and filesystem: URLs inherit the creating origin'],
  ['data:text/html,<h1>hi</h1>', 'anything', false,
    'data: URLs get an opaque origin — same-origin with nothing, not even themselves'],
];

function buildQuiz() {
  const box = $('quiz');
  for (const [a, b, , ] of PAIRS) {
    const row = document.createElement('div');
    row.className = 'q';
    row.innerHTML = `<div class="urls">${a}<br>${b}</div><div class="verdict">?</div>`;
    box.append(row);
  }
}

on('reveal', () => {
  const rows = [...$('quiz').children];
  PAIRS.forEach(([, , same, why], i) => {
    const v = rows[i].querySelector('.verdict');
    v.textContent = same ? 'SAME origin' : 'different origin';
    v.style.color = same ? 'var(--good)' : 'var(--bad)';
    rows[i].querySelector('.urls').insertAdjacentHTML('beforeend',
      `<div style="color:var(--muted)">${why}</div>`);
  });
  out.textContent =
    'Origin = scheme + host + port. Not "domain". Not "site" — that is a different concept ' +
    '(eTLD+1)\nused by cookies (SameSite) and cache partitioning, and it is why a cookie can be ' +
    'shared\nacross subdomains that are NOT same-origin. Two different boundaries, and knowing ' +
    'which one\napplies to which mechanism is most of the confusion.';
});

// ---------------------------------------------------------------------------
// 2. What is actually blocked
// ---------------------------------------------------------------------------

async function attempt(label, url, init = {}) {
  log.line(`→ ${label}`, 'muted');
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    log.ok(`   ok: status ${res.status}, type "${res.type}", ${text.length} bytes readable`);
    return { ok: true, res };
  } catch (err) {
    log.bad(`   blocked: ${err.name}: ${err.message}`);
    log.muted('   (the console has the real CORS message — TypeError: Failed to fetch is all JS gets)');
    return { ok: false, err };
  }
}

on('same', async () => {
  log.head('— same-origin fetch —');
  await attempt('fetch(/api/cors) on this origin', '/api/cors');
  out.textContent = 'No CORS involved at all. Same origin, no headers required, nothing to configure.';
});

on('cross', async () => {
  log.head('— cross-origin fetch, server sends no Access-Control-Allow-Origin —');
  await attempt(`fetch(${ALT}/api/cors)`, `${ALT}/api/cors`);
  out.textContent =
    'TypeError: Failed to fetch. Note what your JavaScript gets: nothing. Not the status code, not\n' +
    'the headers, not the body, not even a distinction between "CORS blocked it" and "the network\n' +
    'is down". That opacity is deliberate — leaking "this endpoint returned 403" would itself be\n' +
    'information about the user\'s session on another site.\n\n' +
    'The real message is in the console, and only in the console. This is why you debug CORS in\n' +
    'the Network panel, never in a try/catch.';
});

on('crossOk', async () => {
  log.head('— cross-origin fetch, server sends Access-Control-Allow-Origin: * —');
  await attempt(`fetch(${ALT}/api/cors?acao=*)`, `${ALT}/api/cors?acao=*`);
  out.textContent =
    'One header, sent by the server that owns the data. That is the entire mechanism: the resource\n' +
    'owner declares who may read it. Nothing changed on the client.';
});

on('proof', async () => {
  log.head('— did the blocked request actually reach the server? —');
  const before = await (await fetch(`${ALT}/api/stats`)).json();
  const beforeCount = before.hits['cors:GET'] || 0;
  log.muted(`server has handled ${beforeCount} GET /api/cors requests so far`);

  await attempt('blocked fetch (no ACAO)', `${ALT}/api/cors`);

  const after = await (await fetch(`${ALT}/api/stats`)).json();
  const afterCount = after.hits['cors:GET'] || 0;
  log.line(`server has now handled ${afterCount} — the "blocked" request ${afterCount > beforeCount ? 'DID' : 'did not'} arrive`,
    afterCount > beforeCount ? 'bad' : 'good');

  out.textContent =
    'The request was sent. The server ran it. If that endpoint had been DELETE /account, the\n' +
    'account would be gone. The browser only refused to give the RESPONSE to the page.\n\n' +
    'This is the whole basis of CSRF: a cross-origin request that has a side effect does not need\n' +
    'its response to be readable to be dangerous. CORS is not a defence against it — SameSite\n' +
    'cookies, CSRF tokens, and requiring a preflight (via a custom header or JSON content type)\n' +
    'are.\n\n' +
    'Corollary for API design: never put side effects behind GET, and never rely on "they cannot\n' +
    'read the response" as a security property.';
});

// ---------------------------------------------------------------------------
// 3. The tags that predate the policy
// ---------------------------------------------------------------------------

on('tags', () => {
  log.head('— cross-origin <img>, <script>, <link rel=stylesheet> —');
  const wrap = $('#canvasWrap');
  wrap.textContent = '';

  const img = document.createElement('img');
  img.src = `${ALT}/api/image.svg?delay=0&w=240&h=120&label=cross-origin`;
  img.crossOrigin = null;
  img.onload = () => log.ok('   <img> loaded and rendered — no CORS headers needed');
  img.onerror = () => log.bad('   <img> failed');
  wrap.append(img);

  const s = document.createElement('script');
  s.src = `${ALT}/api/script.js?delay=0&name=cross-origin-tag`;
  s.onload = () => log.ok('   <script> loaded AND EXECUTED in this page\'s context');
  document.body.append(s);

  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = `${ALT}/api/style.css?delay=0&name=xo`;
  l.onload = () => log.ok('   <link rel=stylesheet> applied');
  document.head.append(l);

  out.textContent =
    'None of these need CORS. <img>, <script>, <link>, <video>, <iframe> and <form> could always\n' +
    'load cross-origin — that predates the same-origin policy and the web would break if it\n' +
    'changed. What you cannot do is READ them: you cannot get the script\'s source text, the\n' +
    'stylesheet\'s rules (from another origin), or the image\'s pixels.\n\n' +
    'And note what <script> does: it executes third-party code with your page\'s full privileges.\n' +
    'That is why SRI (integrity=) and CSP exist — CORS was never the control for this.';
});

on('taint', () => {
  log.head('— canvas tainting —');
  const wrap = $('#canvasWrap');
  const img = wrap.querySelector('img');
  if (!img) return log.bad('load the tags first');
  const c = document.createElement('canvas');
  c.width = 240; c.height = 120;
  c.getContext('2d').drawImage(img, 0, 0, 240, 120);
  wrap.append(c);
  try {
    c.getContext('2d').getImageData(0, 0, 1, 1);
    log.ok('   read pixels successfully (image was same-origin or CORS-approved)');
  } catch (err) {
    log.bad(`   ${err.name}: ${err.message}`);
    log.muted('   the canvas is "tainted" — drawing a cross-origin image poisons it for reads');
  }
  out.textContent =
    'The image rendered fine, and you still cannot read its pixels. Same rule as fetch: displaying\n' +
    'is allowed, reading is not. Otherwise any page could load an internal image from a user\'s\n' +
    'intranet and exfiltrate the pixels.';
});

on('taintFixed', () => {
  log.head('— same image, crossorigin="anonymous" + ACAO on the response —');
  const wrap = $('#canvasWrap');
  const img = new Image();
  img.crossOrigin = 'anonymous';       // makes it a CORS request
  img.onload = () => {
    wrap.append(img);
    const c = document.createElement('canvas');
    c.width = 240; c.height = 120;
    c.getContext('2d').drawImage(img, 0, 0, 240, 120);
    wrap.append(c);
    try {
      c.getContext('2d').getImageData(0, 0, 1, 1);
      log.ok('   pixels readable — the image was fetched in CORS mode and the server allowed it');
    } catch (err) {
      log.bad(`   still tainted: ${err.message}`);
    }
  };
  img.onerror = () => log.bad('   image failed to load — with crossorigin set, a missing ACAO is now fatal');
  img.src = `${ALT}/api/image.svg?delay=0&w=240&h=120&label=CORS+image`;

  out.textContent =
    'crossorigin="anonymous" switches the tag from a no-CORS load to a CORS load. Two consequences,\n' +
    'and you need both in your head:\n' +
    '  1. If the server allows it, the result is readable (canvas, WebGL textures, fonts).\n' +
    '  2. If the server does NOT allow it, the load FAILS — an image that worked without the\n' +
    '     attribute now shows a broken icon. Adding crossorigin to be "safe" is how people break\n' +
    '     working images.\n\n' +
    'The same attribute on <script> is what enables useful error messages in window.onerror, and on\n' +
    '<link rel=preload as=font> it is mandatory (fonts are always fetched in CORS mode — omit it and\n' +
    'you download the font twice).';
});

// ---------------------------------------------------------------------------
// 4. no-cors mode
// ---------------------------------------------------------------------------

on('nocors', async () => {
  log.head('— fetch(url, { mode: "no-cors" }) —');
  const res = await fetch(`${ALT}/api/cors`, { mode: 'no-cors' });
  log.line(`   res.type      = ${res.type}`, 'macro');
  log.line(`   res.status    = ${res.status}   ← always 0, even if the server said 200 or 500`, 'macro');
  log.line(`   res.ok        = ${res.ok}`, 'macro');
  log.line(`   res.headers   = ${[...res.headers.keys()].length} readable headers`, 'macro');
  const body = await res.text();
  log.line(`   body length   = ${body.length}   ← always 0`, 'macro');

  out.textContent =
    'An opaque response. It exists, it can be passed around, it can be PUT IN A CACHE — and it\n' +
    'tells you nothing. You cannot know whether it succeeded.\n\n' +
    'Legitimate uses: precaching a cross-origin asset in a service worker (you will re-serve it\n' +
    'as-is), and fire-and-forget beacons. Everything else is someone silencing an error they\n' +
    'should have fixed — mode: "no-cors" does not "disable CORS", it disables your ability to\n' +
    'see the result.\n\n' +
    'Two traps for later: an opaque response has an unknown size, so the Cache Storage quota\n' +
    'charges you a fixed padding (often ~7MB) per entry; and res.ok is false for a perfectly\n' +
    'successful request, so naive error handling reports failures that did not happen.';
});

buildQuiz();
