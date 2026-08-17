// Lab 05 — Updates.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
let version = 1;
let waitingWorker = null;

async function show() {
  const reg = await navigator.serviceWorker.getRegistration('./');
  renderTable('#results', [
    { slot: 'installing', script: reg?.installing?.scriptURL.split('/').pop() ?? '—' },
    { slot: 'waiting', script: reg?.waiting?.scriptURL.split('/').pop() ?? '—' },
    { slot: 'active', script: reg?.active?.scriptURL.split('/').pop() ?? '—' },
    { slot: 'controller (this page)', script: navigator.serviceWorker.controller?.scriptURL.split('/').pop() ?? '(uncontrolled)' },
    { slot: 'caches', script: (await caches.keys()).join(', ') || '—' },
  ], { columns: ['slot', 'script'] });
}

async function register(v) {
  const reg = await navigator.serviceWorker.register(`./sw.js?v=${v}`, { scope: './' });
  log.ok(`registered sw.js?v=${v}`);
  reg.addEventListener('updatefound', () => {
    const nw = reg.installing;
    log.head(`updatefound — a new worker is installing`);
    nw.addEventListener('statechange', () => {
      log.line(`new worker: ${nw.state}`);
      if (nw.state === 'installed' && navigator.serviceWorker.controller) {
        // Installed + an existing controller = an UPDATE waiting, not a first install.
        waitingWorker = reg.waiting;
        $('#banner').style.display = 'block';
        log.bad('the new worker is WAITING — it will not take over until every tab is closed');
      }
      show();
    });
  });
  await show();
}

on('register', () => register(version));

on('deploy', async () => {
  version++;
  log.head(`— simulating a deploy: sw.js?v=${version} —`);
  await register(version);
  out.textContent =
    'The new worker installed and is now WAITING. The page is still controlled by the old one.\n\n' +
    'This is the default, and it is correct: swapping the worker under a running page would mean\n' +
    'the page\'s next fetch is served by a version that may disagree with the JavaScript already\n' +
    'executing. The browser refuses to do that to you.\n\n' +
    'The waiting worker activates only when EVERY tab controlled by the old one is closed. Note\n' +
    '"every tab" and note that a RELOAD IS NOT ENOUGH — during a reload the old page is still\n' +
    'controlling until the new one takes over, so the classic "I reloaded and it is still old" is\n' +
    'exactly this.\n\n' +
    'Your options are the three in the policy table. Press "the update policy".';
});

on('reload-now', () => {
  // The correct sequence: ask the waiting worker to activate, then reload when it takes control.
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  waitingWorker?.postMessage('SKIP_WAITING');
  log.ok('asked the waiting worker to skipWaiting(); reloading on controllerchange');
});
on('later', () => { $('#banner').style.display = 'none'; log.muted('user deferred the update'); });

on('check', async () => {
  const reg = await navigator.serviceWorker.getRegistration('./');
  await reg?.update();
  log.line('update() called — the browser re-fetched the script and compared it byte for byte');
  await show();
  out.textContent =
    'reg.update() forces a check. The browser fetches the script and compares it BYTE FOR BYTE with\n' +
    'the installed one; any difference makes it a new worker.\n\n' +
    'When the browser checks on its own:\n' +
    '  · on every navigation to an in-scope page\n' +
    '  · when the SW script is older than 24 hours (it is force-refreshed regardless of caching)\n' +
    '  · after any push or sync event\n\n' +
    'And the caching rule that has bitten every team once: the service worker SCRIPT ITSELF must not\n' +
    'be cached for long. Serve sw.js with Cache-Control: max-age=0 (or no-cache). Browsers now cap\n' +
    'it at 24 hours regardless, but a stale worker cached for a day is still a day of users on an\n' +
    'old version you cannot reach.\n\n' +
    'A good in-app policy: call update() on a timer (every 30–60 minutes) and on visibilitychange,\n' +
    'so a long-lived tab discovers a deploy without the user reloading.';
});

on('unregister', async () => {
  const reg = await navigator.serviceWorker.getRegistration('./');
  await reg?.unregister();
  for (const k of await caches.keys()) if (k.startsWith('updates-lab-')) await caches.delete(k);
  log.ok('unregistered and cleared caches');
  await show();
});

