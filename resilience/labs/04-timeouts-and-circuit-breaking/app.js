// Lab 04 — Timeouts & circuit breaking.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

// ---------------------------------------------------------------------------
// Timeouts
// ---------------------------------------------------------------------------

on('none', async () => {
  log.head('— no timeout, against a 3s endpoint —');
  const t0 = performance.now();
  await fetch('/api/asset?name=slow&delay=3000');
  log.bad(`waited ${Math.round(performance.now() - t0)}ms because nothing stopped us`);
  out.textContent =
    'You waited the full three seconds. On a real network with no timeout you can wait for the\n' +
    "browser's default, which is measured in minutes.\n\n" +
    'The user-facing consequence is that SLOW AND BROKEN BECOME THE SAME EXPERIENCE — except slow\n' +
    'is worse, because they wait before finding out. Meanwhile you are holding a spinner, a\n' +
    'connection, and often a lock in your state layer.\n\n' +
    'fetch() has no default timeout. This is a deliberate platform choice and a permanent\n' +
    'foot-gun: every fetch in your codebase without a signal can hang.';
});

on('fixed', async () => {
  log.head('— 1s timeout against the same 3s endpoint —');
  const t0 = performance.now();
  try {
    // AbortSignal.timeout() aborts with a TimeoutError, which is distinguishable from a user
    // cancel — worth having when you are deciding whether to retry.
    await fetch('/api/asset?name=slow&delay=3000', { signal: AbortSignal.timeout(1000) });
  } catch (e) {
    log.ok(`aborted after ${Math.round(performance.now() - t0)}ms (${e.name})`);
  }
  out.textContent =
    'One second, then a decision instead of a wait.\n\n' +
    'CHOOSING THE NUMBER. There is no value derivable from the network; you are answering "how long\n' +
    'is waiting still useful to this person?" Rough starting points:\n\n' +
    '  a page widget          1–3s, then degrade (lab 03)\n' +
    '  a user-initiated save  5–10s — they are watching, and a false failure costs them work\n' +
    '  a background sync      30s+ — nobody is waiting\n' +
    '  a health check         under the interval, or you queue checks on top of each other\n\n' +
    'Then measure: set the timeout above your p99 latency, not your median. A timeout below p99\n' +
    'converts your slowest legitimate requests into errors, which usually causes retries, which\n' +
    'usually causes more slowness. That feedback loop is a classic self-inflicted outage.\n\n' +
    'And distinguish the two clocks: a CONNECT timeout (can I reach it at all?) can be short; a\n' +
    'RESPONSE timeout (is it still working?) has to accommodate real work.';
});

on('hedged', async () => {
  log.head('— hedged request: fire a second attempt if the first is slow —');
  const t0 = performance.now();
  const attempt = (label, url) => fetch(url).then((r) => ({ label, r }));
  const first = attempt('first', '/api/asset?name=hedge1&delay=2000');
  const hedge = new Promise((resolve) => setTimeout(resolve, 400))
    .then(() => attempt('hedge', '/api/asset?name=hedge2&delay=100'));
  const winner = await Promise.race([first, hedge]);
  log.ok(`${winner.label} won after ${Math.round(performance.now() - t0)}ms`);
  out.textContent =
    'A HEDGED REQUEST: if the first attempt has not answered within a threshold (here 400ms), send\n' +
    'a second one and take whichever answers first.\n\n' +
    'It is the standard technique for cutting tail latency — the p99 is usually one unlucky\n' +
    'request, not a slow system, and a second attempt often lands on a healthy server.\n\n' +
    'The rules that keep it from becoming an outage:\n' +
    '  · ONLY FOR IDEMPOTENT OPERATIONS. This is a retry that runs concurrently with the original.\n' +
    '  · SET THE THRESHOLD AT ROUGHLY p95, so you hedge ~5% of requests, not all of them.\n' +
    '  · CAP THE EXTRA LOAD. Hedging every request doubles your traffic; under load that is\n' +
    '    exactly the wrong direction, so disable hedging when the error rate rises.\n' +
    '  · CANCEL THE LOSER (AbortController), or you pay for both anyway.';
});

// ---------------------------------------------------------------------------
// A circuit breaker in 30 lines.
// ---------------------------------------------------------------------------

const breaker = {
  state: 'closed', failures: 0, threshold: 4, cooldown: 5000, openedAt: 0,
  calls: 0, skipped: 0,
};

function paint() {
  $('state').textContent = breaker.state.toUpperCase();
  $('state').className = `state ${breaker.state === 'closed' ? 'closed' : breaker.state === 'open' ? 'open' : 'half'}`;
  $('fails').textContent = breaker.failures;
  $('calls').textContent = breaker.calls;
  $('skipped').textContent = breaker.skipped;
}
paint();

