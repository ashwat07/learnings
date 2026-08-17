#!/usr/bin/env node
/**
 * server.mjs — the lab server for every course in this repo.
 *
 * It does two jobs:
 *
 *   1. Serve the repo as static files (so labs are plain files you can read).
 *   2. Expose /api/* endpoints whose HTTP behaviour you control from the query string:
 *      cache headers, validators, delays, CORS headers, cookies, redirects, failures.
 *
 * It listens on TWO ports so you have a real second origin without touching /etc/hosts:
 *
 *   http://localhost:8080   the app origin — open labs here
 *   http://localhost:8081   the "other" origin — cross-origin fetches, preconnect targets
 *
 * (http://127.0.0.1:8080 is also a third origin, since origin = scheme + host + port and
 *  "localhost" and "127.0.0.1" are different hosts. The CORS labs use all three.)
 *
 * No dependencies. Node 18+.
 *
 * Usage:  ./serve.sh   or   node server.mjs [appPort] [altPort]
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const APP_PORT = Number(process.argv[2] || 8080);
const ALT_PORT = Number(process.argv[3] || 8081);

// ---------------------------------------------------------------------------
// Server-side state
//
// Two things worth understanding here:
//
//   hits     — how many times a URL actually reached the server. This is the number
//              that proves a cache worked. If you reload and the counter does not move,
//              the browser answered from its own cache and the network never happened.
//   versions — a mutable "content version" per named asset, so you can change a resource
//              underneath a cache and watch validators (ETag / Last-Modified) do their job.
// ---------------------------------------------------------------------------

const hits = new Map();          // url path+query key -> count
const versions = new Map();      // asset name -> { v, mtime }
const log = [];                  // recent requests, for /api/log
const FROZEN_MTIME = new Date('2020-01-01T00:00:00Z');   // for /api/asset?freeze=1

function bump(key) {
  hits.set(key, (hits.get(key) || 0) + 1);
  return hits.get(key);
}

function version(name) {
  if (!versions.has(name)) versions.set(name, { v: 1, mtime: new Date() });
  return versions.get(name);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
};

function num(q, key, dflt = 0) {
  const v = Number(q.get(key));
  return Number.isFinite(v) && q.has(key) ? v : dflt;
}

function bool(q, key, dflt = false) {
  if (!q.has(key)) return dflt;
  const v = q.get(key);
  return v !== '0' && v !== 'false' && v !== 'no';
}

/** Deterministic filler so response sizes are controllable but compressible-ish. */
function filler(bytes) {
  if (bytes <= 0) return '';
  const unit = 'the quick brown fox jumps over the lazy dog. ';
  return unit.repeat(Math.ceil(bytes / unit.length)).slice(0, bytes);
}

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  if (body === undefined || res.req?.method === 'HEAD') res.end();
  else res.end(body);
}

function json(res, obj, status = 200, extra = {}) {
  const body = JSON.stringify(obj, null, 2);
  send(res, status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    ...extra,
  }, body);
}

// ---------------------------------------------------------------------------
// /api/asset — the HTTP-caching workhorse
//
// Everything about the response is yours to set:
//
//   ?name=app            identity; also the key for /api/bump and the hit counter
//   &type=js|css|json|txt|svg
//   &cc=max-age%3D60     raw Cache-Control (URL-encode the '=' as %3D or just use '=')
//   &etag=1              send a strong ETag derived from name+version, honour If-None-Match
//   &weak=1              make that ETag weak (W/"...")
//   &lm=1                send Last-Modified, honour If-Modified-Since
//   &vary=Accept         send a Vary header
//   &age=30              send an Age header (pretend a CDN held it this long)
//   &delay=500           server think-time in ms, before the first byte
//   &size=20000          pad the body to roughly this many bytes
//   &status=200          force a status code
//   &cors=1              add Access-Control-Allow-Origin: *
// ---------------------------------------------------------------------------

