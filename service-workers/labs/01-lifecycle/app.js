// Lab 01 — Service worker lifecycle (page side).

import { $, on, Log } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

if (!('serviceWorker' in navigator)) {
  log.bad('No service worker support in this browser (or you are on http from a non-localhost host — ' +
    'service workers require a secure context).');
}

// ---------------------------------------------------------------------------
// State display
// ---------------------------------------------------------------------------

function card(id, text, on_) {
  const el = $(`#s-${id}`);
  el.querySelector('.big').textContent = text;
  el.classList.toggle('on', Boolean(on_));
}

async function refresh() {
  const reg = await navigator.serviceWorker.getRegistration();
  card('installing', reg?.installing ? version(reg.installing) : '–', reg?.installing);
  card('waiting', reg?.waiting ? version(reg.waiting) : '–', reg?.waiting);
  card('active', reg?.active ? version(reg.active) : '–', reg?.active);
  card('controlled',
    navigator.serviceWorker.controller ? `controlled by ${version(navigator.serviceWorker.controller)}` : 'NOT controlled',
    navigator.serviceWorker.controller);
}

const version = (worker) => `v${new URL(worker.scriptURL).searchParams.get('v') || '1'}`;

function watch(reg) {
  const track = (worker, label) => {
    if (!worker) return;
    log.line(`${label}: ${worker.state}`, 'macro');
    worker.addEventListener('statechange', () => {
      log.line(`${label} → ${worker.state}`,
        worker.state === 'activated' ? 'good' : worker.state === 'installed' ? 'macro' : 'muted');
      refresh();
    });
  };
  track(reg.installing, `${version(reg.installing || reg.active)} installing`);
  reg.addEventListener('updatefound', () => {
    log.bad('updatefound — a new worker is installing');
    track(reg.installing, `${version(reg.installing)} installing`);
  });
  refresh();
}

navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type === 'log') log.line(`[sw v${e.data.version}] ${e.data.msg}`, 'micro');
  if (e.data?.type === 'version') log.ok(`active worker says: v${e.data.version}`);
});

navigator.serviceWorker?.addEventListener('controllerchange', () => {
  log.ok('controllerchange — this page is now controlled by a different worker');
  refresh();
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function register(url) {
  log.head(`— navigator.serviceWorker.register('${url}') —`);
  const reg = await navigator.serviceWorker.register(url, { scope: './' });
  log.ok(`registered, scope: ${reg.scope}`);
  watch(reg);

  if (!navigator.serviceWorker.controller) {
    out.textContent =
      'Registered — and note the fourth card: this page is NOT controlled.\n\n' +
      'A service worker takes control at the next navigation, because the page you are on was\n' +
      'loaded without one and mixing controlled and uncontrolled resources within a single page\n' +
      'would be incoherent. Reload to be controlled, or call clients.claim().\n\n' +
      'This is the number one "my service worker does nothing" report.';
  }
  return reg;
}

on('register', () => register('sw.js').catch((e) => log.bad(e.message)));

on('deploy', async () => {
  await register('sw.js?v=2');
  out.textContent =
    'A different script URL (and different bytes) = a new worker. Watch the cards:\n\n' +
    '  v2 goes to INSTALLING, finishes, and then sits in WAITING.\n\n' +
    'It will not activate while this page is still controlled by v1. That is the whole point: you\n' +
    'never get a page with half its assets from v1 and half from v2.\n\n' +
    'Three ways out: close every tab in scope; call skipWaiting(); or ask the user ("a new\n' +
    'version is available — reload"), which is what a serious app does.';
});

on('deploy3', () => register('sw.js?v=3').catch((e) => log.bad(e.message)));

on('update', async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return log.bad('nothing registered');
  log.head('— registration.update() —');
  await reg.update();
  log.muted('update() re-fetches the script and compares it byte-for-byte. Identical bytes = ' +
    'nothing happens. Browsers also do this automatically on navigation and at most every 24h.');
  refresh();
});

on('skip', async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  const worker = reg?.waiting || reg?.installing;
  if (!worker) return log.bad('no waiting worker — deploy a new version first');
  worker.postMessage('skipWaiting');
  out.textContent =
    'skipWaiting() lets the new worker activate immediately, replacing the old one under a page\n' +
    'that is still running old code.\n\n' +
    'Whether that is safe depends entirely on your app: if the running page lazy-loads a chunk\n' +
    'the new worker no longer has cached, or expects an API shape the new worker rewrites, you\n' +
    'have broken a live session. Combine it with a reload (via controllerchange) or with an\n' +
    'explicit user prompt.';
});

on('claim', async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  (reg?.active || reg?.waiting)?.postMessage('claim');
  log.muted('clients.claim() makes the active worker take control of already-open pages. Usually ' +
    'called in the activate handler so the very first page load is controlled.');
});

on('fetchTest', async () => {
  log.head('— fetch through the (maybe) controlling worker —');
  await fetch(`/api/asset?name=lifecycle&type=json&t=${Date.now()}`).then((r) => r.text());
  log.line(navigator.serviceWorker.controller
    ? 'page is controlled — the SW fetch handler ran (see its log line above)'
    : 'page is NOT controlled — the request never touched the service worker',
    navigator.serviceWorker.controller ? 'good' : 'bad');
});

on('who', async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  reg?.active?.postMessage('version');
});

on('unregister', async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  for (const r of regs) await r.unregister();
  for (const k of await caches.keys()) await caches.delete(k);
  log.bad(`unregistered ${regs.length} registration(s) and cleared all caches`);
  log.muted('Note: unregistering does NOT clear Cache Storage — that second loop did. In DevTools, ' +
    'Application → Storage → Clear site data is the reliable full reset.');
  refresh();
});

on('clear', () => log.clear());

refresh();
setInterval(refresh, 1000);
