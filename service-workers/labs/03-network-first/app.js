// Lab 03 — network first (page side).

import { $, on, Log, renderTable, fmt } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
const rows = [];

navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type === 'log') log.line(`[sw] ${e.data.msg}`,
    /FAILED|too slow/.test(e.data.msg) ? 'bad' : 'micro');
  if (e.data?.type === 'caches') {
    $('#caches').textContent = Object.entries(e.data.detail)
      .map(([k, urls]) => `${k}\n${urls.map((u) => `  ${u}`).join('\n')}`).join('\n\n') || '(empty)';
  }
});

async function register(timeout) {
  const reg = await navigator.serviceWorker.register(`sw.js?timeout=${timeout}`, { scope: './' });
  await navigator.serviceWorker.ready;
  log.ok(`registered with a ${timeout}ms network timeout`);
  if (!navigator.serviceWorker.controller) log.muted('reload once so this page is controlled');
  return reg;
}

on('register', () => register(1200).catch((e) => log.bad(e.message)));
on('register500', () => register(500).catch((e) => log.bad(e.message)));

on('inspect', () => navigator.serviceWorker.controller?.postMessage('inspect'));

on('unregister', async () => {
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  for (const k of await caches.keys()) await caches.delete(k);
  log.bad('unregistered and cleared');
});

// ---------------------------------------------------------------------------

async function probe(label, url) {
  const t0 = performance.now();
  try {
    const res = await fetch(url);
    const body = await res.text();
    const wall = performance.now() - t0;
    const source = res.headers.get('x-sw-source') || '(not intercepted)';
    rows.push({
      request: label,
      'ms': Math.round(wall),
      status: res.status,
      'served by': source,
      _servedClass: source.includes('network') ? 'ok' : source.includes('offline') ? 'no' : 'meh',
    });
    renderTable('#results', rows, { columns: ['request', 'ms', 'status', 'served by'] });
    log.line(`${label.padEnd(26)} ${fmt.ms(wall).padStart(8)}  ${res.status}  via ${source}`,
      source.includes('network') ? 'good' : 'macro');
  } catch (err) {
    log.bad(`${label}: ${err.message}`);
  }
}

on('fetchData', () => probe(`/api/data (${$('delay').value}ms)`,
  `/api/asset?name=nf-data&type=json&delay=${$('delay').value}&cc=no-store`));

on('fetchSlow', async () => {
  await probe('/api/data (3000ms server)', '/api/asset?name=nf-data&type=json&delay=3000&cc=no-store');
  out.textContent =
    'The server took 3 seconds. With a 1200ms timeout the worker gave up waiting and served the\n' +
    'cached copy — while letting the real request finish in the background so the cache is fresh\n' +
    'for next time. The user saw data in ~1.2s instead of 3s.\n\n' +
    'Note what it did NOT do: abort the network request. A slow response is still useful; you just\n' +
    'do not make the user wait for it. Aborting would throw away work that is already paid for.\n\n' +
    'Choosing the timeout: it should be longer than your p75 response time and shorter than the\n' +
    'point where users give up (~2s for content, less for interactions). 1–3s is the usual range.\n' +
    'Too short and everyone gets stale data on a normal connection; too long and it never helps.';
});

on('fetchDead', async () => {
  await probe('a dead endpoint', 'http://localhost:9999/api/nope');
  out.textContent =
    'A connection error, not a slow one. The worker caught it and served the cache if it had one,\n' +
    'or a synthesised 503 JSON body if it did not.\n\n' +
    'That synthesised response is worth dwelling on: your fetch handler can return ANYTHING. A\n' +
    'well-formed error your app already knows how to render beats a network exception every time,\n' +
    'because your UI never has to have a special case for "the fetch threw".';
});

on('clear', () => { log.clear(); rows.length = 0; $('#results').textContent = ''; });

if (navigator.serviceWorker?.controller) {
  log.ok('page is controlled');
  navigator.serviceWorker.controller.postMessage('inspect');
}
