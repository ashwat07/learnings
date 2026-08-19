/** Drill 04 — reference. */

// The classification is the design. Write this table before you write the loop, because every
// bug in a delivery system is a status code in the wrong row.
function classify(status) {
  if (status >= 200 && status < 300) return 'delivered';
  if (status === 429) return 'throttled';
  if (status >= 500) return 'retry';
  if (status === 408) return 'retry';          // the server timed out reading the request
  return 'permanent';                          // every other 4xx
}

const jitter = (ms) => Math.random() * ms;     // FULL jitter: pick anywhere in [0, ms)

export async function deliver(store, http, { concurrency = 8, maxAttempts = 4, timeoutMs = 5000 } = {}) {
  let idleRounds = 0;

  const attempt = async (event) => {
    const attempts = (event.attempts ?? 0) + 1;

    // A TIMEOUT ON EVERY CALL, with an abort that actually reaches the socket. Without it, one
    // customer whose firewall drops packets silently holds a worker for the OS default — which on
    // Linux is around two minutes — and your delivery rate is now set by the worst endpoint you
    // have. This is node-runtime drill 06's lesson with money attached.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('delivery timeout')), timeoutMs);

    let res, networkError = null;
    try {
      res = await http(event.url, { body: event.body, signal: controller.signal, timeoutMs });
    } catch (err) {
      networkError = err;
    } finally {
      clearTimeout(timer);
    }

    const outcome = networkError ? 'retry' : classify(res.status);

    if (outcome === 'delivered') {
      await store.markDelivered(event, { attempts, status: res.status });
      return;
    }

    // A permanent failure does not get another go. 410 Gone means the endpoint has been removed;
    // 400 means the body is malformed; 401 means the shared secret is wrong. Retrying any of
    // these four times multiplies a customer's configuration mistake by four and tells you
    // nothing new. Straight to the dead-letter table, where a human can see it.
    if (outcome === 'permanent') {
      await store.markDead(event, { attempts, status: res.status, reason: `permanent ${res.status}` });
      return;
    }

    if (attempts >= maxAttempts) {
      await store.markDead(event, {
        attempts,
        status: res?.status,
        lastError: networkError?.message ?? `HTTP ${res.status}`,
        reason: 'max attempts exceeded',
      });
      return;
    }

    // 429 means the endpoint has TOLD you when to come back. Believe it — a Retry-After you
    // ignore is how a rate limit becomes a ban.
    let delay;
    if (outcome === 'throttled') {
      const after = Number(res.headers?.['retry-after'] ?? NaN);
      delay = Number.isFinite(after) ? after * 1000 : 1000;
    } else {
      // Exponential backoff with FULL JITTER. The exponential part stops you hammering an
      // endpoint that is already struggling; the jitter stops all 20 of that customer's queued
      // events retrying in the same millisecond, which is what turns their brief outage into a
      // thundering herd the moment they come back up.
      const cap = Math.min(30_000, 25 * 2 ** attempts);
      delay = jitter(cap);
    }

    await store.retryLater(
      { ...event, attempts },
      delay,
      { attempts, lastError: networkError?.message ?? `HTTP ${res.status}` },
    );
  };

  // A bounded pool. `Promise.all(events.map(attempt))` would open 120 connections at once — to
  // 120 different customers, from one process, which is how you get rate-limited by all of them
  // simultaneously (node-runtime drill 08).
  for (;;) {
    const now = Date.now();
    const batch = [];
    // Only take events whose backoff has elapsed. In a real system this is
    // `WHERE next_attempt_at <= now() ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT n`
    // — the same query as jobs-and-messaging drill 01, and SKIP LOCKED is what lets several
    // senders share the table without blocking each other.
    const held = [];
    while (batch.length < concurrency) {
      const [event] = await store.next(1);
      if (!event) break;
      if (event.notBefore && event.notBefore > now) held.push(event);
      else batch.push(event);
    }
    for (const event of held) store.pending.push(event);   // put back the ones not due yet

    if (batch.length === 0) {
      if (store.remaining === 0) return;
      if (++idleRounds > 2000) return;                     // a backstop, never a design
      await new Promise((r) => setTimeout(r, 5));          // everything is backing off
      continue;
    }
    idleRounds = 0;
    await Promise.all(batch.map(attempt));
  }
}

/*
THE THINGS THAT MAKE THIS A PRODUCT RATHER THAN A LOOP

  · PER-ENDPOINT ISOLATION. This reference has one global pool, so a customer with 10,000 queued
    events and a 30-second timeout still consumes workers everyone else is waiting for. Real
    systems shard the queue by destination and give each one its own concurrency — a bulkhead. The
    symptom without it is "our webhooks are delayed" during someone else's outage.
  · A CIRCUIT BREAKER PER ENDPOINT. After N consecutive failures, stop trying for a while and fail
    fast. Otherwise a customer who has been down for a week costs you a retry storm every minute,
    forever (reliability/).
  · A REPLAY UI. The dead-letter table is only useful if someone can look at it and press a
    button. "Delivery attempts, with response codes and bodies, and a resend" is the feature every
    good webhook product has and every homegrown one lacks.
  · ORDERING, IF YOU PROMISE IT. Concurrency and retries mean `payment.succeeded` can arrive
    before `payment.created`. The honest options are: do not promise ordering (and document it —
    this is what Stripe does), or serialise per destination and accept that one slow event blocks
    the ones behind it.
  · AT-LEAST-ONCE, AND SAY SO. Retries mean duplicates. Send a stable event id and require
    receivers to deduplicate on it (drill 03, caching-and-queues drill 03). Trying to achieve
    exactly-once delivery over HTTP is a way to spend a quarter and fail.
  · A DELIVERY TIMEOUT THE RECEIVER KNOWS ABOUT. Publish it. "We time out after 5 seconds and
    retry" is what tells a receiver to enqueue and return 200 rather than process inline.

WHAT THE NUMBERS IN THIS DRILL SHOW
The permanently-broken endpoint costs 4 attempts per event and then stops. The 410 costs exactly
one. The endpoint that never answers costs one timeout each, not one hang each. And the healthy
customers' events go out at full speed throughout — which is the only one of these your customers
will ever notice.
*/
