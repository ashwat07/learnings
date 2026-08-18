/**
 * Lab 02 — Cache stampede.
 *
 *   node caching-and-queues/labs/02-stampede/lab.mjs
 *
 * One key expires. 200 requests arrive in the same millisecond. How many of them hit your database?
 * The answer for a naive cache-aside is 200, and that is how a cache turns into an outage.
 */

import { redis, newRedis, makeOrigin, concurrently, sleep } from '../../../lib/redis.mjs';
import { rule, note, good, bad, table } from '../../../lib/db.mjs';

const KEY = 'lab:stampede:user:1';
const N = 200;
const origin = makeOrigin({ latencyMs: 150 });
const clear = () => redis.del(KEY, `${KEY}:lock`, `${KEY}:fresh`);

// ---------------------------------------------------------------------------
// 1. Naive cache-aside — correct, and catastrophic under concurrency.
// ---------------------------------------------------------------------------
async function naive() {
  const hit = await redis.get(KEY);
  if (hit) return JSON.parse(hit);
  const value = await origin.fetch(KEY);            // every misser does this
  await redis.set(KEY, JSON.stringify(value), 'EX', 30);
  return value;
}

// ---------------------------------------------------------------------------
// 2. A lock — one worker recomputes, the rest wait for it.
// ---------------------------------------------------------------------------
async function locked(client) {
  const hit = await client.get(KEY);
  if (hit) return JSON.parse(hit);

  // SET NX is the whole lock. The TTL is a LEASE: if the holder crashes, the lock expires and
  // someone else takes over, rather than the key being wedged forever.
  const token = crypto.randomUUID();
  const got = await client.set(`${KEY}:lock`, token, 'NX', 'PX', 5000);
  if (got) {
    try {
      const value = await origin.fetch(KEY);
      await client.set(KEY, JSON.stringify(value), 'EX', 30);
      return value;
    } finally {
      // Release ONLY if we still hold it — a naive DEL can delete someone else's lock after
      // your lease expired. This compare-and-delete must be atomic, hence Lua.
      await client.eval(
        `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
        1, `${KEY}:lock`, token);
    }
  }
  // Did not get the lock: wait briefly for the winner to fill the cache.
  for (let i = 0; i < 50; i++) {
    await sleep(20);
    const v = await client.get(KEY);
    if (v) return JSON.parse(v);
  }
  return origin.fetch(KEY);                          // last resort, and it should be rare
}

// ---------------------------------------------------------------------------
// 3. Stale-while-revalidate — nobody waits at all.
// ---------------------------------------------------------------------------
async function swr(client) {
  const [value, fresh] = await client.mget(KEY, `${KEY}:fresh`);
  if (value && fresh) return JSON.parse(value);      // fresh: serve it

  if (value) {
    // Stale but usable. Serve it NOW and refresh in the background — but only one refresher.
    const got = await client.set(`${KEY}:lock`, '1', 'NX', 'PX', 5000);
    if (got) {
      (async () => {
        const next = await origin.fetch(KEY);
        await client.set(KEY, JSON.stringify(next), 'EX', 300);
        await client.set(`${KEY}:fresh`, '1', 'EX', 30);
        await client.del(`${KEY}:lock`);
      })();
    }
    return JSON.parse(value);
  }

  // Cold start: nothing cached at all. Fall back to the lock.
  return locked(client);
}

// ---------------------------------------------------------------------------
const clients = Array.from({ length: 20 }, () => newRedis());
const pick = (i) => clients[i % clients.length];
const results = [];

for (const [label, fn] of [
  ['naive cache-aside', () => naive()],
  ['lock (SET NX + lease)', (i) => locked(pick(i))],
  ['stale-while-revalidate', (i) => swr(pick(i))],
]) {
  await clear();
  origin.reset();
  if (label.startsWith('stale')) {
    // Prime it, then let it go stale — the case SWR exists for.
    await swr(clients[0]);
    await redis.del(`${KEY}:fresh`);
    await redis.del(`${KEY}:lock`);
    origin.reset();
  }
  const { ms } = await concurrently(N, fn);
  await sleep(200);                                   // let any background refresh land
  results.push({
    strategy: label,
    'origin calls': origin.calls,
    'slowest request': `${ms.toFixed(0)}ms`,
    amplification: `${origin.calls}/${N}`,
  });
}

rule(`${N} concurrent requests for one expired key`);
table(results, ['strategy', 'origin calls', 'slowest request', 'amplification']);

console.log(`
  The naive version is CORRECT — every request returns the right value — and it sent ${results[0]['origin calls']} queries
  to a database that expected one. That is a CACHE STAMPEDE (or "dog-piling"), and it is the
  mechanism behind a specific and very bad kind of outage:

    a hot key expires → every request misses → the database is hit N times at once → it slows down
    → requests queue → more requests arrive → the cache still is not filled → it gets worse

  The cache did not fail. It did exactly what you told it to.`);

rule('the three fixes, and when each is right');
table([
  { fix: 'lock (SET NX + lease)', origin: '1', latency: 'the losers WAIT', use: 'expensive to compute, must be current' },
  { fix: 'stale-while-revalidate', origin: '1', latency: 'nobody waits', use: 'the default for read-heavy data' },
  { fix: 'jittered TTL', origin: 'spread over time', latency: 'none', use: 'always — it prevents SYNCHRONISED expiry' },
  { fix: 'early/probabilistic refresh', origin: '1, before expiry', latency: 'none', use: 'XFetch: refresh with probability rising as TTL nears' },
  { fix: 'never expire; refresh on write', origin: '0 on read', latency: 'none', use: 'when you control every writer' },
], ['fix', 'origin', 'latency', 'use']);

console.log(`
  JITTERED TTL is the one everyone forgets and it is nearly free:

    EX = base + Math.floor(Math.random() * base * 0.2)

  Without it, a thousand keys written during the same deploy expire in the same second, and you get
  a stampede across the whole keyspace rather than one key. This is the cache equivalent of the
  thundering-herd problem in realtime-ui lab 02, and jitter is the same answer.

  AND THE LOCK DETAILS THAT MATTER:
  · the lock has a TTL (a LEASE), so a crashed holder cannot wedge the key forever
  · release is a compare-and-delete in Lua — a plain DEL can delete a lock your lease already
    lost, letting two workers recompute at once
  · the losers must have a TIMEOUT; waiting forever on a holder that died converts a cache miss
    into a hung request
  · this is a single-node lock. Across a Redis cluster it is NOT a distributed lock, and if
    correctness (not just efficiency) depends on mutual exclusion, Redis is the wrong tool —
    use a database row lock (postgres lab 06) or a fencing token.`);

rule('what to cache, and what it costs to be wrong');
console.log(`
  The two hard problems, in the order they bite:

  1. INVALIDATION. Cache-aside means the cache can be stale for up to its TTL, and every write path
     must either invalidate or accept that. The bugs are: forgetting a writer, invalidating before
     the transaction commits (so a concurrent read re-caches the OLD value), and invalidating a
     key whose name is computed differently in two places.

     The safe ordering is WRITE THEN INVALIDATE, and even that has a race — the durable fix is to
     publish invalidations from the transaction itself (the outbox, lab 05).

  2. KEY DESIGN. A key must contain EVERYTHING the value depends on: the entity id, the version of
     the serialisation, and any per-user or per-locale dimension. "user:1" that is sometimes the
     public profile and sometimes the private one is a data leak, and it is a common one.

  And the question to ask before any of it: IS THIS CACHE LOAD-BEARING? If your service cannot
  survive the cache being empty — after a restart, a failover, or an eviction — you do not have a
  cache, you have an undeclared database with no durability.`);

for (const c of clients) await c.quit();
await redis.quit();
