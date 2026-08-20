/**
 * Lab 01 — Bulkheads: stopping one broken dependency from taking the rest with it.
 *
 *   node reliability/labs/01-bulkheads/lab.mjs
 *
 * A bulkhead is the wall between compartments in a ship's hull: flood one, the ship floats. In a
 * service it is a RESOURCE LIMIT PER DEPENDENCY, and the reason it matters is that shared
 * resources — a connection pool, a thread pool, an event loop — are how a failure in the thing
 * you did not care about takes down the thing you did.
 *
 * Four configurations, the same traffic through each, measured. The numbers are the lab.
 */

import { createBreaker } from '../../src/reliability.reference.mjs';
import { rule, note, table, good, bad } from '../../../lib/console.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0);

// ---------------------------------------------------------------------------
// The world: two downstream services and a fixed traffic mix.

const DEPS = {
  // The one that works. A cache, a local database, the 95% of your traffic that is fine.
  fast: { latency: () => 5, fails: false },
  // The one that has broken in the way that hurts most: not erroring, just not answering.
  // An error is easy — you get it back immediately and free the slot. A hang holds the resource.
  slow: { latency: () => 3000, fails: false },
};

const callDependency = async (name, { signal } = {}) => {
  const dep = DEPS[name];
  const ms = dep.latency();
  await new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { code: 'ETIMEDOUT' })); }, { once: true });
  });
  if (dep.fails) throw new Error(`${name} failed`);
  return name;
};

/** A semaphore. This IS the bulkhead — everything else in this lab is how you arrange them. */
function semaphore(size) {
  let free = size;
  const queue = [];
  return {
    async acquire() {
      if (free > 0) { free--; return; }
      await new Promise((r) => queue.push(r));
    },
    release() {
      const next = queue.shift();
      if (next) next(); else free++;
    },
    get waiting() { return queue.length; },
    get inUse() { return size - free - queue.length > 0 ? size - free : size - free; },
  };
}

const DURATION = 2500;
const CLIENTS = 60;
const SLOW_SHARE = 0.5;      // half the traffic goes to the broken dependency
const REQUEST_TIMEOUT = 400;

/**
 * One experiment. `call(name)` is the thing under test — whichever isolation strategy we are
 * measuring — and everything else is identical between runs.
 */
async function experiment(label, call) {
  const stats = {
    fast: { ok: 0, failed: 0, lat: [] },
    slow: { ok: 0, failed: 0, lat: [] },
  };
  const until = Date.now() + DURATION;

  const client = async (i) => {
    while (Date.now() < until) {
      const name = i % Math.round(1 / SLOW_SHARE) === 0 ? 'slow' : 'fast';
      const t0 = performance.now();
      try {
        await call(name);
        stats[name].ok++;
      } catch {
        stats[name].failed++;
      }
      stats[name].lat.push(performance.now() - t0);
      await sleep(2);
    }
  };
  await Promise.all(Array.from({ length: CLIENTS }, (_, i) => client(i)));

  const f = stats.fast, s = stats.slow;
  return {
    label,
    'fast ok': f.ok,
    'fast failed': f.failed,
    'fast p99': `${pct(f.lat, 0.99).toFixed(0)}ms`,
    'slow ok': s.ok,
    'slow failed': s.failed,
  };
}

rule('THE SETUP');
console.log(`
  Two dependencies. "fast" answers in 5ms. "slow" takes 3 seconds — it has not failed, it is just
  not answering, which is the failure mode that actually hurts: an error returns immediately and
  frees your resources; a hang keeps them.

  ${CLIENTS} concurrent clients for ${DURATION}ms, half the requests to each dependency, a
  ${REQUEST_TIMEOUT}ms request timeout where one is used. Only the isolation strategy changes.`);

const results = [];

