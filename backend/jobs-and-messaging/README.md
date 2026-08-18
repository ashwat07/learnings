# Jobs, brokers & backpressure ⭐⭐⭐⭐⭐⭐

Four drills against a hostile world: workers that crash mid-job, a message that can never succeed, a
producer faster than its consumer, and a step that fails after two others have already committed.

```sh
cd backend
npm run up && npm run seed
npm run drills:jobs
node jobs-and-messaging/drills/run.mjs 02 --solution
```

---

| # | Drill | What breaks in the starting code |
|---|---|---|
| 01 | [Retries, backoff & DLQ](drills/01-retries-and-dlq/) | a poison job blocks the queue forever — **9 good jobs are never even reached** |
| 02 | [Consumer groups](drills/02-consumer-groups/) | a worker dies holding 5 messages; **they are stranded** |
| 03 | [Node backpressure](drills/03-node-backpressure/) | **53MB heap, 44ms loop block, 200,022 concurrent writes** |
| 04 | [Saga & compensation](drills/04-saga-compensation/) | the card stays charged for an order that will never ship |

## 01 — the DLQ, and head-of-line blocking

The naive worker retries forever, and because it always picks the oldest queued job it **never
reaches the other nine**. That's not a slow queue; it's a stopped one.

Four decisions every real queue makes: a **max attempt count**, **exponential backoff with jitter**,
a **dead-letter queue carrying the error and the attempt count**, and *the worker must not die*.

What production adds: a visibility timeout so a crashed worker's job is re-queued, a
**retryable-vs-terminal** distinction (a 400 from upstream goes straight to the DLQ — don't retry
what can't succeed), and an alert on DLQ depth. **A DLQ nobody watches is a delete.**

## 02 — the broker semantics, in the smallest thing that has them

Redis Streams has consumer groups, a pending-entries list and claim-after-timeout — the same model
as Kafka consumer groups, SQS visibility timeouts and RabbitMQ acks.

**Acknowledge after processing, not before.** Between delivery and `XACK` the message sits in the
**PEL** with the name of the consumer holding it. That list is the entire safety net.

**Nothing tells Redis a worker died.** Its messages just sit there getting older. `XAUTOCLAIM` takes
ownership of anything idle past a threshold — the same idea as an SQS visibility timeout. Too short
and you double-process slow jobs; too long and a crash stalls the queue. And because a reclaim *can*
double-process, **the consumer must be idempotent** ([caching drill 03](../caching-and-queues/drills/03-idempotent-consumer/)).

Also generalises: **ordering is per partition, not global** — scaling past the partition count buys
no parallelism.

## 03 — three separate bugs in one line

```js
const rows = await sql`SELECT ...`;                       // materialises everything
const lines = rows.map(...);                              // one uninterruptible task
await Promise.all(lines.map((l) => sink.write(l)));       // unbounded concurrency
```

| | naive | fixed |
|---|---|---|
| peak heap growth | **53MB** | 15MB |
| longest event-loop block | **44ms** | 2ms |
| concurrent writes | **200,022** | 32 |

A cursor gives you backpressure for free: it fetches a window, waits for your callback, then asks
for more. Memory becomes O(batch), not O(rows).

**Never hold the whole dataset, and never run an unbounded loop.** (If the transform were CPU-bound
rather than I/O-bound, the answer is `worker_threads` instead — no amount of yielding makes CPU work
free.)

## 04 — sagas

A saga is what you use when a business transaction spans systems that **can't share a database
transaction**. There's no rollback, so you write the undo.

Two details the drill checks and both are easy to get wrong: **compensate in reverse order** (later
steps may depend on earlier ones), and **don't compensate the step that failed** — it never
completed, and calling its `compensate()` is how you refund a charge that never happened.

Production adds: compensations must be **idempotent and retryable** (a failed compensation is the
worst state in the system), the saga state must be **persisted** so a crash mid-unwind can resume —
which is what Temporal is for — and **irreversible steps go last**, because you can't un-send an
email.

## Still missing from this section

Kafka/RabbitMQ/NATS specifics (partitions, rebalancing, consumer-group protocol), CDC/Debezium,
distributed cron and long-running workflow engines.

Go concurrency lives next door in [go-concurrency](../go-concurrency/).
