// Lab 05 — Quotas & eviction.

import { $, on, Log, renderTable, fmt, storageEstimate } from '/shared/lab-ui.js';
import { openDB, deleteDB, putMany } from '/browser-storage/idb.js';

const log = new Log('#log');
const out = $('out');

async function paintBar() {
  const e = await storageEstimate();
  if (!e) return null;
  $('#bar i').style.width = `${Math.min(e.pct * 100, 100)}%`;
  $('#bar b').textContent = `${e.usageFmt} of ${e.quotaFmt} (${(e.pct * 100).toFixed(2)}%)`;
  return e;
}

on('estimate', async () => {
  const e = await paintBar();
  if (!e) return log.bad('navigator.storage.estimate() not supported here');
  log.head('— navigator.storage.estimate() —');
  log.line(`usage: ${e.usageFmt}   quota: ${e.quotaFmt}   (${(e.pct * 100).toFixed(3)}%)`, 'macro');
  if (e.details) {
    renderTable('#results', Object.entries(e.details).map(([k, v]) => ({
      api: k, bytes: v, human: fmt.bytes(v),
    })), { columns: ['api', 'human', 'bytes'] });
    log.muted('usageDetails is Chrome-only and is the only way to see WHICH api grew.');
  }
  out.textContent =
    `Quota here: ${e.quotaFmt}.\n\n` +
    'What that number is made of:\n' +
    '  • a fraction of FREE DISK SPACE, not a fixed size — Chrome allows an origin up to ~60% of\n' +
    '    the total pool, which is itself a share of free space. It changes as the disk fills.\n' +
    '  • shared across IndexedDB, Cache Storage, localStorage, OPFS, and service worker\n' +
    '    registrations, for this origin\n' +
    '  • partitioned by top-level site: an iframe of your site on someone else\'s page gets a\n' +
    '    different bucket than your own top-level page\n\n' +
    'Both numbers are deliberately imprecise (padded/rounded) to avoid leaking disk-usage\n' +
    'information cross-origin. Do not build logic that needs exact bytes.';
});

on('persist', async () => {
  if (!navigator.storage?.persist) return log.bad('not supported');
  const before = await navigator.storage.persisted();
  const granted = await navigator.storage.persist();
  log.line(`persisted: ${before} → ${granted}`, granted ? 'good' : 'bad');
  out.textContent =
    (granted
      ? 'Granted. This origin is now exempt from automatic eviction under storage pressure — the\n' +
        'browser will not clear it to make room, and only the user can.\n\n'
      : 'Denied — and note it fails silently, returning false rather than throwing.\n\n') +
    'How the decision is made (Chrome): granted automatically if the site is installed as a PWA,\n' +
    'has high engagement, has been granted notification permission, or is bookmarked. Firefox\n' +
    'prompts the user. Safari does not implement it meaningfully.\n\n' +
    'What it does NOT do: exempt you from Safari\'s 7-day rule (all script-writable storage is\n' +
    'cleared after 7 days without interaction with the site), give you a bigger quota, or protect\n' +
    'you from the user clearing site data. It is insurance against pressure eviction, nothing else.\n\n' +
    'Design rule: NEVER treat browser storage as durable. Anything the user would be upset to\n' +
    'lose must be synced to a server. Persistent storage moves the odds; it does not change the\n' +
    'guarantee, which is none.';
});

on('persisted', async () => {
  log.line(`navigator.storage.persisted() → ${await navigator.storage?.persisted?.()}`, 'macro');
});