// ---------------------------------------------------------------------------
rule('1. one shared pool, no timeout — the default');
{
  const pool = semaphore(10);
  const call = async (name) => {
    await pool.acquire();
    try { return await callDependency(name); }
    finally { pool.release(); }
  };
  const r = await experiment('shared pool of 10, no timeout', call);
  results.push(r);
  table([r], Object.keys(r));
  console.log(`
  Look at "fast ok". The fast dependency is healthy, answering in 5ms, and it is starved — because
  the ten slots in the shared pool are occupied by requests waiting three seconds on something
  else. Fast requests do not fail; they QUEUE, behind work that has nothing to do with them.

  This is the shape of most real incidents: a non-critical dependency degrades, and your whole
  service degrades with it. Your dashboards show the healthy endpoint slow, and its own
  dependencies all look fine, because they are.`);
}

// ---------------------------------------------------------------------------
rule('2. one shared pool, with a timeout');
{
  const pool = semaphore(10);
  const call = async (name) => {
    await pool.acquire();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT);
    try { return await callDependency(name, { signal: ac.signal }); }
    finally { clearTimeout(timer); pool.release(); }
  };
  const r = await experiment(`shared pool of 10, ${REQUEST_TIMEOUT}ms timeout`, call);
  results.push(r);
  table([r], Object.keys(r));
  console.log(`
  Better, and not enough. The timeout caps how long a slot is held — 400ms instead of 3,000 — so
  fast requests get through roughly seven times more often. But every slow request still occupies
  a shared slot for 400ms before giving up, so half your capacity is still being spent on
  something that is going to fail.

  A timeout bounds the DAMAGE PER REQUEST. It does not stop a failing dependency consuming a share
  of a shared resource proportional to its traffic. That is what a bulkhead is for.`);
}

// ---------------------------------------------------------------------------
rule('3. a bulkhead: one pool per dependency');
{
  const pools = { fast: semaphore(8), slow: semaphore(2) };
  const call = async (name) => {
    await pools[name].acquire();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT);
    try { return await callDependency(name, { signal: ac.signal }); }
    finally { clearTimeout(timer); pools[name].release(); }
  };
  const r = await experiment('separate pools: fast 8, slow 2', call);
  results.push(r);
  table([r], Object.keys(r));
  console.log(`
  The same total capacity — ten slots — split by dependency instead of shared. The fast
  dependency now has eight slots that the slow one cannot touch, and its throughput is back to
  what the dependency itself can support.

  Note what happened to the slow one: it got WORSE, and that is the point, not a side effect. Its
  two slots are permanently full, so most of its requests are rejected before they are even
  attempted. You have chosen to sacrifice the broken dependency to protect the healthy one — and
  that is a decision you should be making deliberately, at design time, rather than discovering
  it during an incident.

  SIZING THE COMPARTMENTS is the same arithmetic as a pool (postgres lab 09), applied per
  dependency: how much concurrency does this dependency support, and how much of my capacity am I
  willing to spend on it in the worst case? A dependency that is nice-to-have gets a small
  bulkhead precisely so that its worst case is small.`);
}

// ---------------------------------------------------------------------------
rule('4. bulkhead + circuit breaker — stop paying for the timeout');
{
  const pools = { fast: semaphore(8), slow: semaphore(2) };
  const breakers = {
    fast: createBreaker({ threshold: 0.5, cooldownMs: 500, windowSize: 10 }),
    slow: createBreaker({ threshold: 0.5, cooldownMs: 500, windowSize: 10 }),
  };
  const call = async (name) => breakers[name].call(async () => {
    await pools[name].acquire();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT);
    try { return await callDependency(name, { signal: ac.signal }); }
    finally { clearTimeout(timer); pools[name].release(); }
  });
  const r = await experiment('bulkhead + breaker', call);
  results.push(r);
  table([r], Object.keys(r));

  console.log(`
  The breaker notices that the slow dependency is failing and stops calling it — so its requests
  fail in MICROSECONDS instead of after a 400ms timeout. Compare "slow failed" here with section
  3: the same outcome for the caller, at a fraction of the cost, and the two slots stop being
  occupied at all.

  Note the ORDER: the breaker is OUTSIDE the pool. A breaker inside the pool would still make you
  acquire a slot before discovering the circuit is open, which defeats most of the point. Wrap
  outermost:  breaker( bulkhead( timeout( retry( call ) ) ) ).

  And retry goes INNERMOST, which is the counterintuitive one — a retry outside the breaker
  multiplies your load on a dependency that is already failing, which is exactly the amplification
  the breaker exists to prevent.`);
}

