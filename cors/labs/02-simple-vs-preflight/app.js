// Lab 02 — Simple vs preflighted requests.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
const ALT = 'http://localhost:8081';

// A permissive endpoint, so the only thing under test is whether a preflight happens.
const ENDPOINT = `${ALT}/api/cors?acao=echo&acam=GET,POST,PUT,PATCH,DELETE,HEAD` +
  '&acah=content-type,x-token,x-request-id,x-lang,authorization&acac=1&maxage=0';

// ---------------------------------------------------------------------------
// The rule, implemented from the Fetch spec.
//
// A request is "simple" (no preflight) when ALL of:
//   - method is GET, HEAD or POST
//   - every author-set header is CORS-safelisted
//   - if Content-Type is set, its value is one of three legacy form types
//   - (plus: no ReadableStream body, no XHR upload progress listener)
//
// The safelist is exactly "what an HTML form could already do in 1999". Anything a form could
// not do gets a permission check, because servers written before CORS existed were only ever
// exposed to form-shaped requests.
// ---------------------------------------------------------------------------

const SAFELISTED_HEADERS = new Set([
  'accept', 'accept-language', 'content-language', 'content-type', 'range',
]);

const SAFELISTED_CONTENT_TYPES = [
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
];

function analyse({ method, contentType, headers }) {
  const reasons = [];

  if (!['GET', 'HEAD', 'POST'].includes(method)) {
    reasons.push(`method ${method} is not GET/HEAD/POST — a form can only issue GET and POST`);
  }
  for (const h of headers) {
    const name = h.toLowerCase();
    if (!SAFELISTED_HEADERS.has(name)) {
      reasons.push(`header "${h}" is not CORS-safelisted — a form cannot set arbitrary headers`);
    }
  }
  if (contentType) {
    const base = contentType.split(';')[0].trim().toLowerCase();
    if (!SAFELISTED_CONTENT_TYPES.includes(base)) {
      reasons.push(`Content-Type "${base}" is not one of the three form encodings ` +
        '(this is why every JSON API preflights)');
    }
  }
  return { preflight: reasons.length > 0, reasons };
}

function readForm() {
  const method = $('method').value;
  const contentType = $('ctype').value;
  const headers = $('headers').value.split(',').map((s) => s.trim()).filter(Boolean);
  return { method, contentType, headers, creds: $('creds').checked };
}

// ---------------------------------------------------------------------------

async function preflightCount() {
  const stats = await (await fetch(`${ALT}/api/stats`)).json();
  return stats.hits['cors:preflight'] || 0;
}

on('predict', () => {
  const form = readForm();
  const { preflight, reasons } = analyse(form);
  log.head(`— prediction for ${form.method} with ${form.contentType || 'no body'} —`);
  log.line(preflight ? 'PREFLIGHT expected' : 'no preflight — this is a "simple" request',
    preflight ? 'macro' : 'good');
  for (const r of reasons) log.muted(`   because: ${r}`);
  if (form.creds) {
    log.muted('   note: credentials do NOT trigger a preflight by themselves — but they do change ' +
      'what the response must contain');
  }
  out.textContent = preflight
    ? 'Predicted: an OPTIONS goes first. Send it and check.'
    : 'Predicted: the request goes straight out. Send it and check.';
});

const rows = [];

async function send() {
  const form = readForm();
  const { preflight: predicted, reasons } = analyse(form);
  const before = await preflightCount();

  const headers = {};
  if (form.contentType) headers['content-type'] = form.contentType;
  for (const h of form.headers) headers[h] = 'lab';

  log.head(`— sending ${form.method} ${form.contentType || '(no body)'} ` +
    `${form.headers.length ? `+ ${form.headers.join(', ')}` : ''} —`);

  let outcome;
  try {
    const res = await fetch(ENDPOINT, {
      method: form.method,
      headers,
      body: ['GET', 'HEAD'].includes(form.method) ? undefined : JSON.stringify({ hi: 1 }),
      credentials: form.creds ? 'include' : 'same-origin',
    });
    await res.text();
    outcome = `${res.status} ok`;
    log.ok(`   request succeeded: ${res.status}`);
  } catch (err) {
    outcome = `blocked: ${err.message}`;
    log.bad(`   ${err.name}: ${err.message}`);
  }

  const after = await preflightCount();
  const actual = after > before;
  log.line(`   OPTIONS sent: ${actual ? 'YES' : 'no'}  (predicted ${predicted ? 'YES' : 'no'})`,
    actual === predicted ? 'good' : 'bad');

  rows.push({
    method: form.method,
    'Content-Type': form.contentType || '–',
    'extra headers': form.headers.join(', ') || '–',
    creds: form.creds ? 'include' : '–',
    preflight: actual ? 'yes' : 'no',
    predicted: predicted ? 'yes' : 'no',
    result: outcome,
    _preflightClass: actual === predicted ? 'ok' : 'no',
  });
  renderTable('#results', rows, {
    columns: ['method', 'Content-Type', 'extra headers', 'creds', 'preflight', 'predicted', 'result'],
  });

  out.textContent = reasons.length
    ? `Preflighted because:\n  • ${reasons.join('\n  • ')}`
    : 'No preflight: method, headers and Content-Type are all within the form-shaped safelist.';
}

