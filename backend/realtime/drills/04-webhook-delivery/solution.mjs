/**
 * Drill 04 — delivering webhooks.
 *
 * The starting point delivers events one at a time, retries everything forever, and waits for
 * whatever the endpoint gives it. Every one of those is a decision that looks conservative and
 * is not: retrying a 400 is retrying a payload that is wrong; waiting on a hanging endpoint is
 * letting one customer's firewall decide your throughput.
 *
 *   deliver(store, http, { concurrency, maxAttempts, timeoutMs }) -> Promise
 *
 *   store.next(limit)                     -> events to attempt now
 *   store.markDelivered(event, info)
 *   store.markDead(event, info)           -> the dead-letter table
 *   store.retryLater(event, delayMs, info)
 *   store.remaining
 *
 *   http(url, { body, signal, timeoutMs }) -> { status, headers } , or throws on a network error
 *
 * Each event carries { id, url, body } and, once retried, whatever you put on it.
 *
 * The decision table you need to write down before any code:
 *
 *     2xx            delivered
 *     429            retry, and honour Retry-After
 *     5xx            retry with backoff
 *     network error  retry with backoff
 *     other 4xx      DO NOT RETRY. 400 means your payload is wrong; 410 means the endpoint is
 *                    gone; 401 means the secret is wrong. None of these get better by waiting,
 *                    and retrying them 4x turns a customer's misconfiguration into a DDoS.
 */

export async function deliver(store, http, { concurrency = 8, maxAttempts = 4, timeoutMs = 5000 } = {}) {
  for (;;) {
    const batch = await store.next(concurrency);
    if (batch.length === 0) return;

    for (const event of batch) {
      const attempts = (event.attempts ?? 0) + 1;
      try {
        const res = await http(event.url, { body: event.body });
        if (res.status >= 200 && res.status < 300) {
          await store.markDelivered(event, { attempts });
        } else {
          await store.retryLater({ ...event, attempts }, 100, { attempts });
        }
      } catch (err) {
        await store.retryLater({ ...event, attempts }, 100, { attempts });
      }
    }
  }
}
