// Lab 03 — writing from a worker.
//
// IndexedDB is available in workers with the same API. What moves off the main thread is the
// structured clone of every value — which is the part of an IDB write that actually blocks you.

import { openDB, putMany } from '/browser-storage/idb.js';

self.onmessage = async (e) => {
  const { n, indexes } = e.data;
  const t0 = performance.now();

  const db = await openDB('lab03', 1 + indexes, (d, oldVersion) => {
    if (!d.objectStoreNames.contains('rows')) {
      const store = d.createObjectStore('rows', { keyPath: 'id' });
      for (let i = 0; i < indexes; i++) store.createIndex(`idx${i}`, `f${i}`);
    }
  });

  const rows = Array.from({ length: n }, (_, i) => ({
    id: i,
    f0: `team-${i % 37}`,
    f1: (i * 2654435761) % 1000,
    f2: new Date(1600000000000 + i * 1000),
    f3: `name-${i}`,
    f4: i % 7,
    f5: `${i}`.padStart(9, '0'),
    payload: 'x'.repeat(120),
  }));
  const built = performance.now();

  await putMany(db, 'rows', rows);
  db.close();

  self.postMessage({ build: built - t0, write: performance.now() - built, total: performance.now() - t0 });
};
