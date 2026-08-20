# Distributed challenges — where the bug is emergent

**No containers.** The services are in-process and the fault injection is seeded, so a failure is
reproducible.

```sh
npm run drills:dist                # from backend/
npm run drills:dist -- 01 --solution
```

## Why this course exists

Every other course here teaches **one primitive in a controlled world** — a timeout, a retry, an
idempotency key, a saga step. Each of those drills is passable with the primitive alone, and that
is the right way to learn a primitive.

None of them can produce the failures that actually take services down, because those failures are
**emergent**: every component is individually correct and reviewable, and the system is broken
anyway.

| | | The starting code |
|---|---|---|
| **01** | Deadlines & retry budgets | a 1s timeout and 2 retries per hop — **9 leaf calls for one request, 9 seconds of work for a client that left after 0.5** |

## 01 — the shape of the whole course

Read the starting code and try to find the mistake:

- a 1-second timeout, because you must not wait forever — **correct**
- two retries, because transient failures are transient — **correct**
- a fresh timeout per attempt, because an attempt deserves a full chance — **correct, and the most
  defensible of the three**

Put three hops of that in a row and you have built a load amplifier. The client gives up at 500ms;
the chain works for 9 seconds. The leaf gets 9 calls for one request. And both numbers get worse
with every service you add — 2 retries × 3 hops is 8, 3 × 3 is 27.

The three rules that fix it, and what each one prevents:

| Rule | Prevents |
|---|---|
| **Deadlines, not timeouts** — propagate an absolute instant and subtract | total latency being the *sum* of per-hop timeouts; work continuing after the client has gone |
| **One retry budget per request** — shared, not per hop | Nᵈᵉᵖᵗʰ amplification, and the retry storm that turns a blip into an outage |
| **Propagate cancellation** — every hop honours the signal | paying for work nobody will read, which under load is most of your capacity |

There's a fourth thing the drill teaches by accident, and it's the one I got wrong first: **check
the deadline *before* you classify the error.** Downstream reports what it saw — "aborted",
"connection reset", "socket hang up" — and the reason it saw that is usually that time ran out. Get
the order backwards and a deadline breach surfaces as a scatter of unrelated transport errors that
nobody connects to each other.

## What is measured, not asserted

```
starting code    9 leaf calls per request · 9,011ms against a 500ms deadline · 8 calls started
                 after the client gave up · p99 3,013ms under load
reference        1 call when healthy · bounded by budget+1 per hop · 0 calls after abort · p99
                 within the deadline
```

## Related

- [`../reliability/`](../reliability/) — the primitives on their own: timeout, retry, breaker
- [`../reliability/labs/01-bulkheads/`](../reliability/labs/01-bulkheads/) — the isolation that goes *around* this
- [`../jobs-and-messaging/drills/04-saga-compensation/`](../jobs-and-messaging/drills/04-saga-compensation/) — partial failure across steps
- [`../caching-and-queues/drills/03-idempotent-consumer/`](../caching-and-queues/drills/03-idempotent-consumer/) — why at-least-once needs idempotency
- [`../api-styles/drills/04-protobuf-wire/`](../api-styles/drills/04-protobuf-wire/) — gRPC propagates deadlines natively; this is what it is doing for you
