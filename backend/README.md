# Backend engineering — labs & drills ⭐⭐⭐⭐⭐⭐

Real infrastructure, real data, real concurrency. Nothing here is mocked: a Postgres with 1.1M rows,
a Redis, and experiments that run several connections at once so a lost update actually loses an
update.

```sh
cd backend
npm install
npm run up          # docker compose: Postgres on :5433, Redis on :6380
npm run seed        # ~15s, 1.1M rows. --big for 2M orders
```

| Command | |
|---|---|
| `npm run reset` | wipe and re-seed |
| `npm run psql` | a shell in the database |
| `npm run down` | stop (keeps data) |

Ports are 5433/6380 on purpose, so they can't collide with anything you already run.

---

## Labs teach. Drills test.

This is the shape the whole backend section follows, and it exists because a lab you *run* is not
the same as a problem you *solve*:

| | What it is | You do |
|---|---|---|
| **labs** (`labs/NN/lab.mjs`) | a script that measures something and explains it | read the numbers |
| **drills** (`drills/NN/`) | a problem with a **machine-checked** target | edit `solution.sql`, run until it passes |

```sh
node postgres/labs/03-indexing/lab.mjs      # a lab
node postgres/drills/run.mjs                # all 10 drills — they all fail; that's the start
node postgres/drills/run.mjs 09 --solution  # the reference, when you're stuck
```

**The drills can't be gamed.** Each runner resets the world first (every non-constraint index
dropped, every `drill:*` key deleted) so you can't pass on a previous lab's work, and then asserts
things read straight out of the plan or observed under real concurrency: *no Seq Scan*, *buffers ≤
N*, *Heap Fetches = 0*, *row estimate within 1.5×*, *index under 512 kB*, *exactly one new index*,
*20 distinct jobs claimed with nobody blocking*, *origin called ≤ 2 times out of 500 requests*,
*exactly 100 of 500 allowed through*, *10 ledger rows from 30 deliveries*.

Thresholds are tuned so a **plausible-but-wrong** answer fails. Drill 09 is the clearest:

```
plain SELECT             → 5 distinct jobs claimed by 4 workers    FAIL (duplicates)
FOR UPDATE               → 20 distinct, 137ms max wait             FAIL (blocking)
FOR UPDATE SKIP LOCKED   → 20 distinct, 2ms max wait               PASS
```

`FOR UPDATE` alone is *correct* and still fails, because a queue where workers serialise behind each
other isn't a queue.

## Courses

| Course | Shape | Status |
|---|---|---|
| **[Postgres depth](postgres/)** | labs + drills | 4 labs, **10 drills** — plans, indexing, transactions & locking, N+1 |
| **[Caching, queues & delivery](caching-and-queues/)** | labs + drills | 1 lab, **4 drills** — stampede, rate limiting, idempotent consumers, the outbox |
| **[API craft](api-craft/)** | **failing test suite** | **25 tests** — validation, keyset pagination, idempotency, error envelope, readiness |
| **[Auth, security & compliance](auth-and-security/)** | drills | **5 drills** — password storage, timing oracles, IDOR, SSRF, token rotation |
| **[Jobs, brokers & backpressure](jobs-and-messaging/)** | drills | **4 drills** — retries & DLQ, consumer groups, Node backpressure, sagas |
| **[The Node runtime](node-runtime/)** | labs + drills, **no Docker** | 4 labs, **13 drills** — the event loop, streams, framing, cancellation, shutdown, workers, request context, streaming HTTP, pooling, leaks |
| **[Go concurrency](go-concurrency/)** | drills, run under **`-race`** | **3 drills** — data races, worker pools, context cancellation |
| **[Go, as a service](go-service/)** | drills, **`-race` required** | **3 drills** — cache stampede & singleflight, worker pool & DLQ, per-key rate limiter |
| **[Go, the language](go-lang/)** | drills + lab | 1 lab, **12 drills** — slices, errors, the nil interface, defer, generics, JSON & time, allocations, net/http, iota, errgroup, the memory model, fuzzing |
| **[Reliability & observability](reliability/)** | **failing test suite** | **26 tests** — timeouts, retries, breakers, structured logs, RED metrics, tracing |
| **[API styles & protocols](api-styles/)** | labs + drills, **no Docker** | 1 lab, **4 drills** — GraphQL resolvers & error masking, DataLoader, cursor pagination & cost limits, the protobuf wire format |
| **[Real-time & webhooks](realtime/)** | drills, **no Docker** | **5 drills** — WebSocket framing, rooms & fan-out, webhook signing, webhook delivery, SSE resume |
| Common subsystems & integrations | test suite | planned |
| Distributed systems, hard mode | drills | planned |

Two shapes, chosen per topic:

- **drills** where the target is mechanically checkable — SQL plans, cache semantics, rate limiters,
  idempotency, delivery guarantees
- **a failing test suite** where the skill is design — API modelling, error contracts, readiness and
  shutdown

```sh
npm run drills:pg        # 10 Postgres drills
npm run drills:cache     # 4 caching/queue drills
npm run drills:sec       # 5 security drills — the runner plays the attacker
npm run drills:jobs      # 4 jobs/broker/backpressure drills
npm run drills:api       # 4 API-style drills — GraphQL, DataLoader, cursors, protobuf
npm run drills:rt        # 5 real-time & webhook drills
npm run drills:node      # 13 Node runtime drills — needs no containers at all
npm run drills:go        # 3 Go concurrency drills, under the race detector
npm run drills:golang    # 12 Go language drills, under the race detector
npm run drills:goservice # 3 Go backend drills — the Node concepts, Go's failure modes
npm run lab:go-profiling # measured GC, GOGC, sync.Pool, escape analysis, pprof
npm run test:reliability # 26 reliability & observability tests
npm run test:api         # 25 API contract tests
```

## The dataset

| Table | Rows | Shaped so that |
|---|---|---|
| `users` | 50,000 | `prefs` is JSONB with a nested object and an array |
| `products` | 5,000 | `description` is prose, for full-text search |
| `orders` | 200,000 | `status` is 70% `delivered`; `created_at` is recency-skewed |
| `order_items` | ~500,000 | a composite PK, and the join that produces N+1 |
| `events` | 400,000 | append-only and time-ordered |

**No indexes except primary keys and unique constraints.** Every index in this section is one you add
and measure. And 2% of users own a disproportionate share of orders — that skew is what makes the
planner's estimates wrong in interesting ways.

## Read buffers, not milliseconds

Every lab prints both:

```
plan              exec ms  scan      buffers read  buffers hit
no index            19.14  SEQ SCAN             0         6767
created_at index     0.07  index                6          100
```

A millisecond figure on a warm laptop is a fiction — production has a cold cache, a busy disk, and
other queries competing. **Buffers touched is the number that survives the trip to production**, and
it's why every helper in [`lib/db.mjs`](lib/db.mjs) reports it.

## Requirements

Docker (for Postgres and Redis) and Node 20+. Go 1.22+ for the Go labs when those land. Everything
runs locally; nothing needs a cloud account.
