# Go concurrency ⭐⭐⭐⭐⭐⭐

Three drills, and **the test runner is `-race`**.

```sh
cd backend/go-concurrency
go test -race ./...              # all three fail
go test -race ./02-worker-pool/  # one
```

You edit `solution.go`. The reference is in `reference.go.txt` beside it — read it after.

---

| # | Drill | The bug |
|---|---|---|
| 01 | [Data race](01-data-race/) | `c.value++` from 100 goroutines |
| 02 | [Worker pool](02-worker-pool/) | one goroutine per job → 500 concurrent calls to a service that allows 8 |
| 03 | [Context cancellation](03-context-cancellation/) | sequential, ignores `ctx`, and leaks goroutines |

## Why `-race` is the whole point

Drill 01's starting code **may well pass `go test`**. The increment is fast and the corruption is
intermittent. `go test -race` catches it every time.

> **Concurrency bugs are not found by tests. They are found by the race detector.**

Run it in CI. It costs ~2–10× runtime and finds the class of bug you cannot reproduce.

## 01 — three correct answers, and they're not interchangeable

| Fix | Right when | Note |
|---|---|---|
| `sync/atomic` | a single value | no lock, one instruction; **doesn't compose** |
| `sync.Mutex` | the invariant spans more than one word | composes; `Value()` must lock **too** — a racy read is still a race |
| a channel + one owner goroutine | the state is a whole subsystem | idiomatic, and the most expensive |

**Atomic for one value, mutex for one struct, channel for one owner.** Reaching for a channel to
protect an `int` is the most common piece of Go cargo-culting there is.

## 02 — the pool is N goroutines over one channel

Not a goroutine per job with a semaphore. Simpler, allocates less, and the limit is *structural*.

Two things that bite:

- **`for x := range ch` exits when the channel is closed.** Forgetting `close(in)` is a deadlock:
  `wg.Wait()` waits for workers waiting for work that never comes. Closing is the **sender's** job —
  closing from a receiver panics the next send.
- **Writing to distinct slice indices from multiple goroutines is safe.** The header is never
  written and no two workers touch the same element. Sharing an `error` variable is *not*, which is
  why the starting code fails `-race` even though its results are correct.

In production: `errgroup` with `SetLimit`.

## 03 — cancellation

Three rules:

1. **`ctx` is the first parameter and you pass it down.** A function that takes a `ctx` then calls
   `context.Background()` has broken the chain for everything beneath it — the most common context
   bug in Go.
2. **Every goroutine must have a way to exit.** Sending on a channel nobody will read is a leak, and
   a leaked goroutine is never collected: its stack and everything it references stay alive for the
   life of the process. A buffered channel or a `select` on the send fixes it.
3. **Cancellation is advisory.** `ctx.Done()` closing stops nothing by itself; it's a signal that
   cooperating code checks.

The drill has a `TestNoGoroutineLeak` that counts goroutines before and after 20 cancelled calls —
which is how you'd catch this in a real service too.

## Still missing

`select` patterns beyond the basics, `sync.Once`/`errgroup`/`semaphore`, channel-of-channels,
fan-in/fan-out pipelines with cancellation, and pprof-driven profiling of a live service.
