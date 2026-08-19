import { EventEmitter } from 'node:events';

export const title = 'Find the leak';
export const task = `A service that works, passes its tests, and grows by about a megabyte a
minute until the pod is OOM-killed and restarted — which resets the graph, which is why nobody
looks at it.

There are FOUR leaks in solution.mjs. Every one of them is a real pattern:

  · something stored per request in a structure with no bound
  · something subscribed per request and never unsubscribed
  · something scheduled per request and never cleared
  · something small that keeps something large alive

Fix all four. The service must still WORK — and the cache must still be a cache, so deleting it
is not a fix: the checks measure the hit rate too.`;
export const passIf = 'the heap is flat after 30,000 requests, no listeners or timers accumulate, and the cache still hits';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mb = (n) => n / 1024 / 1024;

export async function check(s) {
  if (typeof s.createService !== 'function') return [{ check: 'exports createService(bus)', actual: 'missing', pass: false }];
  const out = [];

  const bus = new EventEmitter();
  bus.setMaxListeners(0);                    // so the drill measures rather than warns
  const svc = s.createService(bus);

  const listenersBefore = bus.eventNames().reduce((n, e) => n + bus.listenerCount(e), 0);
  const timersBefore = process.getActiveResourcesInfo().filter((r) => r === 'Timeout' || r === 'Immediate').length;

  // Warm up, then take the baseline — so the measurement is of GROWTH, not of startup.
  for (let i = 0; i < 2000; i++) await svc.handle({ id: `warm-${i % 50}`, size: 4096 });
  globalThis.gc?.(); globalThis.gc?.();
  await sleep(50);
  const heapBefore = process.memoryUsage().heapUsed;

  let correct = 0;
  const N = 30_000;
  for (let i = 0; i < N; i++) {
    const r = await svc.handle({ id: `req-${i}`, size: 4096 });
    if (r && r.id === `req-${i}` && r.checksum === (i % 50) * 4096) correct++;
  }

  globalThis.gc?.(); globalThis.gc?.();
  await sleep(50);
  const heapAfter = process.memoryUsage().heapUsed;
  const grewMB = mb(heapAfter - heapBefore);

  const listenersAfter = bus.eventNames().reduce((n, e) => n + bus.listenerCount(e), 0);
  const timersAfter = process.getActiveResourcesInfo().filter((r) => r === 'Timeout' || r === 'Immediate').length;

  // The cache must still be a cache: replay 2,000 requests over 50 distinct keys.
  const before = svc.stats?.() ?? {};
  for (let i = 0; i < 2000; i++) await svc.handle({ id: `hot-${i % 50}`, size: 4096 });
  const after = svc.stats?.() ?? {};
  const hits = (after.hits ?? 0) - (before.hits ?? 0);

  out.push({ check: `all ${N.toLocaleString()} requests answered correctly`, actual: `${correct.toLocaleString()}/${N.toLocaleString()}`, pass: correct === N });
  out.push({ check: 'heap grew less than 8MB over 30,000 requests', actual: `${grewMB.toFixed(1)}MB`, pass: grewMB < 8 });
  out.push({ check: 'no listeners accumulated on the bus', actual: `${listenersBefore} -> ${listenersAfter}`, pass: listenersAfter <= listenersBefore + 2 });
  out.push({ check: 'no timers accumulated', actual: `${timersBefore} -> ${timersAfter}`, pass: timersAfter <= timersBefore + 2 });
  out.push({ check: 'the cache is still a cache (>1500 hits on 2,000 replayed requests)', actual: `${hits} hits`, pass: hits > 1500 });

  // ...and bounded. 50,000 distinct keys must not mean 50,000 entries.
  for (let i = 0; i < 50_000; i++) await svc.handle({ id: `flood-${i}`, size: 64 });
  const size = svc.stats?.().cacheSize;
  out.push({
    check: 'the cache is BOUNDED (50,000 distinct keys do not become 50,000 entries)',
    actual: size === undefined ? 'stats().cacheSize not reported' : `${size} entries`,
    pass: typeof size === 'number' && size > 0 && size <= 2000,
  });

  await svc.close?.();
  return out;
}
