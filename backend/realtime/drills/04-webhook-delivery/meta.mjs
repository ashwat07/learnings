import { sleep } from '../../world.mjs';

export const title = 'Delivering webhooks to endpoints that are down';
export const task = `Now you are the provider. You have 200 events to deliver to customer
endpoints, and those endpoints are: fine, slow, returning 500, returning 410 Gone, and one that
holds every connection open for thirty seconds without answering.

Implement deliver(store, http, { concurrency, maxAttempts, timeoutMs }).

  · retry 5xx, 429 and network failures with exponential backoff AND jitter
  · do NOT retry 4xx (except 429) — a 400 means the payload is wrong, and it will be wrong again
  · respect Retry-After on a 429
  · a slow endpoint must not hold up everyone else
  · give up after maxAttempts and put it in the dead-letter table
  · one customer's outage must not delay another customer's events`;
export const passIf = 'everything deliverable is delivered, permanent failures are not retried, the slow endpoint does not block the queue, and nothing is lost';

const ENDPOINTS = {
  good: { behaviour: 'ok' },
  flaky: { behaviour: 'fail-twice' },
  down: { behaviour: '500' },
  gone: { behaviour: '410' },
  slow: { behaviour: 'hang' },
  throttled: { behaviour: '429' },
};

function makeWorld() {
  const attempts = new Map();       // eventId -> count
  const delivered = new Set();
  const calls = [];
  const inFlight = { now: 0, peak: 0 };

  const http = async (url, { body, signal, timeoutMs } = {}) => {
    const endpoint = url.replace('https://', '').split('/')[0];
    const id = JSON.parse(body).id;
    attempts.set(id, (attempts.get(id) ?? 0) + 1);
    calls.push({ endpoint, id, at: Date.now() });
    inFlight.now++; inFlight.peak = Math.max(inFlight.peak, inFlight.now);
    const done = (v) => { inFlight.now--; return v; };

    const behaviour = ENDPOINTS[endpoint]?.behaviour ?? 'ok';
    switch (behaviour) {
      case 'ok':
        await sleep(2);
        delivered.add(id);
        return done({ status: 200 });
      case 'fail-twice':
        await sleep(2);
        if ((attempts.get(id) ?? 0) <= 2) return done({ status: 503 });
        delivered.add(id);
        return done({ status: 200 });
      case '500':
        await sleep(2);
        return done({ status: 500 });
      case '410':
        await sleep(2);
        return done({ status: 410 });
      case '429':
        await sleep(2);
        if ((attempts.get(id) ?? 0) <= 1) return done({ status: 429, headers: { 'retry-after': '0' } });
        delivered.add(id);
        return done({ status: 200 });
      case 'hang': {
        // Never answers. Only an abort or a timeout gets you out.
        const budget = timeoutMs ?? 30_000;
        await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(Object.assign(new Error('socket hang up'), { code: 'ETIMEDOUT' })), budget);
          signal?.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { code: 'ABORT_ERR' })); }, { once: true });
        }).catch((e) => { inFlight.now--; throw e; });
        return done({ status: 200 });
      }
      default:
        return done({ status: 200 });
    }
  };

  const events = [];
  let n = 0;
  for (const endpoint of ['good', 'flaky', 'down', 'gone', 'slow', 'throttled']) {
    for (let i = 0; i < 20; i++) {
      events.push({ id: `evt-${++n}`, url: `https://${endpoint}/hook`, body: JSON.stringify({ id: `evt-${n}`, endpoint }) });
    }
  }

  const store = {
    pending: [...events],
    delivered: [],
    dead: [],
    async next(limit) { return this.pending.splice(0, limit); },
    async markDelivered(event, info) { this.delivered.push({ ...event, ...info }); },
    async markDead(event, info) { this.dead.push({ ...event, ...info }); },
    backoffs: [],
    async retryLater(event, delayMs, info) {
      this.backoffs.push({ id: event.id, attempts: event.attempts ?? info?.attempts ?? 0, delayMs });
      this.pending.push({ ...event, notBefore: Date.now() + delayMs, ...info });
    },
    get remaining() { return this.pending.length; },
  };

  return { http, store, attempts, delivered, calls, inFlight, total: events.length };
}

