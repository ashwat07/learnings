# Reliability & observability ⭐⭐⭐⭐⭐⭐

Six primitives every service needs and most re-invent badly, as **26 failing tests**.

```sh
cd backend
npm run test:reliability
node --test --test-name-pattern="breaker" reliability/test/
```

You edit [`src/reliability.mjs`](src/reliability.mjs). The reference is
`src/reliability.reference.mjs` — read it after.

---

## What the suite asserts

| Primitive | The requirements that catch people |
|---|---|
| **`withTimeout`** | rejects with `code: 'ETIMEDOUT'`; **passes an `AbortSignal` so the work actually stops**; clears the timer |
| **`retry`** | exactly `attempts` calls; **full jitter, not a fixed delay**; never retries a 4xx; surfaces the *last* error |
| **`createBreaker`** | opens on a **rate**, not a count; fails fast **without calling through**; half-open probe closes or re-opens |
| **`createLogger`** | JSON with level/msg/time/service; `child()` bindings on every line; **redacts secrets at any depth**; serialises `Error` |
| **`createMetrics`** | RED per route; **percentiles, not averages** |
| **traceparent** | parse/reject malformed; a child span keeps the **trace id**, gets a new **span id**, preserves **sampled** |

## The six lessons

**1. A timeout that doesn't abort has bounded only *your* latency.** The upstream request keeps
running, keeps holding a connection, and keeps costing the thing you were trying to protect. The
test asserts `fn` receives an `AbortSignal`.

**2. Full jitter, not `cap ± 10%`.** The test runs the retry six times and fails you if every backoff
was the same length. A narrow band around the same instant is still a thundering herd.

**3. A breaker opens on a rate.** `2 failures in 20 calls` is 10% and must *not* trip — a raw count
means a low-traffic path breaks on two unlucky calls. And an open breaker must not call the
downstream **at all**; the test asserts `fn` was never invoked.

**4. Secrets leak through nesting.** The test plants `password` at the top level, `authorization`
inside `headers`, and `apiKey` two levels deep, and asserts none of them appear in the output —
while non-secret fields survive. Also: **a bare `Error` `JSON.stringify`s to `{}`**, so it needs a
serialiser or your error logs are empty objects.

**5. Never page on a mean.** With 95 requests at 5ms and 5 at 5,000ms, the mean is a tolerable-looking
255ms and the p99 is 5,000ms. One in twenty users waits five seconds.

*(I got this test wrong first: with 99 fast and 1 slow, p99 is legitimately the fast value —
nearest-rank p99 of 100 samples is the 99th. The fix was 5% slow, which also makes the point
better.)*

**6. The trace id is what stitches services together.** A child span keeps it, gets a new span id,
and **preserves the sampled flag** — drop that and you get half a trace. A malformed inbound header
must parse to `null`, never throw: you don't want a bad header from someone else's service taking
down a request.

## What this doesn't cover yet

Real OpenTelemetry SDK wiring and exporters, testcontainers-based integration tests, contract
testing, container/orchestration concerns, expand/contract migrations in a pipeline, and load
testing with k6 or pprof profiling.

The frontend counterparts are built:
[quality-and-delivery](../../quality-and-delivery/) and [resilience](../../resilience/) — same ideas,
none of the same tooling.