on('send', () => send().catch((e) => log.bad(e.message)));

// ---------------------------------------------------------------------------
// Access-Control-Max-Age
// ---------------------------------------------------------------------------

on('maxage', async () => {
  log.head('— Access-Control-Max-Age: 3 identical preflighted requests —');
  const url = `${ALT}/api/cors?acao=echo&acam=PUT&acah=x-token&maxage=120&preflightDelay=300`;

  for (const label of ['1st', '2nd', '3rd']) {
    const before = await preflightCount();
    const t0 = performance.now();
    await fetch(url, { method: 'PUT', headers: { 'x-token': 'abc' }, body: '{}' }).then((r) => r.text());
    const wall = performance.now() - t0;
    const after = await preflightCount();
    log.line(`   ${label}: ${Math.round(wall)}ms, OPTIONS sent: ${after > before ? 'YES' : 'no (cached permission)'}`,
      after > before ? 'macro' : 'good');
  }

  out.textContent =
    'The first request paid for two round trips: OPTIONS (with a 300ms server delay here) and then\n' +
    'the real one. The next two skipped the OPTIONS entirely, because Access-Control-Max-Age=120\n' +
    'told the browser it could reuse the permission for 120 seconds.\n\n' +
    'This is the highest-value CORS tuning there is and it is almost always left at the default.\n' +
    'Caveats worth knowing:\n' +
    '  • the preflight cache is keyed by origin + URL + method + header set — a different header\n' +
    '    on the same endpoint is a separate cache entry, so N request shapes = N preflights\n' +
    '  • browsers cap it: Chrome 2 hours (7200), Firefox 24 hours, Safari 10 minutes. Sending\n' +
    '    86400 does not get you a day in Chrome\n' +
    '  • a value of 0 disables caching; -1 does too and is sometimes used to force a re-check\n' +
    '  • the cache is dropped when the network changes, and it is per-origin-pair';
});

// ---------------------------------------------------------------------------
// The safelist quiz
// ---------------------------------------------------------------------------

const QUIZ = [
  { method: 'GET', contentType: '', headers: [], note: 'the plain read' },
  { method: 'GET', contentType: '', headers: ['Authorization'], note: 'a bearer token on a GET' },
  { method: 'POST', contentType: 'application/x-www-form-urlencoded', headers: [], note: 'what a <form> sends' },
  { method: 'POST', contentType: 'multipart/form-data', headers: [], note: 'a file upload form' },
  { method: 'POST', contentType: 'text/plain', headers: [], note: 'the classic preflight dodge' },
  { method: 'POST', contentType: 'application/json', headers: [], note: 'every modern API' },
  { method: 'PUT', contentType: 'text/plain', headers: [], note: 'safe body, unsafe method' },
  { method: 'DELETE', contentType: '', headers: [], note: 'no body at all' },
  { method: 'GET', contentType: '', headers: ['X-Requested-With'], note: 'the jQuery-era header' },
  { method: 'HEAD', contentType: '', headers: ['Accept-Language'], note: 'safelisted header' },
];

on('quiz', async () => {
  log.head('— the safelist quiz: 10 request shapes —');
  const quizRows = [];
  for (const q of QUIZ) {
    const { preflight, reasons } = analyse(q);
    quizRows.push({
      request: `${q.method} ${q.contentType || '–'} ${q.headers.join(',') || ''}`.trim(),
      note: q.note,
      preflight: preflight ? 'YES' : 'no',
      why: reasons[0] || 'method, headers and content type are all safelisted',
      _preflightClass: preflight ? 'meh' : 'ok',
    });
  }
  renderTable('#results', quizRows, { columns: ['request', 'note', 'preflight', 'why'] });
  out.textContent =
    'Two rows worth dwelling on.\n\n' +
    'POST + text/plain does NOT preflight. You can send a JSON string with Content-Type: text/plain\n' +
    'and skip the extra round trip entirely. People do this for beacons and it is exactly what\n' +
    'navigator.sendBeacon does. It is also why "we only accept JSON so we are CSRF-safe" is wrong\n' +
    'if your server ignores the Content-Type and just parses the body.\n\n' +
    'GET + Authorization DOES preflight. The single most common surprise: adding a bearer token to\n' +
    'a read doubles the request count. Cache the preflight (Max-Age) or move the token to a cookie\n' +
    'if you can.';
});

on('clear', () => { rows.length = 0; $('results').textContent = ''; log.clear(); });
