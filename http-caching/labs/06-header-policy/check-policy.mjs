#!/usr/bin/env node
/**
 * check-policy.mjs — audit the caching headers of real URLs.
 *
 *   node check-policy.mjs https://example.com/ https://example.com/app.js
 *   node check-policy.mjs --from-page https://example.com/
 *   node check-policy.mjs --json https://example.com/app.js
 *
 * For each URL it reports the effective policy, the remaining freshness, whether the server
 * honours conditional requests, and any rule violations. Exit code is 1 if anything is an error.
 *
 * This is the starting point, not the finished tool — the lab README asks you to extend it.
 */

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const fromPage = args.includes('--from-page');
const urls = args.filter((a) => !a.startsWith('--'));

if (!urls.length) {
  console.error('usage: node check-policy.mjs [--json] [--from-page] <url> [url...]');
  process.exit(2);
}

const C = process.stdout.isTTY && !asJson
  ? { red: (s) => `\x1b[31m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` }
  : { red: (s) => s, yellow: (s) => s, green: (s) => s, dim: (s) => s, bold: (s) => s };

// ---------------------------------------------------------------------------

/** Parse Cache-Control into a map. Directives without values get `true`. */
function parseCacheControl(value) {
  const out = {};
  if (!value) return out;
  for (const part of value.split(',')) {
    const [k, ...rest] = part.trim().split('=');
    if (!k) continue;
    const v = rest.join('=').replace(/^"|"$/g, '');
    out[k.toLowerCase()] = v === '' ? true : (isNaN(Number(v)) ? v : Number(v));
  }
  return out;
}

const FINGERPRINT = /[.\-_/][a-f0-9]{8,}\b|\bv?\d+\.\d+\.\d+\b|[?&](v|ver|version|rev)=/i;

function analyse(url, res) {
  const h = Object.fromEntries(res.headers.entries());
  const cc = parseCacheControl(h['cache-control']);
  const age = Number(h.age || 0);
  const shared = cc['s-maxage'] ?? cc['max-age'];
  const maxAge = cc['max-age'];
  const findings = [];

  const add = (level, msg) => findings.push({ level, msg });

  const stores = !cc['no-store'];
  const freshFor = typeof maxAge === 'number' ? Math.max(maxAge - age, 0)
    : h.expires ? Math.max((new Date(h.expires) - Date.now()) / 1000, 0)
      : null;

  // --- rules ---------------------------------------------------------------

  if (!h['cache-control'] && !h.expires) {
    add('warn', 'no Cache-Control and no Expires: caches will apply heuristic freshness ' +
      '(commonly 10% of the time since Last-Modified). You are not choosing the policy; they are.');
  }

  if (typeof maxAge === 'number' && maxAge > 86400 * 30 && !FINGERPRINT.test(url)) {
    add('error', `max-age=${maxAge} (>30 days) on a URL with no visible fingerprint. ` +
      'You cannot ship a fix to anyone holding this.');
  }

  if (cc.immutable && !FINGERPRINT.test(url)) {
    add('error', '`immutable` on a URL with no content hash.');
  }

  if (stores && !cc.private && (h['set-cookie'] || h['authorization'])) {
    add('error', 'response is publicly cacheable and carries Set-Cookie: a shared cache may hand ' +
      'this session to another user.');
  }

  if (typeof maxAge === 'number' && maxAge > 0 && !h.etag && !h['last-modified']) {
    add('warn', 'cacheable but no validator: once stale, every request costs a full download ' +
      'instead of a 304.');
  }

  if ((cc['no-cache'] || maxAge === 0) && !h.etag && !h['last-modified']) {
    add('error', 'always revalidates but has no validator — this is as expensive as no-store, ' +
      'with extra steps.');
  }

  if (cc['no-store'] && (h.etag || typeof maxAge === 'number')) {
    add('warn', 'no-store alongside caching hints: the hints are dead weight. Confirm no-store is ' +
      'what you meant (private is usually what people want).');
  }

  const vary = (h.vary || '').toLowerCase();
  if (vary === '*') add('error', 'Vary: * makes the response permanently unreusable — say no-store instead.');
  if (vary.includes('user-agent')) add('error', 'Vary: User-Agent shatters the cache across the UA string space.');
  if (vary.includes('cookie') && stores && !cc.private) {
    add('error', 'Vary: Cookie on a publicly cacheable response: shared caches will store per-user copies.');
  }
  if (h['content-encoding'] && !vary.includes('accept-encoding')) {
    add('error', 'compressed response without Vary: Accept-Encoding — a cache can serve these ' +
      'bytes to a client that did not advertise support.');
  }
  const acao = h['access-control-allow-origin'];
  if (acao && acao !== '*' && !vary.includes('origin')) {
    add('error', 'Access-Control-Allow-Origin is origin-specific but Vary: Origin is missing — a ' +
      'cache can serve one site\'s ACAO to another, breaking or over-permitting CORS.');
  }

  if (age && typeof maxAge === 'number' && age > maxAge) {
    add('warn', `Age (${age}s) exceeds max-age (${maxAge}s): this arrived already stale.`);
  }

  const isHtml = (h['content-type'] || '').includes('text/html');
  if (isHtml && typeof maxAge === 'number' && maxAge > 300) {
    add('error', `HTML with max-age=${maxAge}: deploys cannot reach users holding this copy.`);
  }

  return { url, status: res.status, headers: h, cc, age, maxAge, shared, freshFor, findings };
}

