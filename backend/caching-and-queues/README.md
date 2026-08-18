# Caching, queues & delivery guarantees ⭐⭐⭐⭐⭐⭐

Redis and Postgres, and the four problems that decide whether a system stays up under load: the
stampede, the limiter, the duplicate, and the dual write.

```sh
cd backend
npm run up && npm run seed
node caching-and-queues/labs/02-stampede/lab.mjs
npm run drills:cache
```

---

## Labs

| # | Lab | The measurement |
|---|---|---|
| 02 | [Cache stampede](labs/02-stampede/) | 200 concurrent requests for one expired key: **200 → 1** origin calls, and SWR serves in 9ms instead of 174ms |

## Drills — 4 problems, scored under real concurrency

```sh
npm run drills:cache
node caching-and-queues/drills/run.mjs 02 --solution
```

| # | Drill | What's checked |
|---|---|---|
| 01 | Stop the stampede | 500 racing requests, **origin called ≤ 2 times**, nobody waits > 900ms |
| 02 | A rate limiter that limits | **exactly 100 of 500** allowed, 25 connections, and the window must expire |
| 03 | Effectively-once delivery | 30 deliveries of 10 payments across 4 workers → **10 ledger rows** |
| 04 | The dual-write problem | a broker failing 50% and rollbacks 25% → **no orphaned or missing events** |

Every drill is scored on **behaviour under concurrency**, because that's the only thing separating a
correct implementation from one that merely looks correct. Drill 03 rejects `SELECT`-then-`INSERT`
even though the counts come out right — the race surfaces as an unhandled primary-key conflict.

## The four ideas

**1. A cache stampede is not a cache failure.** One hot key expires, every request misses, the
database is hit N times at once, it slows down, requests queue, the cache still isn't filled. The
cache did exactly what you told it to.

Fixes in order of preference: **jittered TTL** (nearly free, and prevents synchronised expiry across
the whole keyspace), **stale-while-revalidate** (nobody waits), **a lock with a lease** (one
recomputes). The lock details that matter: a TTL so a crashed holder can't wedge the key, a
**compare-and-delete in Lua** on release, and a bound on how long losers wait.

**2. "Check then act" is a race, always.** The rate limiter that reads, decides, and writes lets 500
through instead of 100. `INCR` is atomic; *"increment **and** set the TTL only on the first hit"* is
two commands, and Lua is how you make it one.

**3. At-least-once + idempotent consumer = effectively-once.** Exactly-once *delivery* doesn't
exist; exactly-once *effects* do. Write the dedup key and the side effect in the **same
transaction**, and claim atomically with `ON CONFLICT DO NOTHING RETURNING`.

**4. Never write to two systems and hope.** The dual write fails in both directions — a broker error
loses the event, a rollback announces an order that doesn't exist. The **transactional outbox**
makes them one atomic write, and a relay publishes with retries. That relay gives you at-least-once,
which is exactly what drill 03 taught you to consume.

## Related

- [postgres lab 06](../postgres/labs/06-transactions-and-locking/) — `FOR UPDATE SKIP LOCKED`, the
  queue primitive, and why the outbox relay uses it
- [resilience lab 02](../../resilience/labs/02-retries-and-idempotency/) — the same idempotency
  argument from the client side
- [realtime-ui lab 03](../../realtime-ui/labs/03-reconciliation/) — "facts, not deltas", which is
  what makes a consumer idempotent for free
