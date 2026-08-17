// Lab 05 — Response headers & opaque responses.

import { $, on, Log, renderTable, fmt } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
const ALT = 'http://localhost:8081';

// The CORS-safelisted response headers: readable cross-origin with no configuration at all.
const SAFELISTED = [
  'cache-control', 'content-language', 'content-length', 'content-type', 'expires',
  'last-modified', 'pragma',
];

async function inspect(label, url, init = {}) {
  log.head(`— ${label} —`);
  try {
    const res = await fetch(url, init);
    const visible = [...res.headers.keys()].sort();
    await res.text();

    log.line(`   type: ${res.type}   status: ${res.status}   ok: ${res.ok}`, 'macro');
    log.line(`   ${visible.length} readable headers: ${visible.join(', ') || '(none)'}`,
      visible.length > 7 ? 'good' : 'macro');

    for (const h of ['x-total-count', 'x-request-id', 'content-type']) {
      const v = res.headers.get(h);
      log.line(`     ${h.padEnd(16)} ${v === null ? 'null  ← present on the wire, hidden from JS' : v}`,
        v === null ? 'bad' : 'good');
    }

    return {
      scenario: label,
      'response.type': res.type,
      'readable headers': visible.length,
      'x-total-count': res.headers.get('x-total-count') ?? 'null',
    };
  } catch (err) {
    log.bad(`   blocked: ${err.message}`);
    return { scenario: label, 'response.type': '–', 'readable headers': 0, 'x-total-count': 'blocked' };
  }
}

const rows = [];
function push(row) {
  rows.push(row);
  renderTable('#results', rows, {
    columns: ['scenario', 'response.type', 'readable headers', 'x-total-count'],
  });
}

// ---------------------------------------------------------------------------

on('default', async () => {
  push(await inspect('cross-origin, no Expose-Headers', `${ALT}/api/cors?acao=*`));
  out.textContent =
    'The server sent x-total-count: 42 and x-request-id. The browser received them. Your code\n' +
    'gets null.\n\n' +
    'Only seven response headers are readable cross-origin by default — the CORS-safelisted ones:\n' +
    `  ${SAFELISTED.join(', ')}\n\n` +
    'Everything else has to be named explicitly by the server. The reasoning is the same as for\n' +
    'bodies: header values can carry information about the user\'s session on that origin.';
});

on('exposed', async () => {
  push(await inspect('with Expose-Headers: x-total-count, x-request-id',
    `${ALT}/api/cors?acao=*&expose=x-total-count,x-request-id`));
  out.textContent =
    'Access-Control-Expose-Headers: x-total-count, x-request-id\n\n' +
    'One header on the server, and pagination works. This is the fix for the most common real\n' +
    'complaint in this area — "why can\'t I read the pagination/rate-limit/trace headers from our\n' +
    'own API?" — and the API team usually does not know the header exists.\n\n' +
    'Things you routinely need exposed: X-Total-Count, Link (pagination), X-RateLimit-*,\n' +
    'X-Request-Id (for support tickets), Content-Disposition (download filenames), and any\n' +
    'ETag you want a client-side cache to use.';
});

on('star', async () => {
  push(await inspect('Expose-Headers: *', `${ALT}/api/cors?acao=*&expose=*`));
  out.textContent =
    'The wildcard exposes every header except a handful of forbidden ones (Set-Cookie can never\n' +
    'be exposed). Convenient for a public read-only API. Note it does NOT work with credentials —\n' +
    'demo 4.';
});

on('starCreds', async () => {
  push(await inspect('Expose-Headers: * with credentials',
    `${ALT}/api/cors?acao=echo&acac=1&expose=*&vary=Origin`, { credentials: 'include' }));
  out.textContent =
    'With credentials, `*` is the literal header name "*" — so nothing extra is exposed and\n' +
    'x-total-count is null again. Same rule as ACAO, ACAM and ACAH in Lab 04: credentials mode\n' +
    'kills every wildcard. Enumerate the headers.';
});

on('sameOrigin', async () => {
  push(await inspect('same-origin (no CORS involved)', '/api/cors'));
  out.textContent =
    'Same-origin: every header is readable, no configuration. Worth doing once so you know what\n' +
    'you are missing — and as another argument for a same-origin proxy.';
});

// ---------------------------------------------------------------------------
// Opaque responses
// ---------------------------------------------------------------------------