export async function check(s) {
  if (typeof s.deliver !== 'function') return [{ check: 'exports deliver(store, http, options)', actual: 'missing', pass: false }];
  const out = [];

  const w = makeWorld();
  const t0 = Date.now();
  let crashed = null;
  try {
    await Promise.race([
      s.deliver(w.store, w.http, { concurrency: 8, maxAttempts: 4, timeoutMs: 120 }),
      sleep(20_000).then(() => { throw new Error('deliver() did not finish in 20s'); }),
    ]);
  } catch (e) { crashed = e; }
  const elapsed = Date.now() - t0;

  const byEndpoint = (name) => w.store.delivered.filter((e) => e.url.includes(name)).length;
  const deadFor = (name) => w.store.dead.filter((e) => e.url.includes(name)).length;
  const attemptsFor = (name) => w.calls.filter((c) => c.endpoint === name).length;

  out.push({ check: 'deliver() finished', actual: crashed ? crashed.message.slice(0, 50) : `${elapsed}ms`, pass: !crashed });
  out.push({ check: 'all 20 events to the healthy endpoint were delivered', actual: byEndpoint('good'), pass: byEndpoint('good') === 20 });
  out.push({
    check: 'the flaky endpoint (fails twice, then works) got all 20 through',
    actual: `${byEndpoint('flaky')} delivered after ${attemptsFor('flaky')} attempts`,
    pass: byEndpoint('flaky') === 20,
  });
  out.push({
    check: 'a 429 is retried, and Retry-After is honoured',
    actual: `${byEndpoint('throttled')} delivered`,
    pass: byEndpoint('throttled') === 20,
  });
  out.push({
    check: 'the permanently-down endpoint gave up after maxAttempts, into the DLQ',
    actual: `${deadFor('down')} dead, ${attemptsFor('down')} attempts for 20 events`,
    pass: deadFor('down') === 20 && attemptsFor('down') <= 20 * 4,
  });
  out.push({
    check: 'a 410 Gone is NOT retried — it will never succeed',
    actual: `${attemptsFor('gone')} attempts for 20 events`,
    pass: attemptsFor('gone') === 20 && deadFor('gone') === 20,
  });
  out.push({
    check: 'the endpoint that never answers is timed out, not waited on',
    actual: `${deadFor('slow')} dead after ${attemptsFor('slow')} attempts`,
    pass: deadFor('slow') === 20,
  });
  out.push({
    check: 'one broken customer did not stall the others (finished under 12s)',
    actual: `${elapsed}ms`,
    pass: elapsed < 12_000,
  });
  out.push({
    check: 'concurrency was respected',
    actual: `peak ${w.inFlight.peak} in flight`,
    pass: w.inFlight.peak <= 8 && w.inFlight.peak >= 2,
  });
  out.push({
    check: 'nothing was lost: delivered + dead = 120',
    actual: `${w.store.delivered.length} + ${w.store.dead.length} = ${w.store.delivered.length + w.store.dead.length}`,
    pass: w.store.delivered.length + w.store.dead.length === w.total,
  });
  out.push({
    check: 'no event was delivered twice',
    actual: (() => { const ids = w.store.delivered.map((e) => e.id); return `${ids.length} deliveries, ${new Set(ids).size} unique`; })(),
    pass: new Set(w.store.delivered.map((e) => e.id)).size === w.store.delivered.length,
  });
  out.push({
    check: 'the DLQ records why it failed',
    actual: w.store.dead[0] ? JSON.stringify(Object.keys(w.store.dead[0])).slice(0, 60) : 'nothing in the DLQ',
    pass: w.store.dead.length > 0 && w.store.dead.every((e) => e.attempts >= 1 && (e.lastError ?? e.reason ?? e.status) !== undefined),
  });

  // The delays the solution CHOSE, rather than the wall-clock gaps — so the check measures the
  // backoff policy and not the scheduler's noise.
  const delaysAt = (n) => w.store.backoffs.filter((b) => b.attempts === n).map((b) => b.delayMs);
  const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
  const first = delaysAt(1), third = delaysAt(3);
  out.push({
    check: 'the delay GROWS with the attempt number (exponential backoff)',
    actual: first.length && third.length
      ? `attempt 1 -> ~${median(first).toFixed(0)}ms, attempt 3 -> ~${median(third).toFixed(0)}ms`
      : `recorded delays for attempts ${[...new Set(w.store.backoffs.map((b) => b.attempts))].join(',')}`,
    pass: first.length > 3 && third.length > 3 && median(third) > median(first) * 1.5,
  });
  out.push({
    check: 'and it is JITTERED — twenty queued events do not all retry at the same instant',
    actual: `${new Set(first.map((d) => Math.round(d))).size} distinct delays across ${first.length} first retries`,
    pass: new Set(first.map((d) => Math.round(d))).size > Math.max(3, first.length / 3),
  });

  return out;
}