async function apiAsset(req, res, url) {
  const q = url.searchParams;
  const name = q.get('name') || 'asset';
  const type = q.get('type') || 'json';
  const state = version(name);
  const key = `asset:${name}`;
  const count = bump(key);

  await sleep(num(q, 'delay', 0));

  // `freeze=1` pins the validators to version 1 while the body keeps changing — i.e. a server
  // that lies about whether its content changed. This is how caches get poisoned, and it is a
  // real bug you will meet (templating engines that ETag the template, not the output).
  const frozen = bool(q, 'freeze');
  const validatorVersion = frozen ? 1 : state.v;
  const etagBase = `"${name}-v${validatorVersion}"`;
  const etag = bool(q, 'weak') ? `W/${etagBase}` : etagBase;
  const validatorMtime = frozen ? FROZEN_MTIME : state.mtime;
  const lastModified = validatorMtime.toUTCString();

  const headers = {};
  if (q.has('cc')) headers['cache-control'] = q.get('cc');
  if (bool(q, 'etag')) headers['etag'] = etag;
  if (bool(q, 'lm')) headers['last-modified'] = lastModified;
  if (q.has('vary')) headers['vary'] = q.get('vary');
  if (q.has('age')) headers['age'] = String(num(q, 'age'));
  if (bool(q, 'cors', true)) headers['access-control-allow-origin'] = '*';
  headers['x-served-at'] = new Date().toISOString();
  headers['x-server-hits'] = String(count);
  headers['x-asset-version'] = String(state.v);

  // Conditional request handling — this is the whole point of validators.
  const inm = req.headers['if-none-match'];
  const ims = req.headers['if-modified-since'];
  const etagMatches = inm && inm.split(',').some((t) => t.trim().replace(/^W\//, '') === etagBase);
  const notModifiedByDate = ims && bool(q, 'lm') &&
    new Date(ims).getTime() >= Math.floor(validatorMtime.getTime() / 1000) * 1000;

  if ((bool(q, 'etag') && etagMatches) || (!inm && notModifiedByDate)) {
    // 304 carries no body but MAY refresh caching headers.
    return send(res, 304, headers);
  }

  // `echoHeader=x-lang` makes the BODY depend on a request header — which is exactly when you
  // are obliged to send a matching `Vary`. Omit the Vary and you have built a cache-poisoning
  // bug you can watch happen (Lab 05).
  const echoed = q.has('echoHeader')
    ? (req.headers[q.get('echoHeader').toLowerCase()] ?? '(header absent)')
    : null;
  if (echoed !== null) headers['x-echoed-request-header'] = String(echoed).slice(0, 120);

  const payload = {
    js: `/* ${name} v${state.v} — served ${new Date().toISOString()} */
(globalThis.__loaded ||= []).push({ name: ${JSON.stringify(name)}, v: ${state.v}, at: performance.now() });
globalThis.dispatchEvent(new CustomEvent('lab:asset', { detail: { name: ${JSON.stringify(name)}, v: ${state.v} } }));
`,
    css: `/* ${name} v${state.v} */\n:root { --${name.replace(/\W/g, '')}-version: "${state.v}"; }\n`,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="#1c2440"/><text x="12" y="64" fill="#7c9cff" font-family="monospace" font-size="16">${name} v${state.v}</text></svg>`,
    txt: `${name} v${state.v}${echoed !== null ? ` echo=${echoed}` : ''}\n`,
    json: JSON.stringify({
      name,
      version: state.v,
      servedAt: new Date().toISOString(),
      serverHits: count,
      ...(echoed !== null ? { echo: echoed } : {}),
    }),
  }[type] ?? '';

  const pad = num(q, 'size', 0);
  const body = pad > payload.length
    ? (type === 'json'
      ? JSON.stringify({ ...JSON.parse(payload), pad: filler(pad - payload.length - 12) })
      : payload + (type === 'css' ? `\n/* ${filler(pad - payload.length)} */` : `\n// ${filler(pad - payload.length)}`))
    : payload;

  headers['content-type'] = { js: MIME['.js'], css: MIME['.css'], svg: MIME['.svg'], txt: 'text/plain; charset=utf-8', json: MIME['.json'] }[type];
  headers['content-length'] = Buffer.byteLength(body);

  send(res, num(q, 'status', 200), headers, body);
}

// ---------------------------------------------------------------------------
// /api/cors — a deliberately unhelpful CORS endpoint you configure by hand.
//
//   ?acao=*                  Access-Control-Allow-Origin (use 'echo' to mirror the Origin)
//   &acam=GET,PUT            Access-Control-Allow-Methods (preflight response)
//   &acah=content-type       Access-Control-Allow-Headers (preflight response)
//   &acac=1                  Access-Control-Allow-Credentials: true
//   &expose=x-total-count    Access-Control-Expose-Headers
//   &maxage=600              Access-Control-Max-Age
//   &preflightStatus=204     status for the OPTIONS response
//   &preflightDelay=300      ms of delay on the OPTIONS response
//   &delay=0                 ms of delay on the actual response
//   &status=200              status for the actual response
//
// Omit a param and the header is simply absent — which is exactly how real CORS bugs look.
// ---------------------------------------------------------------------------

function corsHeaders(q, req, forPreflight) {
  const h = {};
  const acao = q.get('acao');
  if (acao) h['access-control-allow-origin'] = acao === 'echo' ? (req.headers.origin || '*') : acao;
  if (bool(q, 'acac')) h['access-control-allow-credentials'] = 'true';
  if (q.has('expose')) h['access-control-expose-headers'] = q.get('expose');
  if (q.has('vary')) h['vary'] = q.get('vary');
  if (forPreflight) {
    if (q.has('acam')) h['access-control-allow-methods'] = q.get('acam');
    if (q.has('acah')) h['access-control-allow-headers'] = q.get('acah');
    if (q.has('maxage')) h['access-control-max-age'] = q.get('maxage');
  }
  return h;
}

async function apiCors(req, res, url) {
  const q = url.searchParams;
  const preflight = req.method === 'OPTIONS';
  bump(`cors:${preflight ? 'preflight' : req.method}`);

  if (preflight) {
    await sleep(num(q, 'preflightDelay', 0));
    if (q.has('preflightRedirect')) {
      return send(res, 302, { location: q.get('preflightRedirect') });
    }
    return send(res, num(q, 'preflightStatus', 204), {
      ...corsHeaders(q, req, true),
      'content-length': 0,
    });
  }

  await sleep(num(q, 'delay', 0));

  // `noActualCors=1` sends CORS headers on the preflight but NOT on the real response — the
  // classic "my OPTIONS is fine, why is it still blocked" configuration.
  const actualCors = bool(q, 'noActualCors') ? {} : corsHeaders(q, req, false);

  const body = JSON.stringify({
    ok: true,
    method: req.method,
    origin: req.headers.origin ?? null,
    sawCookie: req.headers.cookie ?? null,
    requestHeaders: req.headers,
    note: 'If you can read this in JS, CORS allowed it. If not, the response still arrived — the browser just refused to hand it to you.',
  }, null, 2);

  send(res, num(q, 'status', 200), {
    'content-type': MIME['.json'],
    'cache-control': 'no-store',
    'x-total-count': '42',
    'x-request-id': 'req_' + Math.random().toString(36).slice(2, 10),
    ...actualCors,
    'content-length': Buffer.byteLength(body),
  }, body);
}

// ---------------------------------------------------------------------------
// Cookies, for the credentials labs.
// ---------------------------------------------------------------------------

function apiSetCookie(req, res, url) {
  const q = url.searchParams;
  const name = q.get('name') || 'lab_session';
  const value = q.get('value') || 'abc123';
  const sameSite = q.get('samesite') || 'Lax';       // Strict | Lax | None
  const parts = [`${name}=${value}`, 'Path=/', `SameSite=${sameSite}`, 'Max-Age=3600'];
  if (bool(q, 'httponly', true)) parts.push('HttpOnly');
  if (bool(q, 'secure', sameSite.toLowerCase() === 'none')) parts.push('Secure');

  json(res, {
    set: parts.join('; '),
    hint: 'SameSite=None requires Secure. http://localhost counts as a secure context in Chrome, so it works here but would not on plain http on a real host.',
  }, 200, {
    'set-cookie': parts.join('; '),
    ...corsHeaders(url.searchParams, req, false),
    'access-control-allow-origin': url.searchParams.get('acao') === 'echo'
      ? (req.headers.origin || '*') : (url.searchParams.get('acao') || '*'),
  });
}

function apiWhoami(req, res, url) {
  const q = url.searchParams;
  if (req.method === 'OPTIONS') {
    return send(res, 204, { ...corsHeaders(q, req, true), 'content-length': 0 });
  }
  const cookie = req.headers.cookie || '';
  json(res, {
    authenticated: cookie.includes('lab_session='),
    cookieHeaderSeen: cookie || null,
    origin: req.headers.origin ?? null,
  }, 200, corsHeaders(q, req, false));
}

// ---------------------------------------------------------------------------
// Timing / waterfall endpoints, for the resource-hint and worker labs.
// ---------------------------------------------------------------------------

async function apiSlow(req, res, url, kind) {
  const q = url.searchParams;
  const name = q.get('name') || kind;
  bump(`slow:${name}`);
  await sleep(num(q, 'delay', 300));

  const bodies = {
    js: `(globalThis.__loaded ||= []).push({ name: ${JSON.stringify(name)}, at: performance.now() });\n` +
        (q.has('then') ? `import(${JSON.stringify(q.get('then'))});\n` : '') +
        `// ${filler(num(q, 'size', 0))}`,
    css: `.hint-${name.replace(/\W/g, '')} { --loaded: 1; }\n` +
         (q.has('img') ? `#hero { background-image: url(${JSON.stringify(q.get('img'))}); }\n` : '') +
         `/* ${filler(num(q, 'size', 0))} */`,
  };
  const body = bodies[kind];
  send(res, 200, {
    'content-type': kind === 'js' ? MIME['.js'] : MIME['.css'],
    'cache-control': q.get('cc') || 'no-store',
    'access-control-allow-origin': '*',
    'timing-allow-origin': '*',
    'content-length': Buffer.byteLength(body),
  }, body);
}

async function apiImage(req, res, url) {
  const q = url.searchParams;
  bump(`img:${q.get('name') || 'img'}`);
  await sleep(num(q, 'delay', 300));
  const w = num(q, 'w', 600), h = num(q, 'h', 300);
  const label = q.get('label') || `${w}×${h}`;
  const body = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#233a6d"/><stop offset="1" stop-color="#5b2f6d"/></linearGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
  <text x="24" y="${h / 2}" fill="#cdd6ff" font-family="monospace" font-size="${Math.round(h / 8)}">${label}</text>
  <!-- ${filler(num(q, 'size', 0))} -->
</svg>`;
  send(res, 200, {
    'content-type': MIME['.svg'],
    'cache-control': q.get('cc') || 'no-store',
    'access-control-allow-origin': '*',
    'timing-allow-origin': '*',
    'content-length': Buffer.byteLength(body),
  }, body);
}

/** A chunk of realistic-ish JSON rows. Big enough that parsing it costs real time. */
async function apiRows(req, res, url) {
  const q = url.searchParams;
  const n = Math.min(num(q, 'n', 20000), 400000);
  bump('rows');
  await sleep(num(q, 'delay', 0));

  const FIRST = ['ada', 'grace', 'alan', 'linus', 'barbara', 'edsger', 'donald', 'radia'];
  const LAST = ['lovelace', 'hopper', 'turing', 'torvalds', 'liskov', 'dijkstra', 'knuth', 'perlman'];
  const rows = new Array(n);
  for (let i = 0; i < n; i++) {
    rows[i] = {
      id: i,
      name: `${FIRST[i % FIRST.length]}.${LAST[(i * 7) % LAST.length]}`,
      team: `team-${i % 37}`,
      score: ((i * 2654435761) % 100000) / 100,
      active: i % 3 !== 0,
      tags: [`t${i % 11}`, `t${i % 19}`],
      updatedAt: new Date(1700000000000 + i * 1000).toISOString(),
    };
  }
  const body = JSON.stringify({ count: n, rows });
  const headers = {
    'content-type': MIME['.json'],
    'cache-control': q.get('cc') || 'no-store',
    'access-control-allow-origin': '*',
    'timing-allow-origin': '*',
  };
  if (bool(q, 'gzip', true) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    const gz = zlib.gzipSync(body);
    headers['content-encoding'] = 'gzip';
    headers['content-length'] = gz.length;
    return send(res, 200, headers, gz);
  }
  headers['content-length'] = Buffer.byteLength(body);
  send(res, 200, headers, body);
}

/** Binary-ish payload of a given size in MB, for storage/quota labs. */
async function apiBlob(req, res, url) {
  const q = url.searchParams;
  const mb = Math.min(num(q, 'mb', 1), 64);
  bump('blob');
  await sleep(num(q, 'delay', 0));
  const buf = Buffer.alloc(mb * 1024 * 1024, 'lab-payload-');
  send(res, 200, {
    'content-type': 'application/octet-stream',
    'cache-control': q.get('cc') || 'no-store',
    'access-control-allow-origin': '*',
    'content-length': buf.length,
  }, buf);
}

/** Fails on demand — for network-first fallbacks, stale-if-error, retry logic. */
async function apiFlaky(req, res, url) {
  const q = url.searchParams;
  const n = bump('flaky');
  await sleep(num(q, 'delay', 0));
  const failEvery = num(q, 'failEvery', 2);
  const forced = q.has('fail') && bool(q, 'fail');
  const shouldFail = forced || (failEvery > 0 && n % failEvery === 0);
  if (shouldFail) {
    const body = JSON.stringify({ error: 'upstream exploded', attempt: n });
    return send(res, num(q, 'errorStatus', 503), {
      'content-type': MIME['.json'],
      'cache-control': q.get('cc') || 'no-store',
      'access-control-allow-origin': '*',
      'content-length': Buffer.byteLength(body),
    }, body);
  }
  const body = JSON.stringify({ ok: true, attempt: n, servedAt: new Date().toISOString() });
  send(res, 200, {
    'content-type': MIME['.json'],
    'cache-control': q.get('cc') || 'no-store',
    'access-control-allow-origin': '*',
    'content-length': Buffer.byteLength(body),
  }, body);
}

/** Redirect chains: /api/redirect?n=3&to=/api/asset */
function apiRedirect(req, res, url) {
  const q = url.searchParams;
  const n = num(q, 'n', 1);
  bump('redirect');
  const to = n > 1
    ? `/api/redirect?n=${n - 1}&to=${encodeURIComponent(q.get('to') || '/api/asset?name=end&type=json')}`
    : (q.get('to') || '/api/asset?name=end&type=json');
  send(res, num(q, 'status', 302), {
    location: to,
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
    'content-length': 0,
  });
}

/**
 * /api/probe — a server-side `curl` you can call from a page.
 *
 * CORS hides the failing response from JavaScript by design, so the only honest way to debug
 * is to look at the raw exchange. This does that: it performs the request from Node (where no
 * same-origin policy applies) and returns the status and every response header as JSON.
 *
 *   /api/probe?url=http://localhost:8081/api/cors&method=OPTIONS
 *              &origin=http://localhost:8080&acrm=PUT&acrh=x-token
 *
 * Restricted to localhost targets — this is a lab, not an open proxy.
 */
async function apiProbe(req, res, url) {
  const q = url.searchParams;
  const target = q.get('url');
  if (!target) return json(res, { error: 'pass ?url=' }, 400);

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return json(res, { error: 'bad url' }, 400);
  }
  if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
    return json(res, { error: 'probe is restricted to localhost targets' }, 403);
  }

  const method = (q.get('method') || 'OPTIONS').toUpperCase();
  const headers = { origin: q.get('origin') || `http://localhost:${APP_PORT}` };
  if (q.has('acrm')) headers['access-control-request-method'] = q.get('acrm');
  if (q.has('acrh')) headers['access-control-request-headers'] = q.get('acrh');
  if (q.has('cookie')) headers.cookie = q.get('cookie');

  try {
    const r = await fetch(target, { method, headers, redirect: 'manual' });
    const text = await r.text();
    json(res, {
      request: { method, url: target, headers },
      status: r.status,
      statusText: r.statusText,
      headers: Object.fromEntries(r.headers.entries()),
      bodyPreview: text.slice(0, 400),
    });
  } catch (err) {
    json(res, { error: String(err) }, 502);
  }
}

// ---------------------------------------------------------------------------
// Introspection: did the request actually reach the server?
// ---------------------------------------------------------------------------

function apiStats(req, res) {
  json(res, {
    hits: Object.fromEntries([...hits].sort((a, b) => b[1] - a[1])),
    versions: Object.fromEntries([...versions].map(([k, v]) => [k, v])),
    recent: log.slice(-40),
  });
}

function apiReset(req, res) {
  hits.clear();
  versions.clear();
  log.length = 0;
  json(res, { ok: true, note: 'server counters cleared (the browser cache is untouched)' });
}

function apiBump(req, res, url) {
  const name = url.searchParams.get('name') || 'asset';
  const state = version(name);
  state.v++;
  state.mtime = new Date();
  json(res, { name, version: state.v, lastModified: state.mtime.toUTCString() });
}

function apiEcho(req, res, url) {
  if (req.method === 'OPTIONS') {
    return send(res, 204, { ...corsHeaders(url.searchParams, req, true), 'content-length': 0 });
  }
  json(res, {
    method: req.method,
    url: req.url,
    origin: req.headers.origin ?? null,
    headers: req.headers,
    receivedAt: new Date().toISOString(),
  }, 200, corsHeaders(url.searchParams, req, false));
}

// ---------------------------------------------------------------------------
// Static files
// ---------------------------------------------------------------------------

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const abs = path.join(ROOT, path.normalize(rel));
  if (!abs.startsWith(ROOT)) return send(res, 403, { 'content-type': 'text/plain' }, 'nope');

  let stat;
  try {
    stat = await fsp.stat(abs);
  } catch {
    return send(res, 404, { 'content-type': 'text/plain; charset=utf-8' }, `404 ${rel}\n`);
  }

  if (stat.isDirectory()) {
    const idx = path.join(abs, 'index.html');
    if (fs.existsSync(idx)) return streamFile(req, res, idx, url);
    const entries = await fsp.readdir(abs, { withFileTypes: true });
    const items = entries
      .filter((e) => !e.name.startsWith('.'))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      .map((e) => `<li><a href="${path.posix.join(rel, e.name)}${e.isDirectory() ? '/' : ''}">${e.name}${e.isDirectory() ? '/' : ''}</a></li>`)
      .join('\n');
    const body = `<!doctype html><meta charset="utf-8"><title>${rel}</title>
<style>body{background:#0d0d12;color:#e9e9f2;font:14px/1.7 ui-monospace,Menlo,monospace;padding:24px}
a{color:#7c9cff;text-decoration:none}a:hover{text-decoration:underline}ul{list-style:none;padding:0}</style>
<h1>${rel}</h1><ul>${items}</ul>`;
    return send(res, 200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' }, body);
  }

  return streamFile(req, res, abs, url);
}

function streamFile(req, res, abs, url) {
  const ext = path.extname(abs).toLowerCase();
  const headers = {
    'content-type': MIME[ext] || 'application/octet-stream',
    // Lab source files must never be cached, or you will spend an hour debugging
    // a fix you already made. The caching labs use /api/* for their cached assets.
    'cache-control': url.searchParams.get('cc') || 'no-store',
    'access-control-allow-origin': '*',
    'timing-allow-origin': '*',
    'cross-origin-resource-policy': 'cross-origin',
  };
  // `?isolate=1` turns on cross-origin isolation for that document, which is what
  // SharedArrayBuffer and high-resolution timers require. See web-workers lab 02.
  if (url.searchParams.has('isolate')) {
    headers['cross-origin-opener-policy'] = 'same-origin';
    headers['cross-origin-embedder-policy'] = 'require-corp';
  }
  // A service worker registered with a wider scope than its own directory needs this.
  if (ext === '.js' || ext === '.mjs') headers['service-worker-allowed'] = '/';
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(abs).pipe(res);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const ROUTES = {
  '/api/asset': apiAsset,
  '/api/cors': apiCors,
  '/api/echo': apiEcho,
  '/api/set-cookie': apiSetCookie,
  '/api/whoami': apiWhoami,
  '/api/script.js': (q, r, u) => apiSlow(q, r, u, 'js'),
  '/api/style.css': (q, r, u) => apiSlow(q, r, u, 'css'),
  '/api/image.svg': apiImage,
  '/api/rows': apiRows,
  '/api/blob': apiBlob,
  '/api/flaky': apiFlaky,
  '/api/redirect': apiRedirect,
  '/api/probe': apiProbe,
  '/api/stats': apiStats,
  '/api/reset': apiReset,
  '/api/bump': apiBump,
};

async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  log.push({ t: new Date().toISOString(), method: req.method, url: req.url, origin: req.headers.origin || null });
  if (log.length > 200) log.splice(0, log.length - 200);

  try {
    const route = ROUTES[url.pathname];
    if (route) return await route(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, { 'content-type': 'text/plain' }, 'method not allowed for static files\n');
    }
    return await serveStatic(req, res, url);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, { error: String(err) }, 500);
    else res.end();
  }
}

for (const port of [APP_PORT, ALT_PORT]) {
  http.createServer(handler).listen(port, () => {
    const role = port === APP_PORT ? 'app origin  ' : 'alt origin  ';
    console.log(`  ${role} http://localhost:${port}`);
  });
}
console.log('lab server up. ^C to stop.');
console.log(`  third origin http://127.0.0.1:${APP_PORT}  (same server, different host = different origin)`);
