// Lab 06 — Build a CORS diagnoser.
//
// The CORS check, implemented from the Fetch spec, so you can see the decision rather than
// guess at it. Read this file — it is short, and it is the whole protocol.

import { $, $$, on, renderTable } from '/shared/lab-ui.js';

const SAFELISTED_HEADERS = new Set(['accept', 'accept-language', 'content-language', 'content-type', 'range']);
const SAFELISTED_CONTENT_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];
const SAFELISTED_RESPONSE_HEADERS = ['cache-control', 'content-language', 'content-length',
  'content-type', 'expires', 'last-modified', 'pragma'];

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function readConfig() {
  return {
    acao: document.querySelector('input[name=acao]:checked').value,
    allowlist: $('allowlist').value.split('\n').map((s) => s.trim()).filter(Boolean),
    vary: $('vary').checked,
    methods: $$('.m:checked').map((el) => el.value),
    acah: $('acah').value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    maxAge: Number($('maxage').value),
    acac: $('acac').checked,
    expose: $('expose').value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    optionsAuth: $('optionsAuth').checked,
    errorCors: $('errorCors').checked,
    redirects: $('redirects').checked,
  };
}

/** What Access-Control-Allow-Origin would this config send for a given Origin? */
function acaoFor(cfg, origin) {
  switch (cfg.acao) {
    case 'none': return null;
    case 'star': return '*';
    case 'reflect': return origin;
    case 'allowlist': return cfg.allowlist.includes(origin) ? origin : null;
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// The requests we test against it
// ---------------------------------------------------------------------------

const APP = 'https://app.example.com';

const REQUESTS = [
  { name: 'GET, no creds', origin: APP, method: 'GET', headers: {}, creds: false },
  { name: 'GET, credentials: include', origin: APP, method: 'GET', headers: {}, creds: true },
  { name: 'POST JSON', origin: APP, method: 'POST', headers: { 'content-type': 'application/json' }, creds: false },
  { name: 'POST form-encoded', origin: APP, method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, creds: false },
  { name: 'PUT JSON + x-token', origin: APP, method: 'PUT', headers: { 'content-type': 'application/json', 'x-token': 'a' }, creds: false },
  { name: 'DELETE', origin: APP, method: 'DELETE', headers: {}, creds: false },
  { name: 'GET + Authorization', origin: APP, method: 'GET', headers: { authorization: 'Bearer x' }, creds: false },
  { name: 'GET from an unknown origin', origin: 'https://evil.example', method: 'GET', headers: {}, creds: false },
  { name: 'GET from a lookalike origin', origin: 'https://app.example.com.evil.example', method: 'GET', headers: {}, creds: false },
  { name: 'GET reading x-total-count', origin: APP, method: 'GET', headers: {}, creds: false, wantsHeader: 'x-total-count' },
];

// ---------------------------------------------------------------------------
// The algorithm
// ---------------------------------------------------------------------------

function needsPreflight(req) {
  const reasons = [];
  if (!['GET', 'HEAD', 'POST'].includes(req.method)) reasons.push(`method ${req.method}`);
  for (const h of Object.keys(req.headers)) {
    const n = h.toLowerCase();
    if (n === 'content-type') {
      const base = req.headers[h].split(';')[0].trim().toLowerCase();
      if (!SAFELISTED_CONTENT_TYPES.includes(base)) reasons.push(`Content-Type: ${base}`);
    } else if (!SAFELISTED_HEADERS.has(n)) {
      reasons.push(`header ${n}`);
    }
  }
  return reasons;
}

/** Check an ACAO value against an origin + credentials mode. Returns an error string or null. */
function checkAcao(acao, origin, creds, phase) {
  const where = phase === 'preflight' ? 'Response to preflight request doesn\'t pass access control check: ' : '';
  if (acao == null) {
    return `${where}No 'Access-Control-Allow-Origin' header is present on the requested resource.`;
  }
  if (acao.includes(',')) {
    return `${where}The 'Access-Control-Allow-Origin' header contains multiple values '${acao}', but only one is allowed.`;
  }
  if (creds && acao === '*') {
    return `${where}The value of the 'Access-Control-Allow-Origin' header must not be the wildcard '*' when the request's credentials mode is 'include'.`;
  }
  if (acao !== '*' && acao !== origin) {
    return `${where}The 'Access-Control-Allow-Origin' header has a value '${acao}' that is not equal to the supplied origin.`;
  }
  return null;
}

function simulate(cfg, req) {
  const preflightReasons = needsPreflight(req);
  const acao = acaoFor(cfg, req.origin);
  const out = {
    request: req.name,
    origin: req.origin === APP ? 'app (allowed?)' : req.origin,
    preflight: preflightReasons.length ? 'yes' : 'no',
    result: 'allowed',
    detail: preflightReasons.length ? `triggered by: ${preflightReasons.join(', ')}` : '',
  };

  // --- preflight phase ---
  if (preflightReasons.length) {
    if (cfg.redirects) {
      out.result = 'BLOCKED';
      out.detail = 'Response to preflight request doesn\'t pass access control check: Redirect is not allowed for a preflight request.';
      return out;
    }
    if (cfg.optionsAuth) {
      out.result = 'BLOCKED';
      out.detail = 'Response to preflight request doesn\'t pass access control check: It does not have HTTP ok status. ' +
        '(The preflight carries no credentials, so auth middleware rejected it.)';
      return out;
    }
    const acaoErr = checkAcao(acao, req.origin, req.creds, 'preflight');
    if (acaoErr) { out.result = 'BLOCKED'; out.detail = acaoErr; return out; }
    if (req.creds && !cfg.acac) {
      out.result = 'BLOCKED';
      out.detail = 'Response to preflight request doesn\'t pass access control check: The value of the ' +
        "'Access-Control-Allow-Credentials' header in the response is '' which must be 'true'.";
      return out;
    }
    if (!cfg.methods.includes(req.method)) {
      out.result = 'BLOCKED';
      out.detail = `Method ${req.method} is not allowed by Access-Control-Allow-Methods in preflight response.`;
      return out;
    }
    const missing = Object.keys(req.headers)
      .map((h) => h.toLowerCase())
      .filter((h) => !SAFELISTED_HEADERS.has(h) && !cfg.acah.includes(h));
    if (missing.length) {
      out.result = 'BLOCKED';
      out.detail = `Request header field ${missing[0]} is not allowed by Access-Control-Allow-Headers in preflight response.`;
      return out;
    }
  }

  // --- actual response phase ---
  const acaoErr = checkAcao(acao, req.origin, req.creds, 'actual');
  if (acaoErr) { out.result = 'BLOCKED'; out.detail = acaoErr; return out; }
  if (req.creds && !cfg.acac) {
    out.result = 'BLOCKED';
    out.detail = "The value of the 'Access-Control-Allow-Credentials' header in the response is '' which must be 'true'.";
    return out;
  }

  // --- readable headers ---
  if (req.wantsHeader) {
    const exposed = cfg.acac && cfg.expose.includes('*')
      ? []                                    // '*' is a literal name in credentials mode
      : cfg.expose.includes('*') ? ['(all)'] : cfg.expose;
    const readable = SAFELISTED_RESPONSE_HEADERS.includes(req.wantsHeader) ||
      exposed.includes('(all)') || exposed.includes(req.wantsHeader);
    out.detail = readable
      ? `allowed, and ${req.wantsHeader} is readable`
      : `allowed, but ${req.wantsHeader} reads as null — add it to Access-Control-Expose-Headers`;
    if (!readable) out.result = 'partial';
  }

  return out;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderHeaders(cfg) {
  const lines = [];
  const acao = acaoFor(cfg, APP);
  lines.push('# response to GET https://api.example.com/things  (Origin: https://app.example.com)');
  if (acao) lines.push(`Access-Control-Allow-Origin: ${acao}`);
  else lines.push('(no Access-Control-Allow-Origin)');
  if (cfg.acac) lines.push('Access-Control-Allow-Credentials: true');
  if (cfg.expose.length) lines.push(`Access-Control-Expose-Headers: ${cfg.expose.join(', ')}`);
  if (cfg.vary) lines.push('Vary: Origin');
  lines.push('');
  lines.push('# response to the preflight  OPTIONS https://api.example.com/things');
  if (acao) lines.push(`Access-Control-Allow-Origin: ${acao}`);
  lines.push(`Access-Control-Allow-Methods: ${cfg.methods.join(', ') || '(none)'}`);
  lines.push(`Access-Control-Allow-Headers: ${cfg.acah.join(', ') || '(none)'}`);
  if (cfg.acac) lines.push('Access-Control-Allow-Credentials: true');
  if (cfg.maxAge) lines.push(`Access-Control-Max-Age: ${cfg.maxAge}`);
  if (cfg.vary) lines.push('Vary: Origin');
  $('headersOut').textContent = lines.join('\n');
}

function run() {
  const cfg = readConfig();
  renderHeaders(cfg);
  const rows = REQUESTS.map((r) => {
    const res = simulate(cfg, r);
    return {
      ...res,
      _resultClass: res.result === 'allowed' ? 'ok' : res.result === 'partial' ? 'meh' : 'no',
    };
  });
  renderTable('#results', rows, { columns: ['request', 'origin', 'preflight', 'result', 'detail'] });

  const blocked = rows.filter((r) => r.result === 'BLOCKED').length;
  const preflights = rows.filter((r) => r.preflight === 'yes').length;
  $('out').textContent =
    `${blocked} of ${rows.length} requests blocked. ${preflights} require a preflight` +
    (cfg.maxAge ? `, cached for ${cfg.maxAge}s.` : ' — and Access-Control-Max-Age is 0, so every ' +
      'single call pays an extra round trip.');
}

// ---------------------------------------------------------------------------
// Security audit
// ---------------------------------------------------------------------------

function audit() {
  const cfg = readConfig();
  const findings = [];
  const add = (level, msg) => findings.push({ level, msg });

  if (cfg.acao === 'reflect' && cfg.acac) {
    add('no', 'CRITICAL: reflecting any Origin + Allow-Credentials. Every website on the internet ' +
      'can now read this API as the logged-in user. This is the single most exploited CORS ' +
      'misconfiguration and it is usually written as a one-line "fix" for a dev environment.');
  } else if (cfg.acao === 'reflect') {
    add('meh', 'Reflecting any Origin is equivalent to `*` for non-credentialed requests, but it ' +
      'is more dangerous because adding credentials later turns it critical. Prefer `*` if the ' +
      'data is genuinely public, or an allowlist if it is not.');
  }

  if (cfg.acao === 'star' && cfg.acac) {
    add('no', '`*` with Allow-Credentials is rejected by browsers — every credentialed request ' +
      'will fail. Use an exact origin.');
  }

  if ((cfg.acao === 'reflect' || cfg.acao === 'allowlist') && !cfg.vary) {
    add('no', 'Origin-specific ACAO without `Vary: Origin`. A shared cache can store the response ' +
      'with one site\'s ACAO and serve it to another — either breaking legitimate clients or ' +
      'granting access to a site that was never allowed.');
  }

  if (cfg.acao === 'allowlist' && cfg.allowlist.some((o) => o.includes('*') || !/^https?:\/\/[^/]+$/.test(o))) {
    add('no', 'An allowlist entry is not a plain origin (scheme://host[:port]). Wildcards and ' +
      'paths in an allowlist mean the comparison is not an exact string match, and every ' +
      'non-exact comparison has been bypassed by someone: evil-app.example.com, ' +
      'app.example.com.evil.com, https://app.example.com@evil.com.');
  }

  if (cfg.allowlist.some((o) => o.startsWith('http://') && !o.includes('localhost'))) {
    add('meh', 'A plain-http origin in the allowlist: anyone on the network can spoof that origin ' +
      'and read the responses.');
  }

  if (cfg.acac && cfg.expose.includes('*')) {
    add('meh', 'Expose-Headers: `*` does nothing in credentials mode — it is read as the literal ' +
      'header name "*". Enumerate the headers.');
  }

  if (!cfg.errorCors) {
    add('no', 'No CORS headers on 4xx/5xx responses. Your frontend cannot distinguish a validation ' +
      'error from an outage, and every backend failure is reported as "Failed to fetch".');
  }

  if (cfg.optionsAuth) {
    add('no', 'Auth middleware guards OPTIONS. Preflights carry no credentials by design, so every ' +
      'preflighted request fails with "It does not have HTTP ok status". Handle OPTIONS before auth.');
  }

  if (!cfg.maxAge) {
    add('meh', 'Access-Control-Max-Age is 0: every preflighted call pays a full extra round trip. ' +
      'Set 7200 (Chrome\'s cap) — it costs nothing.');
  }

  if (cfg.methods.includes('DELETE') && cfg.acao === 'star') {
    add('meh', 'Destructive methods allowed from any origin. `*` means the response is readable by ' +
      'anyone, and while CORS never prevented the request itself, advertising DELETE to every ' +
      'origin suggests the endpoint has no other authorisation story. Check that it does.');
  }

  if (!findings.length) add('ok', 'No findings. Now check the things this audit cannot see: is the ' +
    'allowlist comparison an exact string match? Are the CORS headers applied in the outermost ' +
    'middleware? Does a `null` origin (sandboxed iframe, redirected request) hit the allowlist?');

  const box = $('auditOut');
  box.textContent = '';
  for (const f of findings) {
    const d = document.createElement('div');
    d.className = f.level;
    d.textContent = (f.level === 'no' ? '✗ ' : f.level === 'meh' ? '⚠ ' : '✓ ') + f.msg;
    box.append(d);
  }
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

function preset(kind) {
  const set = (id, v) => { $(id).checked = v; };
  const radio = (v) => { document.querySelector(`input[name=acao][value=${v}]`).checked = true; };
  const methods = (list) => $$('.m').forEach((el) => { el.checked = list.includes(el.value); });

  if (kind === 'public') {
    radio('star'); set('vary', false); set('acac', false);
    methods(['GET']); $('acah').value = ''; $('maxage').value = 7200;
    $('expose').value = 'x-total-count, link, x-ratelimit-remaining';
    set('errorCors', true); set('optionsAuth', false); set('redirects', false);
  }
  if (kind === 'spa') {
    radio('allowlist'); set('vary', true); set('acac', true);
    methods(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
    $('acah').value = 'content-type, x-request-id';
    $('maxage').value = 7200;
    $('expose').value = 'x-request-id, x-total-count';
    set('errorCors', true); set('optionsAuth', false); set('redirects', false);
  }
  if (kind === 'widget') {
    radio('reflect'); set('vary', true); set('acac', false);
    methods(['GET', 'POST']); $('acah').value = 'content-type';
    $('maxage').value = 7200; $('expose').value = '';
    set('errorCors', true); set('optionsAuth', false); set('redirects', false);
  }
  run(); audit();
}

on('run', run);
on('audit', audit);
on('preset-public', () => preset('public'));
on('preset-spa', () => preset('spa'));
on('preset-widget', () => preset('widget'));

run();
