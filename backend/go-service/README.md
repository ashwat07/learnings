# Go, as a service

The language drills are next door in [`../go-lang/`](../go-lang/) and
[`../go-concurrency/`](../go-concurrency/). This is the **backend** material in Go — the same
concepts as the Node courses, in a language where the failure modes are different.

```bash
cd backend/go-service
go test -race ./...                    # all three, all red
go test -race ./01-cache-stampede/     # one
go test -bench . -benchmem ./...
```

**`-race` is not optional here.** Two of the three starting states are data races, and without the
detector they pass sometimes.

| | | The starting code |
|---|---|---|
| **01** | Cache stampede | race-free, collapses the stampede — and makes 8 independent 50ms loads take **407ms** |
| **02** | Worker pool & DLQ | one job at a time, retries forever, and a handler panic **kills the process** |
| **03** | Rate limiter | **23 requests pass a limit of 20**, and 20,001 buckets are never freed |

## Why these are worth doing twice

The Node versions all exist ([caching-and-queues](../caching-and-queues/),
[jobs-and-messaging](../jobs-and-messaging/)) and they are not redundant, because they test
different things.

**The Node drills test the policy.** Retry transient and never permanent, cap the attempts, jitter
the backoff, collapse concurrent misses, record why something died. That reasoning is
language-independent, and it is most of the value.

**These test what the runtime does to you while you implement it.** Four things Node cannot express:

- **Shared state is a data race.** `stats.Done++` from eight workers is undefined behaviour. In
  JavaScript the identical code is correct by construction — there is one thread. This is the
  biggest difference in how concurrent Go *feels*.
- **A panic kills the process.** An unhandled rejection in Node logs a warning; a panic in a
  goroutine terminates everything, including the 200 healthy jobs in flight. There is no outer
  handler and no supervisor.
- **Goroutine leaks are real and silent.** `Process` returning before `wg.Wait()` leaves workers
  running against a channel nobody will close. `runtime.NumGoroutine()` before and after is the
  cheapest leak test there is.
- **Shutdown is explicit.** No loop to drain — you thread a context through, and every
  `time.Sleep`, every channel send and every downstream call is somewhere you can accidentally
  ignore SIGTERM.

## The one to start with

**Drill 01**, because of what the naive version gets *right*. `mu.Lock(); defer mu.Unlock()` around
the whole of `Get` is race-free **and** it collapses the stampede — the first goroutine loads, the
other 499 find the value already there. Both things you were worried about are handled. That is
exactly why it survives review.

What it does instead is hold the lock across the load, so every miss in the process serialises: 8
different cold keys at 50ms each become **407ms**, and one genuinely slow key makes the whole cache
— including every hot key — as slow as that key. The rule underneath is the one that recurs
everywhere: **never hold a lock across I/O.**

Drill 03 is that rule again (a throttled key must not block an unthrottled one), plus the
atomicity lesson from the Redis version — *check-then-decrement is not atomic* — with two OS
threads instead of two awaits.

## Related

- [`../caching-and-queues/`](../caching-and-queues/) — the Node originals: stampede, rate limiting, idempotency, the outbox
- [`../jobs-and-messaging/`](../jobs-and-messaging/) — retries & DLQ, consumer groups, backpressure, sagas
- [`../go-concurrency/`](../go-concurrency/) — data races, worker pools, context cancellation
- [`../go-lang/`](../go-lang/) — the language, including [the memory model](../go-lang/11-memory-model/) everything here rests on
- [`../go-lang/SHIPPING.md`](../go-lang/SHIPPING.md) — `database/sql` pool settings, `slog`, distroless
