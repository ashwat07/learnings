/** Drill 08 — reference. */

export function createLimiter(n) {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('concurrency must be a positive integer');

  let active = 0;
  // A plain array with shift() is O(n) per dequeue, which turns 100,000 queued tasks into
  // 5,000,000,000 element moves. Two-index ring: push to the tail, read from the head, and drop
  // the consumed prefix occasionally so the array does not grow without bound.
  let queue = [];
  let head = 0;

  const next = () => {
    if (active >= n || head >= queue.length) return;
    const job = queue[head];
    queue[head++] = undefined;                 // release the reference: a queued closure can be
    if (head > 1024 && head * 2 > queue.length) {   // holding a request body, and a task that has
      queue = queue.slice(head); head = 0;          // already run must not keep it alive
    }
    active++;
    job();
  };

  return function limit(fn) {
    return new Promise((resolve, reject) => {
      queue.push(() => {
        // Promise.resolve().then(fn) rather than fn(): it normalises a SYNCHRONOUS throw into a
        // rejection. `limit(() => { throw x })` must reject, not explode at the call site — the
        // caller is holding a promise and is not in a try/catch.
        Promise.resolve()
          .then(fn)
          .then(resolve, reject)
          .finally(() => {
            active--;
            // Start the next task on the SAME turn a slot frees. Anything else (setTimeout,
            // draining on an interval) leaves the pool idle while work is queued, which is the
            // whole thing you were trying to avoid.
            next();
          });
      });
      next();
    });
  };
}

/*
FOUR THINGS THIS GETS RIGHT THAT SHORT VERSIONS DO NOT

1. SUBMISSION ORDER IS PRESERVED FOR FREE. Each call returns its own promise, resolved with its
   own result — so `Promise.all(items.map(x => limit(() => f(x))))` comes back in the order of
   `items` no matter what order things finished in. A limiter that returns a single array of
   results in completion order is a different, much less useful function.

2. FIFO, NOT LIFO. `queue.pop()` is a one-character change that turns your fair queue into a
   stack, and under sustained load a stack starves its oldest work indefinitely. The symptom is a
   p99 that is enormous while the p50 looks fine.

3. NO O(n^2). `shift()` on a large array is a memory move. So is `splice(0, 1)`. With 100,000
   queued tasks the difference is seconds of blocked event loop.

4. THE SLOT IS RELEASED IN A `finally`. If `active--` lives only on the success path, one
   rejection permanently shrinks your pool. Ten rejections and your concurrency-10 limiter is a
   concurrency-0 deadlock — a bug that only appears when the dependency you are calling starts
   failing, which is precisely when you need the retries to work.

WHAT THIS DOES NOT DO, AND WHEN YOU NEED MORE

  · No backpressure on SUBMISSION. `Array.from({length: 1e6}, () => limit(...))` still builds a
    million closures in memory before the first one runs. If the work comes from a stream or a
    cursor, do not map it into an array at all — pull with `for await`, which is naturally
    bounded (jobs-and-messaging drill 03, postgres lab 08).
  · No priorities, no cancellation, no per-host limits. `p-queue` has all three; `p-limit` is
    roughly this file. Know what is in the 40 lines before you add the dependency.
  · Concurrency is not a rate limit. 10 concurrent requests against an API that allows 100/second
    can still exceed it if each takes 50ms. Rate limiting is a different primitive
    (caching-and-queues drill 02).

PICKING n
It is a property of the RESOURCE, not of your code: the size of the connection pool, the
downstream service's published limit, the number of CPUs for CPU work. The common mistake is
picking a number that sounds brave. If n is larger than the pool behind it, all you have done is
move the queue somewhere you cannot see it.
*/