async function call(url) {
  if (breaker.state === 'open') {
    if (Date.now() - breaker.openedAt > breaker.cooldown) {
      // HALF-OPEN: let exactly one probe through. If it succeeds, close; if it fails, open again.
      breaker.state = 'half-open';
      log.muted('cooldown elapsed → half-open: allowing one probe');
    } else {
      breaker.skipped++; paint();
      throw new Error('circuit open — failing fast without calling the service');
    }
  }
  breaker.calls++;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1200) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    breaker.failures = 0;
    if (breaker.state !== 'closed') log.ok('probe succeeded → closed');
    breaker.state = 'closed';
    paint();
    return r;
  } catch (e) {
    breaker.failures++;
    if (breaker.state === 'half-open' || breaker.failures >= breaker.threshold) {
      breaker.state = 'open';
      breaker.openedAt = Date.now();
      log.bad(`breaker OPEN for ${breaker.cooldown}ms`);
    }
    paint();
    throw e;
  }
}

on('cb-fail', async () => {
  log.head('— 6 requests to a service that is down —');
  for (let i = 1; i <= 6; i++) {
    try { await call('/api/asset?name=dead&status=503'); log.ok(`#${i} ok`); }
    catch (e) { log.bad(`#${i} ${e.message}`); }
  }
  out.textContent =
    'The first four called the dead service and failed. The last two did not call it at all — the\n' +
    'breaker opened and failed fast.\n\n' +
    'Failing fast is the point. When a dependency is down for EVERYONE, more requests do not help\n' +
    'you and actively hurt it: they consume its connection pool, its threads and its recovery\n' +
    'headroom. A breaker converts "a thousand clients hammering a dying service" into "a thousand\n' +
    'clients showing a fallback and one probe every five seconds".\n\n' +
    'It also improves YOUR latency: a fast failure lets you render the fallback immediately\n' +
    'instead of after a timeout, which is often the difference between a degraded page and a\n' +
    'frozen one.';
});

on('cb-try', async () => {
  try { await call('/api/asset?name=dead&status=503'); }
  catch (e) { log.bad(e.message); }
  out.textContent =
    'Rejected without a network call at all — look at the "calls skipped" counter.\n\n' +
    'THE THREE STATES:\n' +
    '  CLOSED     normal. Count failures.\n' +
    '  OPEN       fail immediately for a cooldown. No traffic reaches the dependency.\n' +
    '  HALF-OPEN  after the cooldown, let exactly ONE request through as a probe. Success closes\n' +
    '             the breaker; failure re-opens it and restarts the cooldown.\n\n' +
    'Half-open is the state that makes it safe to recover. Without it, the breaker either stays\n' +
    'open forever or dumps the full restored load onto a service that has just come back — which\n' +
    'knocks it over again.';
});

on('cb-recover', async () => {
  log.head('— the service is healthy again —');
  breaker.openedAt = 0;                       // pretend the cooldown elapsed
  try { await call('/api/asset?name=alive'); log.ok('recovered'); }
  catch (e) { log.bad(e.message); }
  out.textContent =
    'The probe succeeded, the breaker closed, and traffic resumes.\n\n' +
    'What to tune, and what each knob costs:\n' +
    '  THRESHOLD    too low and a transient blip degrades your page unnecessarily; too high and you\n' +
    '               hammer a dying service. Prefer a FAILURE RATE over a raw count (e.g. >50% of\n' +
    '               the last 20 calls) so a low-traffic path does not trip on two unlucky requests.\n' +
    '  COOLDOWN     long enough for the dependency to actually recover; short enough that you are\n' +
    '               not showing a fallback after it is healthy. Seconds, not minutes.\n' +
    '  SCOPE        one breaker PER DEPENDENCY, never one for the whole app. A shared breaker means\n' +
    '               a broken recommendations service stops your checkout calls.\n\n' +
    'On the front end, the honest caveat: a breaker in one browser tab only protects that tab. Its\n' +
    'value is mostly LOCAL — fast failure and a calm UI — while the load-shedding benefit only\n' +
    'materialises because every client is running the same logic. The place a breaker does real\n' +
    'protective work is your BFF or gateway, where one process sees the aggregate error rate.';
});

on('rules', () => {
  renderTable('#results', [
    { rule: 'every fetch has a timeout', why: 'fetch() has none by default; a hung request holds a spinner forever' },
    { rule: 'timeout above p99, not p50', why: 'a tight timeout converts slow-but-fine into errors, which cause retries' },
    { rule: 'different timeouts per tier', why: 'a decorative widget and a payment do not deserve the same patience' },
    { rule: 'a breaker per dependency', why: 'one shared breaker turns one outage into all of them' },
    { rule: 'failure RATE, not count', why: 'a low-traffic path should not trip on two unlucky calls' },
    { rule: 'half-open probes, one at a time', why: 'otherwise recovery re-kills the service' },
    { rule: 'always have a fallback behind the breaker', why: 'failing fast into a blank screen is not an improvement' },
  ], { columns: ['rule', 'why'] });
  out.textContent =
    'The last row is the one to hold on to. A circuit breaker makes failure FAST; it does not make\n' +
    'it GOOD. Fast failure into an empty page is a worse experience than a slow success.\n\n' +
    'So the pattern is always a pair: BREAKER + FALLBACK. Cached data with a timestamp, a static\n' +
    'default, a reduced feature, a queued write. The breaker buys you the time to show it\n' +
    'immediately instead of after a timeout.';
});

on('clear', () => { log.clear(); breaker.state = 'closed'; breaker.failures = 0; breaker.calls = 0; breaker.skipped = 0; paint(); });
