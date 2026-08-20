/**
 * Drill 01 — deadlines and retry budgets.
 *
 * The starting point is what every hop in every service looks like, and every line of it is
 * defensible on its own:
 *
 *   · a 1-second timeout, because you must not wait forever
 *   · two retries, because transient failures are transient
 *   · a fresh timeout per attempt, because that is what a timeout means
 *
 * Put three of them in a row and you have built a load amplifier with a delay fuse. The client
 * gives up after one second; the chain keeps working for six. The leaf gets eight calls for one
 * request. And every one of those properties gets WORSE as you add services.
 *
 *   call(next, req, ctx)
 *
 *     ctx.deadline   an absolute epoch-ms instant — the moment the CLIENT stops caring
 *     ctx.signal     an AbortSignal that fires when the caller gives up
 *     ctx.budget     shared across the whole request: budget.tryTake() -> boolean
 *
 * Four things to get right:
 *   1. never start an attempt you cannot finish before the deadline
 *   2. pass a deadline DOWN, so the next hop inherits the same instant rather than a fresh timer
 *   3. take retries from ctx.budget, so N hops cannot multiply into N^depth calls
 *   4. propagate the signal, so abandoning a request actually stops the work
 */

const RETRIES = 2;
const TIMEOUT_MS = 1000;

export async function call(next, req, ctx) {
  let lastErr;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    // A fresh timeout, per attempt, per hop. Three hops x three attempts x one second is nine
    // seconds of work for a client that left after one.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      // Note what is NOT passed down: no deadline, and not the caller's signal. The next hop
      // starts its own clock and never learns that this one has given up.
      return await next(req, { signal: ac.signal });
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}
