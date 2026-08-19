/**
 * Drill 13 — find the leak.
 *
 * Four leaks. Each one is three lines, each one looks reasonable in review, and each one is a
 * pattern you will meet in a real codebase.
 *
 *   createService(bus) -> { handle(req), stats(), close() }
 *
 *     handle({ id, size })   -> { id, checksum }   ; must be correct, and cached by id
 *     stats()                -> { hits, misses, cacheSize }
 *     close()                -> release everything
 *
 * How to find them yourself, rather than by reading the comments:
 *
 *   node --expose-gc --inspect node-runtime/drills/run.mjs 13
 *   then chrome://inspect -> Memory -> take a heap snapshot, run the load, take another,
 *   and use "Comparison" to see what was ALLOCATED between the two and never freed.
 *
 * The three columns that matter in a snapshot comparison: `# New`, `# Deleted`, `# Delta`.
 * Anything with a large positive delta that you expected to be temporary is your leak. Then
 * click it and read the RETAINERS panel — the chain of references keeping it alive. The leak is
 * never the object; it is always the retainer.
 *
 * `process.memoryUsage()` tells you THAT you are leaking. A heap snapshot tells you WHAT. Only
 * the retainer chain tells you WHY.
 */

import { EventEmitter } from 'node:events';

export function createService(bus) {
  const cache = new Map();
  const auditLog = [];
  let hits = 0, misses = 0;

  const compute = (req) => {
    const buffer = Buffer.alloc(req.size, 1);
    const n = Number(req.id.split('-')[1]) || 0;
    return { id: req.id, checksum: (n % 50) * req.size, buffer };
  };

  return {
    async handle(req) {
      // Every request subscribes. Nothing ever unsubscribes.
      bus.on('shutdown', () => { cache.delete(req.id); });

      // Every request schedules. Nothing ever clears.
      setTimeout(() => { /* refresh the entry one day */ }, 60_000);

      if (cache.has(req.id)) {
        hits++;
        return cache.get(req.id);
      }
      misses++;

      const result = compute(req);
      // An unbounded Map keyed by something unbounded.
      cache.set(req.id, result);

      // A small record that keeps a large buffer alive through `result`.
      auditLog.push({ at: Date.now(), id: req.id, result });

      return { id: result.id, checksum: result.checksum };
    },

    stats() {
      return { hits, misses, cacheSize: cache.size };
    },

    async close() {},
  };
}