on('opaque', async () => {
  log.head('— mode: "no-cors" —');
  const res = await fetch(`${ALT}/api/cors?status=500`, { mode: 'no-cors' });
  const body = await res.text();
  log.line(`   type=${res.type}  status=${res.status}  ok=${res.ok}  headers=${[...res.headers.keys()].length}  body=${body.length} bytes`, 'macro');
  log.bad('   the server returned 500 and you cannot tell');
  push({ scenario: 'no-cors (opaque)', 'response.type': res.type, 'readable headers': [...res.headers.keys()].length, 'x-total-count': 'null' });

  out.textContent =
    'An opaque response: status 0, ok false, no headers, empty body — whatever actually happened.\n' +
    'A 200 and a 500 are indistinguishable.\n\n' +
    'Where it is legitimately useful: precaching a cross-origin asset in a service worker, where\n' +
    'you will hand the bytes straight back to the browser without inspecting them. Everywhere else\n' +
    'it is an error being hidden. mode: "no-cors" does not disable CORS; it disables your ability\n' +
    'to see the result.\n\n' +
    'Two traps for the storage course:\n' +
    '  • cache.put() with an opaque response charges your quota a fixed padding (Chrome: ~7MB per\n' +
    '    entry) because the real size would leak cross-origin information\n' +
    '  • an opaque 404 caches happily as if it were a success, so your "offline app" ships with\n' +
    '    broken assets and no error anywhere';
});

on('opaqueRedirect', async () => {
  log.head('— redirect: "manual" —');
  const res = await fetch(`/api/redirect?n=1&to=${encodeURIComponent('/api/cors')}`, { redirect: 'manual' });
  log.line(`   type=${res.type}  status=${res.status}  url="${res.url}"`, 'macro');
  log.muted('   an "opaqueredirect": you know a redirect happened and nothing else — not even the ' +
    'Location. Even same-origin.');
  log.muted('   redirect: "error" rejects instead; the default "follow" transparently follows and ' +
    'gives you the final response, with CORS re-checked at every hop.');
  push({ scenario: 'redirect: manual', 'response.type': res.type, 'readable headers': [...res.headers.keys()].length, 'x-total-count': 'null' });

  out.textContent =
    'Three redirect modes:\n' +
    '  follow (default) — follow up to 20 hops; CORS is re-evaluated on EVERY hop, so a redirect\n' +
    '                     to another origin needs CORS headers on the final response too\n' +
    '  error            — reject the promise on any redirect\n' +
    '  manual           — resolve with an opaqueredirect you cannot inspect (this exists for\n' +
    '                     service workers to pass navigations through untouched)\n\n' +
    'Reminder from Lab 03: a PREFLIGHT may never be redirected under any of these modes.';
});

on('errors', async () => {
  log.head('— error opacity —');

  log.muted('a) 500 WITH CORS headers:');
  try {
    const res = await fetch(`${ALT}/api/cors?acao=*&status=500`);
    const text = await res.text();
    log.ok(`   readable: status ${res.status}, ${text.length} bytes of error detail — you can log ` +
      'the request id and show the user something useful');
  } catch (err) {
    log.bad(`   ${err.message}`);
  }

  log.muted('b) 500 WITHOUT CORS headers:');
  try {
    const res = await fetch(`${ALT}/api/cors?status=500`);
    await res.text();
    log.ok('   readable (unexpected)');
  } catch (err) {
    log.bad(`   ${err.name}: ${err.message}  ← identical to "server is down", "DNS failed", ` +
      '"offline", "blocked by an extension"');
  }

  out.textContent =
    'This is why "attach CORS headers to error responses" matters more than it sounds. Without\n' +
    'them your frontend cannot distinguish a validation error from an outage, your error reporting\n' +
    'records "Failed to fetch" for everything, and on-call has nothing to work with.\n\n' +
    'Concretely: put your CORS middleware in the OUTERMOST layer, after the response exists, so it\n' +
    'covers 4xx, 5xx, timeouts and framework-level errors — not just the handlers you wrote.\n\n' +
    'And expose an X-Request-Id so a user-reported error can be found in your logs. That single\n' +
    'header pays for itself the first week.';
});

on('progress', async () => {
  log.head('— download progress needs Content-Length (and sometimes Expose-Headers) —');
  const url = `${ALT}/api/blob?mb=4`;
  const res = await fetch(url);
  const total = Number(res.headers.get('content-length'));
  log.line(`   content-length: ${total ? fmt.bytes(total) : 'null — no progress possible'}`,
    total ? 'good' : 'bad');

  const reader = res.body.getReader();
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    if (received % (1024 * 1024) < value.length) {
      log.line(`   ${fmt.bytes(received)} / ${fmt.bytes(total)}  (${Math.round((received / total) * 100)}%)`, 'macro');
    }
  }
  log.ok(`   done: ${fmt.bytes(received)}`);

  out.textContent =
    'Content-Length is CORS-safelisted, so this works cross-origin without configuration — but\n' +
    'only if the server actually sends it. With chunked transfer encoding or on-the-fly\n' +
    'compression there is no Content-Length, and there is no way to show a percentage. Servers\n' +
    'sometimes send X-Uncompressed-Length for exactly this reason — and that one DOES need\n' +
    'Access-Control-Expose-Headers.\n\n' +
    'Note also: with Content-Encoding: gzip, Content-Length is the COMPRESSED size while your\n' +
    'reader yields DECOMPRESSED bytes, so a naive progress bar runs past 100%. Fetch decompresses\n' +
    'transparently; there is no way to observe the compressed stream.';
});

on('clear', () => { rows.length = 0; $('results').textContent = ''; log.clear(); });