/** Second request: does the server actually honour the validators it sent? */
async function checkConditional(url, headers) {
  const req = {};
  if (headers.etag) req['if-none-match'] = headers.etag;
  else if (headers['last-modified']) req['if-modified-since'] = headers['last-modified'];
  else return null;

  const res = await fetch(url, { headers: req, redirect: 'follow' });
  // Node's fetch does not follow the browser cache, so a 304 arrives as a 304.
  return { status: res.status, honoured: res.status === 304, sent: Object.keys(req)[0] };
}

async function extractSubresources(pageUrl) {
  const res = await fetch(pageUrl);
  const html = await res.text();
  const found = new Set([pageUrl]);
  const re = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const u = new URL(m[1], pageUrl);
      if (u.protocol.startsWith('http')) found.add(u.href);
    } catch { /* ignore */ }
  }
  return [...found];
}

function fmtSeconds(s) {
  if (s == null) return '–';
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${(s / 60).toFixed(1)}m`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}h`;
  return `${(s / 86400).toFixed(1)}d`;
}

// ---------------------------------------------------------------------------

const targets = fromPage ? await extractSubresources(urls[0]) : urls;
const reports = [];
let errors = 0;

for (const url of targets) {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    await res.arrayBuffer();
    const report = analyse(url, res);
    report.conditional = await checkConditional(url, report.headers);
    if (report.conditional && !report.conditional.honoured) {
      report.findings.push({
        level: 'error',
        msg: `sent ${report.conditional.sent} and got ${report.conditional.status} instead of 304 — ` +
          'the server advertises a validator it does not honour, so every revalidation is a full download.',
      });
    }
    reports.push(report);
    errors += report.findings.filter((f) => f.level === 'error').length;
  } catch (err) {
    reports.push({ url, error: String(err) });
    errors++;
  }
}

if (asJson) {
  console.log(JSON.stringify(reports, null, 2));
} else {
  for (const r of reports) {
    console.log('\n' + C.bold(r.url));
    if (r.error) { console.log('  ' + C.red(r.error)); continue; }
    console.log('  ' + C.dim('Cache-Control ') + (r.headers['cache-control'] || C.yellow('(absent)')));
    if (r.headers.etag) console.log('  ' + C.dim('ETag          ') + r.headers.etag);
    if (r.headers['last-modified']) console.log('  ' + C.dim('Last-Modified ') + r.headers['last-modified']);
    if (r.headers.vary) console.log('  ' + C.dim('Vary          ') + r.headers.vary);
    if (r.age) console.log('  ' + C.dim('Age           ') + r.age);
    console.log('  ' + C.dim('fresh for     ') + fmtSeconds(r.freshFor));
    if (r.conditional) {
      console.log('  ' + C.dim('conditional   ') +
        (r.conditional.honoured ? C.green('304 — honoured') : C.red(`${r.conditional.status} — NOT honoured`)));
    }
    for (const f of r.findings) {
      const tag = f.level === 'error' ? C.red('  ✗ ') : C.yellow('  ⚠ ');
      console.log(tag + f.msg);
    }
    if (!r.findings.length) console.log(C.green('  ✓ no findings'));
  }
  console.log(`\n${targets.length} URL(s) checked, ${errors} error-level finding(s).`);
}

process.exit(errors ? 1 : 0);
