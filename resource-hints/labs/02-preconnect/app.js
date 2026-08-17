// Lab 02 — preconnect & DNS.

import { $, on, Log, renderTable, fmt } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
const rows = [];

/**
 * Every phase of a resource fetch, from PerformanceResourceTiming. The gaps between these
 * timestamps are exactly what the Network panel draws.
 */
function phases(e) {
  return {
    resource: e.name.split('?')[0].split('/').slice(-1)[0] + (e.name.includes('8081') ? ' (:8081)' : ''),
    queued: Math.round(e.domainLookupStart - e.startTime),
    dns: Math.round(e.domainLookupEnd - e.domainLookupStart),
    tcp: Math.round((e.secureConnectionStart || e.connectEnd) - e.connectStart),
    tls: e.secureConnectionStart ? Math.round(e.connectEnd - e.secureConnectionStart) : 0,
    ttfb: Math.round(e.responseStart - e.requestStart),
    download: Math.round(e.responseEnd - e.responseStart),
    total: Math.round(e.duration),
  };
}

function entryFor(url) {
  const all = performance.getEntriesByType('resource').filter((e) => e.name === url);
  return all[all.length - 1];
}

async function measure(label, url) {
  const t0 = performance.now();
  await fetch(url, { cache: 'no-store' }).then((r) => r.text());
  const wall = performance.now() - t0;
  await new Promise((r) => setTimeout(r, 30));
  const e = entryFor(url);
  if (!e) { log.bad('no resource timing entry (cross-origin without Timing-Allow-Origin?)'); return; }
  const p = phases(e);
  rows.push({ scenario: label, ...p, wall: Math.round(wall) });
  renderTable('#results', rows, {
    columns: ['scenario', 'resource', 'queued', 'dns', 'tcp', 'tls', 'ttfb', 'download', 'total'],
  });
  log.line(`${label.padEnd(28)} dns ${String(p.dns).padStart(4)}ms  tcp ${String(p.tcp).padStart(4)}ms  ` +
    `tls ${String(p.tls).padStart(4)}ms  ttfb ${String(p.ttfb).padStart(4)}ms  total ${p.total}ms`,
    p.dns + p.tcp + p.tls > 20 ? 'macro' : 'good');
  return p;
}

// A fresh URL each time so nothing is cached; the connection, however, is reused.
const alt = (n) => `http://localhost:8081/api/asset?name=pc${n}&type=json&cc=no-store&t=${Math.random()}`;

on('cold', async () => {
  log.head('— first request to localhost:8081 in this page —');
  const p = await measure('cold (new origin)', alt(1));
  out.textContent = p && p.dns + p.tcp + p.tls > 20
    ? `Connection setup cost ${p.dns + p.tcp + p.tls}ms before the request could even be sent.\n` +
      'That is what preconnect removes from the critical path — by paying it earlier, in parallel.'
    : 'Connection setup measured as ~0ms. Either you are not throttling, or the connection was\n' +
      'already open. Turn on Slow 4G in DevTools → Network and reload the page before measuring —\n' +
      'localhost with no throttling has no DNS, no TLS and a sub-millisecond TCP handshake, which\n' +
      'is exactly why local testing makes preconnect look worthless.';
});

on('warm', async () => {
  log.head('— second request to the same origin —');
  await measure('warm (socket reused)', alt(2));
  out.textContent =
    'DNS and connect are now zero: the socket is open and being reused. This is the whole point —\n' +
    'connection cost is per ORIGIN, paid once, and everything after it is free.\n\n' +
    'Consequences:\n' +
    '  • adding a third origin to a page costs a full handshake, even for one 2KB file\n' +
    '  • self-hosting a font is often faster than a CDN, because the CDN is a new origin\n' +
    '  • connection reuse is why HTTP/2 on one origin beats sharding across four';
});

on('phases', () => {
  const all = performance.getEntriesByType('resource').slice(-25).map(phases);
  renderTable('#results', all, {
    columns: ['resource', 'queued', 'dns', 'tcp', 'tls', 'ttfb', 'download', 'total'],
  });
  out.textContent =
    'Read left to right: queued → dns → tcp → tls → ttfb → download.\n' +
    '  a big "queued" number   → contention (connection limit) or low priority\n' +
    '  big dns/tcp/tls         → a new origin; candidate for preconnect\n' +
    '  big ttfb                → the server is thinking; hints will not help you\n' +
    '  big download            → too many bytes; hints will not help you either\n\n' +
    'Hints only ever move the first two categories. If your problem is TTFB, no amount of\n' +
    'preloading will fix it, and that is the most common reason a hint "does nothing".';
});

on('real', async () => {
  const origin = $('origin').value.replace(/\/$/, '');
  const url = `${origin}/npm/lodash@4.17.21/package.json?cb=${Math.random()}`;
  log.head(`— ${origin} —`);
  try {
    await measure(`real origin: ${new URL(origin).host}`, url);
    log.muted('If dns/tcp/tls read as 0 for a cross-origin resource, the server did not send ' +
      'Timing-Allow-Origin — the phase data is hidden from you, not absent. Only `duration` is ' +
      'reliable there.');
  } catch (err) {
    log.bad(`${err.message} — is this machine online? Is the path valid for that host?`);
  }
});

on('clear', () => { rows.length = 0; $('results').textContent = ''; log.clear(); });
