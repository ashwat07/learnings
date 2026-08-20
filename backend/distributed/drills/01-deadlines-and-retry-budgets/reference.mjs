/** Drill 01 — reference. */

// Reserved for the response to travel back up and for the next hop to do anything at all. Without
// it you hand downstream a deadline of "now", it refuses, and you have spent a network round trip
// to learn something you already knew.
const HOP_BUFFER_MS = 15;

// Backoff is capped by what is LEFT, not by a constant. A 200ms backoff inside a 150ms remaining
// budget is a sleep followed by a guaranteed failure.
const backoff = (attempt, remaining) =>
  Math.min(20 * 2 ** attempt, Math.max(0, remaining - HOP_BUFFER_MS), 250) * Math.random();

const deadlineError = (remaining) =>
  Object.assign(new Error(`deadline exceeded (${remaining}ms remaining)`), { code: 'DEADLINE_EXCEEDED', retryable: false });

export async function call(next, req, ctx) {
  const { deadline, signal, budget } = ctx;
  let lastErr = null;

  for (let attempt = 0; ; attempt++) {
    // 1. THE DEADLINE IS A POINT IN TIME, so "how long do I have?" is subtraction, and it means
    //    the same thing at every hop. A DURATION ("timeout: 1s") cannot survive a hop — each
    //    service reads it as one second from ITS now, which is how three hops turn one second of
    //    client patience into three seconds of work.
    const remaining = deadline == null ? Infinity : deadline - Date.now();
    if (remaining <= HOP_BUFFER_MS) throw lastErr ?? deadlineError(remaining);

    // The caller has already gone. Do not start anything.
    if (signal?.aborted) throw signal.reason ?? new Error('aborted');

    // 2. RETRIES COME OUT OF A SHARED BUDGET. This is the line that stops amplification. A retry
    //    policy that is per-hop MULTIPLIES: two attempts at three hops is eight leaf calls, three
    //    at three hops is twenty-seven. One budget, threaded through the request, makes the worst
    //    case ADDITIVE — and it is the difference between a dependency that is struggling and a
    //    dependency you have finished off.
    //
    //    The first attempt is free; only RETRIES are charged. Charging attempt zero would let a
    //    single failing hop consume the whole request's budget before anyone else got a turn.
    if (attempt > 0 && !budget?.tryTake()) {
      throw remaining <= HOP_BUFFER_MS ? deadlineError(remaining) : lastErr;
    }

    // 3. COMPOSE THE SIGNALS. The attempt must stop if EITHER the caller gives up OR this
    //    attempt's own slice of time runs out. AbortSignal.any (Node 20+) is exactly this; before
    //    it, you wired two listeners by hand and remembered to remove them (node-runtime drill 06).
    const attemptMs = Math.max(1, Math.min(remaining - HOP_BUFFER_MS, remaining));
    const own = AbortSignal.timeout(attemptMs);
    const combined = signal ? AbortSignal.any([signal, own]) : own;

    try {
      // 4. PASS THE SHRUNK DEADLINE AND THE COMBINED SIGNAL DOWN. Downstream now knows exactly
      //    how much time it has and gets told the moment it stops mattering. This is what makes
      //    the chain cooperative instead of each hop optimising for itself.
      return await next(req, {
        deadline: Date.now() + attemptMs,
        signal: combined,
        budget,                       // the SAME object — not a copy, not a fresh one
      });
    } catch (err) {
      lastErr = err;

      // The caller gave up: stop immediately, and do not spend budget on it.
      if (signal?.aborted) throw signal.reason ?? err;

      // THE ORDER OF THESE THREE CHECKS IS THE POINT.
      //
      // Downstream reports what IT saw: "aborted", "connection reset", "socket hang up". The
      // reason it saw that is usually that time ran out — so the deadline check has to come
      // FIRST, before the retryable classification. Get this backwards (as the obvious ordering
      // does) and a deadline breach surfaces as a scatter of unrelated transport errors that
      // nobody connects to each other, in your logs and in your metrics.
      const left = deadline == null ? Infinity : deadline - Date.now();
      if (left <= HOP_BUFFER_MS) throw deadlineError(left);

      // A non-retryable error will fail identically next time. Retrying a 422 is not resilience,
      // it is three times the load for the same answer. Default to NOT retrying anything you have
      // not explicitly classified as transient — the opposite default is how a bad request becomes
      // a small outage.
      if (err?.retryable === false) throw err;

      const wait = backoff(attempt, left);
      if (wait > 0) {
        await new Promise((resolve) => {
          const t = setTimeout(resolve, wait);
          signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
        });
      }
    }
  }
}

/*
WHY THIS IS THE DRILL WHERE NOTHING WAS WRONG

Read the starting code again. A one-second timeout: correct. Two retries on a transient failure:
correct. A fresh timeout for each attempt, because an attempt should get a full chance: also
correct, and the most defensible of the three.

The bug is that none of them can see the others, or the hops above and below. That is what makes
distributed failures different in kind rather than degree: the components are individually
reviewable and the system is not.

THE THREE RULES, AND WHAT EACH ONE PREVENTS

  1. DEADLINES, NOT TIMEOUTS. Propagate an absolute instant and subtract. gRPC does this natively
     (the `grpc-timeout` header, recomputed at every hop) and it is the single biggest thing gRPC
     gets right that REST leaves to you. Over HTTP you carry it yourself — a header, and a
     context object that every call takes.
     Prevents: work continuing after the client has gone, and total latency being the SUM of
     per-hop timeouts instead of bounded by the client's patience.

  2. ONE RETRY BUDGET PER REQUEST. Not per hop, not per client, per REQUEST — and in a mature
     system also a per-DEPENDENCY budget expressed as a percentage of traffic ("retries may be at
     most 10% of calls to inventory"), which is what stops a broken dependency being retried by
     everybody at once.
     Prevents: N^depth amplification, and the retry storm that turns a recoverable blip into an
     outage. This is the mechanism behind most "it was fine and then it wasn't" incidents.

  3. PROPAGATE CANCELLATION. The signal goes down every hop, and every hop honours it.
     Prevents: paying for work nobody will read — which under load is most of your capacity,
     because the requests that time out are exactly the ones that were expensive.

WHAT TO ADD ON TOP, IN THIS ORDER
  · a CIRCUIT BREAKER per dependency, so a dead dependency costs a microsecond instead of a
    timeout (reliability lab 01 measures the difference)
  · JITTER on the backoff, which is already here — without it, every retry in the fleet lands in
    the same millisecond
  · HEDGING for read-only, idempotent calls: after p95, send a second request and take whichever
    answers first. Bounded (one hedge, and only if the budget allows) it cuts tail latency
    dramatically; unbounded it is a retry storm you built on purpose.
  · DEADLINE-AWARE ADMISSION at the leaf: if the incoming deadline has already passed, refuse
    immediately. The world in ../../world.mjs does exactly that, which is why passing the deadline
    down produces a fast refusal rather than a slow one.

THE NUMBER TO PUT ON A DASHBOARD
Retries as a PERCENTAGE OF TOTAL CALLS, per dependency. A healthy system sits near zero. When it
moves, it moves before your error rate does — and unlike error rate, it tells you whether you are
making the problem worse.
*/