// ---------------------------------------------------------------------------
rule('the four configurations, side by side');
table(results, Object.keys(results[0]));
{
  const base = results[0]['fast ok'];
  const best = results[results.length - 1]['fast ok'];
  console.log(`
  ${(best / Math.max(base, 1)).toFixed(1)}x more healthy requests served, with the same total
  capacity and the same broken dependency. Nothing about the slow dependency was fixed.`);
}

rule('where bulkheads already exist, and where you have to build them');
table([
  { layer: 'Kubernetes', 'the bulkhead': 'CPU/memory limits per pod, and separate DEPLOYMENTS per criticality', 'what it isolates': 'a noisy neighbour, and a crash' },
  { layer: 'Database', 'the bulkhead': 'a separate pool — or a separate ROLE with its own connection limit — for reports', 'what it isolates': 'analytics eating the connections your API needs' },
  { layer: 'HTTP client', 'the bulkhead': 'an Agent per host, with its own maxSockets', 'what it isolates': 'one slow third party consuming all your sockets' },
  { layer: 'Worker queues', 'the bulkhead': 'a separate queue and worker set per job type', 'what it isolates': 'a slow report job blocking password-reset emails' },
  { layer: 'Node event loop', 'the bulkhead': 'worker_threads for CPU-bound work', 'what it isolates': 'one expensive request stalling every other one' },
  { layer: 'Your code', 'the bulkhead': 'a semaphore per dependency — the 12 lines at the top of this file', 'what it isolates': 'everything above that you do not control' },
], ['layer', 'the bulkhead', 'what it isolates']);

console.log(`
  THE DECISION A BULKHEAD FORCES YOU TO MAKE, and it is the valuable part:

  Which of my dependencies is allowed to take me down with it?

  Almost every service has a small number of dependencies it genuinely cannot serve without — its
  primary database, its auth provider — and a long tail it can. The tail is where the outages come
  from, because nobody assigned it a failure budget. Ranking your dependencies and giving the
  optional ones small compartments is an afternoon's work and removes a whole category of incident.

  WHAT TO DO WHEN A BULKHEAD IS FULL — and "queue" is usually the wrong answer:

    SHED           reject immediately with 503 and Retry-After. Honest, fast, and lets the caller
                   decide. An unbounded queue is a timeout with extra steps: the request sits
                   there until the client has already given up, and you do the work anyway.
    DEGRADE        serve the page without the recommendations, the profile without the badge
                   count. The best answer when the dependency is genuinely optional — and it
                   requires that somebody decided, in advance, what the page looks like without it.
    QUEUE BRIEFLY  a bounded queue with a short deadline absorbs a burst. Bounded and short, both.

  Whichever you choose, it belongs in the code path, not in a runbook. A bulkhead whose full
  behaviour is "wait" has not isolated anything — it has moved the queue somewhere you cannot see
  it, which is the same mistake as an oversized connection pool.

  AND THE HONEST COST
  Splitting ten slots into 8 + 2 means that when the slow dependency is HEALTHY, you can no longer
  burst it to ten. Bulkheads trade peak utilisation for predictability. That is almost always the
  right trade for a service with an SLO, and it is a real trade — you are choosing to leave
  capacity idle so that it is available when something breaks.

  Related: ../../node-runtime/drills/12-connection-pool/ (the pool, with acquire timeouts),
  ../src/reliability.reference.mjs (the breaker used above),
  ../../postgres/labs/09-pooling-and-replicas/ (why the shared pool is small in the first place).
`);