on('buckets', () => {
  log.head('— the rules that actually decide what survives —');
  const rules = [
    ['Chrome / Edge', 'Best-effort storage is evicted LRU by origin when the disk is under pressure. Persistent origins are exempt until nothing else is left.'],
    ['Firefox', 'Similar LRU eviction; persist() shows a user prompt.'],
    ['Safari', 'ALL script-writable storage (IndexedDB, Cache, localStorage, service workers) is deleted after 7 days of no user interaction with the site. persist() does not exempt you.'],
    ['Private / incognito', 'Quota is small (often a few hundred MB or less) and everything is destroyed when the session ends. Some APIs behave differently or throw.'],
    ['All browsers', 'Eviction is per ORIGIN and takes everything: your data, your caches, your session. It is not a partial cleanup.'],
  ];
  renderTable('#results', rules.map(([browser, rule]) => ({ browser, rule })), { columns: ['browser', 'rule'] });
  out.textContent =
    'The Safari rule is the one that changes product decisions: a user who visits your site every\n' +
    'other week has an empty database every single time. Anything you cached is gone, any\n' +
    '"offline draft" is gone, and any client-side session is gone.\n\n' +
    'Consequences for design:\n' +
    '  • treat local storage as a CACHE, never as the source of truth\n' +
    '  • make first-run-after-eviction fast and correct, and test it (Application → Clear site\n' +
    '    data, then reload — that is your most important test case, and almost nobody runs it)\n' +
    '  • never store the only copy of user-generated content locally without an explicit,\n' +
    '    visible sync state';
});

on('fill', async () => {
  const targetMb = Number($('mb').value);
  log.head(`— writing up to ${targetMb}MB into IndexedDB —`);
  const db = await openDB('lab05-fill', 1, (d) => {
    if (!d.objectStoreNames.contains('chunks')) d.createObjectStore('chunks', { keyPath: 'id' });
  });

  let written = 0;
  const CHUNK_MB = 8;
  try {
    for (let i = 0; written < targetMb; i++) {
      const chunk = { id: i, data: new Uint8Array(CHUNK_MB * 1048576).fill(i % 255) };
      await putMany(db, 'chunks', [chunk]);
      written += CHUNK_MB;
      if (i % 4 === 0) {
        const e = await paintBar();
        log.line(`${written}MB written — usage ${e.usageFmt} of ${e.quotaFmt}`, 'macro');
      }
    }
    log.ok(`wrote ${written}MB without hitting the quota`);
  } catch (err) {
    log.bad(`${err.name} after ${written}MB: ${err.message}`);
    out.textContent =
      'QuotaExceededError. Things to notice about how it arrived:\n\n' +
      '  • it is a rejected promise from a single put — the transaction aborts, so everything\n' +
      '    else in that transaction rolls back too\n' +
      '  • it can happen at ANY write, including a background sync or a service worker cache\n' +
      '    update, where nobody is catching it\n' +
      '  • estimate() told you the quota, but the real limit depends on free disk at that moment\n' +
      '    and the browser may refuse well before the reported quota\n\n' +
      'Every write path in a storage-heavy app needs a quota strategy: catch it, evict something,\n' +
      'retry once, and if it still fails, degrade to network-only and tell the user something\n' +
      'true.';
  }
  db.close();
  await paintBar();
});

on('opaque', async () => {
  log.head('— opaque response padding —');
  const before = await storageEstimate();
  const cache = await caches.open('lab05-opaque');
  for (let i = 0; i < 3; i++) {
    const res = await fetch(`http://localhost:8081/api/asset?name=pad${i}&type=json&size=1000`, { mode: 'no-cors' });
    await cache.put(`/opaque/${i}`, res);
  }
  const after = await storageEstimate();
  const delta = after.usage - before.usage;
  log.line(`3 opaque responses of ~1KB each grew usage by ${fmt.bytes(delta)}`, delta > 1e6 ? 'bad' : 'macro');
  await paintBar();
  out.textContent =
    `3 × ~1KB of real content cost ${fmt.bytes(delta)} of quota.\n\n` +
    'Opaque responses (mode: "no-cors") are padded — Chrome charges a fixed amount on the order of\n' +
    '7MB per entry — because reporting the true size would leak cross-origin information.\n\n' +
    'So a service worker precaching 50 third-party assets opaquely can "use" 350MB of a quota it\n' +
    'does not control, and be evicted for it. Fetch cross-origin assets in CORS mode where you\n' +
    'can (crossorigin attribute + a server that allows it), and never precache opaque responses\n' +
    'in bulk.';
});

on('cleanup', async () => {
  await deleteDB('lab05-fill').catch(() => {});
  for (const k of await caches.keys()) if (k.startsWith('lab05')) await caches.delete(k);
  log.ok('deleted this lab\'s database and caches');
  await paintBar();
});

paintBar();