on('states', () => {
  renderTable('#results', [
    { state: 'installing', means: 'the install event is running (precaching)', next: 'installed, or redundant if install throws' },
    { state: 'installed / waiting', means: 'ready, but an older worker still controls pages', next: 'activating when all controlled tabs close, or on skipWaiting()' },
    { state: 'activating', means: 'the activate event is running (cache cleanup)', next: 'activated' },
    { state: 'activated', means: 'controlling new pages', next: 'redundant when replaced' },
    { state: 'redundant', means: 'replaced or failed', next: '—' },
  ], { columns: ['state', 'means', 'next'] });
  out.textContent =
    'The two calls that change the shape of this, and what each actually does:\n\n' +
    '  self.skipWaiting()      in install/message: activate immediately instead of waiting. It does\n' +
    '                          NOT reload the page — it swaps the controller under a page that is\n' +
    '                          already running. That is the danger.\n' +
    '  self.clients.claim()    in activate: take control of pages that were loaded BEFORE this\n' +
    '                          worker existed. Without it, the very first page load after\n' +
    '                          registration is uncontrolled, which is why "it does not work until I\n' +
    '                          reload" happens.\n\n' +
    'skipWaiting() without a reload is the source of the nastiest service worker bugs: the page is\n' +
    'running version 1\'s JavaScript, and its next lazy chunk request is served by version 2\'s\n' +
    'cache — which contains a differently-hashed file, so the import 404s and the route breaks. See\n' +
    'service-workers lab 05.\n\n' +
    'The safe pairing is always: skipWaiting ONLY in response to a user-approved message, and\n' +
    'reload the page on controllerchange (which is what the Reload button here does).';
});

on('skew', () => {
  renderTable('#results', [
    { skew: 'old page ⇄ new API', breaks: 'a field the page needs was removed', fix: 'additive changes only; never remove a field in the same release that stops using it' },
    { skew: 'new page ⇄ old API', breaks: 'a field the page needs does not exist yet', fix: 'deploy the API first, always' },
    { skew: 'old page ⇄ new lazy chunk', breaks: 'the chunk hash no longer exists → import() 404s', fix: 'keep the previous build\'s assets for days, and reload once on a chunk error' },
    { skew: 'old SW ⇄ new assets', breaks: 'the SW serves a stale index referencing missing hashes', fix: 'version the cache; delete old caches on activate' },
    { skew: 'two tabs, two versions', breaks: 'shared IndexedDB schemas disagree', fix: 'version migrations forward-compatible; a BroadcastChannel to coordinate' },
  ], { columns: ['skew', 'breaks', 'fix'] });
  out.textContent =
    'VERSION SKEW IS THE NORMAL STATE, not an edge case. At any moment after a deploy you have users\n' +
    'on the old bundle, users on the new one, and at least one person whose tab has been open since\n' +
    'last week.\n\n' +
    'The three rules that make it survivable:\n\n' +
    '1. DEPLOY THE API BEFORE THE CLIENT, and make API changes additive. Removing a field is a\n' +
    '   TWO-RELEASE operation: stop using it, ship, wait until the old clients are gone, then\n' +
    '   remove it.\n' +
    '2. KEEP OLD ASSETS. Do not delete the previous build from your CDN on deploy. A user mid-session\n' +
    '   will request a chunk from the build they loaded, and it must still be there. Keep several\n' +
    '   builds, for days.\n' +
    '3. HANDLE THE CHUNK-LOAD ERROR EXPLICITLY. When import() rejects, reload the page ONCE (guard\n' +
    '   with a sessionStorage flag so you cannot loop). The new HTML references the new hashes. This\n' +
    '   is the single highest-value error handler in a deployed SPA — see resilience lab 01.\n\n' +
    'And measure it: send the build version with every request or error report. "Which version was\n' +
    'this user on?" is the first question in half of all production investigations, and without the\n' +
    'field it is unanswerable.';
});

on('policy', () => {
  renderTable('#results', [
    { policy: 'wait (the default)', ux: 'the user gets the new version eventually', risk: 'a tab open for weeks never updates', use: 'low-stakes content' },
    { policy: 'skipWaiting() on install', ux: 'instant', risk: 'BREAKS RUNNING PAGES — mismatched chunks, mid-flight requests', use: 'almost never' },
    { policy: 'prompt the user, then skipWaiting + reload', ux: 'a banner they control', risk: 'they may dismiss it', use: 'the default recommendation' },
    { policy: 'auto-reload when idle / on navigation', ux: 'invisible', risk: 'losing unsaved work if you get "idle" wrong', use: 'good for read-heavy apps' },
    { policy: 'force after a deadline', ux: 'interruptive', risk: 'annoying', use: 'a security fix, or a breaking API change' },
  ], { columns: ['policy', 'ux', 'risk', 'use'] });
  out.textContent =
    'THE DEFAULT RECOMMENDATION: prompt, then skipWaiting + reload on controllerchange. It is a few\n' +
    'lines, it never breaks a running page, and the user is never surprised.\n\n' +
    'Make the prompt good:\n' +
    '  · a quiet banner, not a modal\n' +
    '  · say what it is ("A new version is available"), not what to do\n' +
    '  · a "Later" that actually means later — re-offer on the next navigation, do not nag\n' +
    '  · NEVER reload while the user has unsaved input. Check for a dirty form first, and defer.\n\n' +
    'And for the one case that overrides all of it — a security fix, or a client that is now\n' +
    'incompatible with the API — you need a KILL SWITCH: a version endpoint the app polls, which\n' +
    'can tell it "you are too old, reload now". Build it before you need it, because the moment you\n' +
    'need it is the moment you cannot ship anything to reach those users. Service-workers lab 05\n' +
    'builds the service-worker half of that.';
});

show();
