// Lab 03 — Debug a preflight failure.

import { $, on, Log } from '/shared/lab-ui.js';

const log = new Log('#log');
const ALT = 'http://localhost:8081';

/**
 * Each case describes a request that SHOULD work, a broken server config, and the fix.
 * `request` is what the page tries to do; `broken`/`fixed` are the server's CORS response.
 */
const CASES = [
  {
    id: 'noAcaoPreflight',
    title: 'A — PUT with a custom header',
    desc: 'The request: PUT /api/cors with x-token. The server team says "we added CORS".',
    request: { method: 'PUT', headers: { 'x-token': 'abc' } },
    broken: 'acam=PUT&acah=x-token',
    fixed: 'acao=echo&acam=PUT&acah=x-token',
    diag:
      'The preflight response has Access-Control-Allow-Methods and -Headers but NO\n' +
      'Access-Control-Allow-Origin. Every CORS response — preflight AND actual — needs ACAO.\n' +
      'Error: "Response to preflight request doesn\'t pass access control check: No\n' +
      '\'Access-Control-Allow-Origin\' header is present on the requested resource."\n\n' +
      'Where this comes from in real life: a hand-rolled OPTIONS handler that sets the two\n' +
      '"interesting" headers and forgets the one that grants access at all.',
  },
  {
    id: 'noAcam',
    title: 'B — PATCH a resource',
    desc: 'The request: PATCH /api/cors with JSON. GET and POST to the same endpoint work fine.',
    request: { method: 'PATCH', headers: { 'content-type': 'application/json' } },
    broken: 'acao=echo&acah=content-type&acam=GET,POST',
    fixed: 'acao=echo&acah=content-type&acam=GET,POST,PATCH,PUT,DELETE',
    diag:
      'Access-Control-Allow-Methods lists GET and POST only.\n' +
      'Error: "Method PATCH is not allowed by Access-Control-Allow-Methods in preflight response."\n\n' +
      'The tell that this is the bug: other verbs on the same endpoint work. Whenever "it works\n' +
      'for GET but not for PATCH", read ACAM first.\n\n' +
      'Note PATCH is not in the safelist even with a form content type, so it ALWAYS preflights.',
  },
  {
    id: 'noAcah',
    title: 'C — add a request id header',
    desc: 'The request: POST with Content-Type: application/json and x-request-id. It worked ' +
      'until someone added tracing headers.',
    request: { method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': 'r1' } },
    broken: 'acao=echo&acam=GET,POST&acah=content-type',
    fixed: 'acao=echo&acam=GET,POST&acah=content-type,x-request-id',
    diag:
      'Access-Control-Allow-Headers does not include x-request-id.\n' +
      'Error: "Request header field x-request-id is not allowed by Access-Control-Allow-Headers\n' +
      'in preflight response."\n\n' +
      'The classic regression: adding a tracing/auth header breaks every cross-origin call, and\n' +
      'the change that broke it is on the CLIENT while the fix is on the SERVER.\n\n' +
      'The browser tells the server which headers it wants via Access-Control-Request-Headers on\n' +
      'the OPTIONS — a correct implementation reflects that list back (after validating it), which\n' +
      'is why "echo the requested headers" is the standard middleware behaviour.',
  },
  {
    id: 'preflightAuth',
    title: 'D — authenticated endpoint',
    desc: 'The request: DELETE with an Authorization header. The endpoint is behind auth ' +
      'middleware.',
    request: { method: 'DELETE', headers: { authorization: 'Bearer x' } },
    broken: 'acao=echo&acam=DELETE&acah=authorization&preflightStatus=401',
    fixed: 'acao=echo&acam=DELETE&acah=authorization&preflightStatus=204',
    diag:
      'The OPTIONS itself returned 401. Error: "Response to preflight request doesn\'t pass access\n' +
      'control check: It does not have HTTP ok status."\n\n' +
      'Cause: auth middleware runs before the CORS middleware and rejects the OPTIONS — which the\n' +
      'browser sends WITHOUT credentials and without your Authorization header, by design. A\n' +
      'preflight can never be authenticated.\n\n' +
      'Fix: handle OPTIONS before any auth check, and return 204 with the CORS headers. In Express,\n' +
      'that means app.use(cors()) above your auth middleware; in nginx, an `if ($request_method =\n' +
      'OPTIONS) { return 204; }` block with the headers attached.',
  },
  {
    id: 'redirect',
    title: 'E — the URL redirects',
    desc: 'The request: PUT to a path that the server redirects (missing trailing slash, or ' +
      'http→https).',
    request: { method: 'PUT', headers: { 'x-token': 'abc' } },
    broken: `acao=echo&acam=PUT&acah=x-token&preflightRedirect=${encodeURIComponent(`${ALT}/api/cors?acao=echo&acam=PUT&acah=x-token`)}`,
    fixed: 'acao=echo&acam=PUT&acah=x-token',
    diag:
      'The preflight got a 302. Error: "Response to preflight request doesn\'t pass access control\n' +
      'check: Redirect is not allowed for a preflight request."\n\n' +
      'Preflights may not be redirected — full stop. Common causes: a missing/extra trailing slash\n' +
      'rule, an http→https upgrade, a locale prefix redirect, or a load balancer normalising the\n' +
      'path.\n\n' +
      'Fix: call the final URL directly. If you cannot control the client, make the redirect rule\n' +
      'skip OPTIONS. Note that the ACTUAL request may follow redirects — only the preflight may not,\n' +
      'which is why "it works in Postman" and fails in the browser.',
  },
  {
    id: 'preflightOnly',
    title: 'F — preflight passes, request still blocked',
    desc: 'The request: PUT with x-token. The Network panel shows the OPTIONS returning 204 with ' +
      'all the right headers.',
    request: { method: 'PUT', headers: { 'x-token': 'abc' } },
    broken: 'acao=echo&acam=PUT&acah=x-token&noActualCors=1',
    fixed: 'acao=echo&acam=PUT&acah=x-token',
    diag:
      'The preflight was fine. The ACTUAL response has no Access-Control-Allow-Origin.\n' +
      'Error: "No \'Access-Control-Allow-Origin\' header is present on the requested resource."\n' +
      '— with no mention of "preflight", which is the clue.\n\n' +
      'The two responses are checked independently. This happens when CORS is implemented in an\n' +
      'OPTIONS-only route, or when the real response comes from a different code path: an error\n' +
      'handler, a 500, a cached response, a 304, or a proxy short-circuit.\n\n' +
      'Debugging rule: if the error mentions "preflight", look at the OPTIONS. If it does not, look\n' +
      'at the real response — including its ERROR responses. Most CORS middleware forgets the 500.',
  },
  {
    id: 'multiOrigin',
    title: 'G — allow two origins',
    desc: 'The request: GET from this page. The server config lists both allowed origins.',
    request: { method: 'GET', headers: {} },
    broken: 'acao=' + encodeURIComponent('http://localhost:8080, http://localhost:3000'),
    fixed: 'acao=echo&vary=Origin',
    diag:
      'Access-Control-Allow-Origin may contain exactly ONE origin, or the literal `*`. A\n' +
      'comma-separated list is invalid and is treated as a mismatch.\n' +
      'Error: "The \'Access-Control-Allow-Origin\' header contains multiple values ..., but only\n' +
      'one is allowed."\n\n' +
      'The correct implementation: keep an allowlist server-side, compare the incoming Origin\n' +
      'header against it, and echo back that exact origin if it matches. And then — mandatory —\n' +
      'send `Vary: Origin`, or a cache will serve site A\'s ACAO to site B.\n\n' +
      'Do the comparison with an exact match on the full origin string. Not startsWith, not\n' +
      'endsWith, not a regex on the domain: `https://example.com.evil.com` passes all three of\n' +
      'those naive checks.',
  },
  {
    id: 'wildcardCreds',
    title: 'H — send the session cookie',
    desc: 'The request: GET with credentials: "include". The server allows all origins with *.',
    request: { method: 'GET', headers: {}, credentials: 'include' },
    broken: 'acao=*',
    fixed: 'acao=echo&acac=1&vary=Origin',
    diag:
      'Error: "The value of the \'Access-Control-Allow-Origin\' header in the response must not be\n' +
      'the wildcard \'*\' when the request\'s credentials mode is \'include\'."\n\n' +
      'With credentials, every wildcard stops working — for ACAO, and also for\n' +
      'Access-Control-Allow-Headers and -Methods, where `*` is likewise treated as a literal name\n' +
      'rather than "any".\n\n' +
      'You must echo the exact origin, add Access-Control-Allow-Credentials: true, and send\n' +
      'Vary: Origin. That is Lab 04 in full.',
  },
];

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

function urlFor(c, variant) {
  return `${ALT}/api/cors?${c[variant]}`;
}

async function runCase(c, variant) {
  const url = urlFor(c, variant);
  log.head(`— ${c.title} — ${variant} —`);
  log.muted(`   ${c.request.method} ${url}`);
  try {
    const res = await fetch(url, {
      method: c.request.method,
      headers: c.request.headers,
      credentials: c.request.credentials || 'same-origin',
      body: ['GET', 'HEAD'].includes(c.request.method) ? undefined : '{}',
    });
    const text = await res.text();
    log.ok(`   SUCCESS ${res.status} — ${text.length} bytes readable`);
  } catch (err) {
    log.bad(`   BLOCKED ${err.name}: ${err.message}`);
    log.muted('   → open the console for the real reason, then click "probe the OPTIONS"');
  }
}

/** Server-side curl: the only way to see a response the browser is hiding from you. */
async function probe(c, variant) {
  const target = urlFor(c, variant);
  const acrh = Object.keys(c.request.headers).join(',');
  const params = new URLSearchParams({
    url: target,
    method: 'OPTIONS',
    origin: location.origin,
    acrm: c.request.method,
  });
  if (acrh) params.set('acrh', acrh);

  const res = await fetch(`/api/probe?${params}`);
  const data = await res.json();

  const pre = document.querySelector(`#case-${c.id} pre`);
  pre.textContent =
    `OPTIONS ${target}\n` +
    `Origin: ${location.origin}\n` +
    `Access-Control-Request-Method: ${c.request.method}\n` +
    (acrh ? `Access-Control-Request-Headers: ${acrh}\n` : '') +
    `\n← ${data.status} ${data.statusText}\n` +
    Object.entries(data.headers || {})
      .filter(([k]) => k.startsWith('access-control') || ['location', 'vary', 'content-length'].includes(k))
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n') +
    (Object.keys(data.headers || {}).some((k) => k.startsWith('access-control'))
      ? '' : '\n(no access-control-* headers at all)');
}

function build() {
  const box = $('#cases');
  for (const c of CASES) {
    const el = document.createElement('div');
    el.className = 'case';
    el.id = `case-${c.id}`;
    el.innerHTML = `
      <h3>${c.title}</h3>
      <div class="desc">${c.desc}</div>
      <div class="row">
        <button data-act="broken" data-variant="bad">run (broken)</button>
        <button data-act="probe">probe the OPTIONS</button>
        <button data-act="fixed" data-variant="good">run (fixed)</button>
        <button data-act="reveal">reveal diagnosis</button>
      </div>
      <pre>(click "probe the OPTIONS" to see the raw exchange)</pre>
      <div class="diag"></div>`;
    el.querySelector('.diag').textContent = c.diag;
    el.addEventListener('click', (e) => {
      const act = e.target.dataset?.act;
      if (!act) return;
      if (act === 'reveal') el.classList.add('revealed');
      else if (act === 'probe') probe(c, 'broken').catch((err) => log.bad(err.message));
      else runCase(c, act);
    });
    box.append(el);
  }
}

on('runAll', async () => { log.clear(); for (const c of CASES) await runCase(c, 'broken'); });
on('fixAll', async () => { log.clear(); for (const c of CASES) await runCase(c, 'fixed'); });
on('revealAll', () => document.querySelectorAll('.case').forEach((el) => el.classList.add('revealed')));
on('clear', () => log.clear());

build();
