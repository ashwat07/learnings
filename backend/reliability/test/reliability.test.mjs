/**
 * The contract for the reliability primitives. These tests ARE the specification.
 *
 *   npm run test:reliability
 *   node --test --test-name-pattern="breaker" reliability/test/
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  withTimeout, retry, createBreaker, createLogger, createMetrics,
  parseTraceparent, newTraceparent,
} from '../src/reliability.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
describe('timeouts', () => {
  test('a fast call passes through', async () => {
    const fn = withTimeout(async () => 'ok', 100);
    assert.equal(await fn(), 'ok');
  });

  test('a slow call rejects with ETIMEDOUT', async () => {
    const fn = withTimeout(async () => { await sleep(200); return 'too late'; }, 30);
    await assert.rejects(fn(), (e) => e.code === 'ETIMEDOUT',
      'the error must carry code ETIMEDOUT — a timeout is retryable, a 400 is not');
  });

  test('it aborts the underlying work, not just the wait', async () => {
    let aborted = false;
    const fn = withTimeout(async (signal) => {
      signal?.addEventListener('abort', () => { aborted = true; });
      await sleep(200);
    }, 30);
    await fn().catch(() => {});
    await sleep(20);
    assert.ok(aborted, 'fn must receive an AbortSignal — a timeout that leaves the request running has bounded only YOUR latency');
  });

  test('the timer does not keep the process alive', async () => {
    const fn = withTimeout(async () => 'fast', 60_000);
    const t0 = Date.now();
    await fn();
    assert.ok(Date.now() - t0 < 100, 'a settled call must clear its timer');
  });
});

// ---------------------------------------------------------------------------
describe('retries', () => {
  test('succeeds without retrying when the first call works', async () => {
    let calls = 0;
    await retry(async () => { calls++; return 'ok'; }, { attempts: 3 });
    assert.equal(calls, 1);
  });

  test('retries a transient failure and returns the eventual success', async () => {
    let calls = 0;
    const r = await retry(async () => {
      calls++;
      if (calls < 3) throw new Error('transient');
      return 'ok';
    }, { attempts: 5, baseMs: 5 });
    assert.equal(r, 'ok');
    assert.equal(calls, 3);
  });

  test('gives up after `attempts` and surfaces the last error', async () => {
    let calls = 0;
    await assert.rejects(
      retry(async () => { calls++; throw new Error(`fail-${calls}`); }, { attempts: 3, baseMs: 5 }),
      (e) => e.message === 'fail-3');
    assert.equal(calls, 3, 'exactly `attempts` calls, not attempts+1');
  });

  test('does NOT retry when isRetryable says no', async () => {
    let calls = 0;
    await assert.rejects(retry(async () => {
      calls++;
      throw Object.assign(new Error('bad request'), { status: 400 });
    }, { attempts: 5, baseMs: 5, isRetryable: (e) => e.status >= 500 }));
    assert.equal(calls, 1, 'a 400 will fail identically forever — retrying it is pure load');
  });

  test('backs off with JITTER, not a fixed delay', async () => {
    const delays = [];
    for (let run = 0; run < 6; run++) {
      let last = Date.now();
      await retry(async () => {
        const now = Date.now();
        if (last !== null) delays.push(now - last);
        last = now;
        throw new Error('nope');
      }, { attempts: 3, baseMs: 40 }).catch(() => {});
    }
    const meaningful = delays.filter((d) => d > 1);
    assert.ok(meaningful.length >= 4, 'there should be a delay between attempts');
    const unique = new Set(meaningful.map((d) => Math.round(d / 5)));
    assert.ok(unique.size > 1,
      'every backoff was the same length — without jitter, a fleet of clients retries in lockstep');
  });
});

// ---------------------------------------------------------------------------
describe('the circuit breaker', () => {
  const boom = async () => { throw new Error('downstream is down'); };

  test('passes calls through while closed', async () => {
    const b = createBreaker();
    assert.equal(await b.call(async () => 'ok'), 'ok');
    assert.equal(b.state, 'closed');
  });

  test('opens once the failure RATE exceeds the threshold', async () => {
    const b = createBreaker({ threshold: 0.5, windowSize: 10, cooldownMs: 200 });
    for (let i = 0; i < 10; i++) await b.call(boom).catch(() => {});
    assert.equal(b.state, 'open');
  });

  test('does NOT open on two unlucky calls in a low-traffic window', async () => {
    const b = createBreaker({ threshold: 0.5, windowSize: 20, cooldownMs: 200 });
    for (let i = 0; i < 18; i++) await b.call(async () => 'ok');
    await b.call(boom).catch(() => {});
    await b.call(boom).catch(() => {});
    assert.equal(b.state, 'closed', 'a rate, not a raw count — 2 failures in 20 is 10%');
  });

  test('fails FAST while open, without calling through', async () => {
    const b = createBreaker({ threshold: 0.5, windowSize: 4, cooldownMs: 500 });
    for (let i = 0; i < 4; i++) await b.call(boom).catch(() => {});

    let called = false;
    await assert.rejects(b.call(async () => { called = true; }), (e) => e.code === 'CIRCUIT_OPEN');
    assert.ok(!called, 'an open breaker must not call the downstream at all');
  });

  test('goes half-open after the cooldown and closes on a successful probe', async () => {
    const b = createBreaker({ threshold: 0.5, windowSize: 4, cooldownMs: 80 });
    for (let i = 0; i < 4; i++) await b.call(boom).catch(() => {});
    assert.equal(b.state, 'open');

    await sleep(120);
    assert.equal(await b.call(async () => 'recovered'), 'recovered');
    assert.equal(b.state, 'closed');
  });

  test('a failed probe re-opens the breaker', async () => {
    const b = createBreaker({ threshold: 0.5, windowSize: 4, cooldownMs: 80 });
    for (let i = 0; i < 4; i++) await b.call(boom).catch(() => {});
    await sleep(120);
    await b.call(boom).catch(() => {});
    assert.equal(b.state, 'open', 'the probe failed — go back to failing fast');
  });
});

// ---------------------------------------------------------------------------
describe('structured logging', () => {
  const capture = () => { const lines = []; return { lines, sink: (l) => lines.push(l) }; };
  const parse = (line) => JSON.parse(line);

  test('emits JSON with level, msg, time and service', () => {
    const { lines, sink } = capture();
    createLogger({ service: 'api', sink }).info('hello');
    const o = parse(lines[0]);
    assert.equal(o.level, 'info');
    assert.equal(o.msg, 'hello');
    assert.equal(o.service, 'api');
    assert.ok(!Number.isNaN(Date.parse(o.time)), 'time must be a parseable timestamp');
  });

  test('child bindings appear on every line', () => {
    const { lines, sink } = capture();
    const log = createLogger({ service: 'api', sink }).child({ requestId: 'req-123', userId: 7 });
    log.info('first');
    log.error('second');
    for (const line of lines) {
      const o = parse(line);
      assert.equal(o.requestId, 'req-123', 'a request id must reach every log line without being threaded through every function');
      assert.equal(o.userId, 7);
    }
  });

  test('REDACTS secrets at any depth', () => {
    const { lines, sink } = capture();
    createLogger({ service: 'api', sink }).info('login', {
      email: 'a@b.com',
      password: 'hunter2',
      headers: { authorization: 'Bearer abc123', 'content-type': 'application/json' },
      nested: { deep: { apiKey: 'sk_live_xxx' } },
    });
    const s = lines[0];
    assert.ok(!s.includes('hunter2'), 'password leaked into the logs');
    assert.ok(!s.includes('abc123'), 'authorization header leaked into the logs');
    assert.ok(!s.includes('sk_live_xxx'), 'a nested secret leaked into the logs');
    assert.ok(s.includes('a@b.com'), 'non-secret fields must survive');
    assert.ok(s.includes('application/json'), 'non-secret headers must survive');
  });

  test('serialises an Error properly', () => {
    const { lines, sink } = capture();
    createLogger({ service: 'api', sink }).error('failed', { err: new Error('boom') });
    const o = parse(lines[0]);
    assert.equal(o.err.message, 'boom', 'a bare Error JSON.stringifies to {} — it needs a serialiser');
    assert.ok(o.err.stack, 'keep the stack');
  });
});

// ---------------------------------------------------------------------------
describe('RED metrics', () => {
  test('reports count, errors and error rate per route', () => {
    const m = createMetrics();
    for (let i = 0; i < 8; i++) m.observe('GET /orders', 10, true);
    for (let i = 0; i < 2; i++) m.observe('GET /orders', 10, false);
    m.observe('GET /health', 1, true);

    const s = m.snapshot();
    assert.equal(s['GET /orders'].count, 10);
    assert.equal(s['GET /orders'].errors, 2);
    assert.ok(Math.abs(s['GET /orders'].errorRate - 0.2) < 1e-9);
    assert.equal(s['GET /health'].count, 1);
  });

  test('reports PERCENTILES, not an average', () => {
    const m = createMetrics();
    for (let i = 1; i <= 100; i++) m.observe('GET /orders', i, true);   // 1..100ms
    const s = m.snapshot()['GET /orders'];
    assert.ok(s.p50 >= 49 && s.p50 <= 52, `p50 was ${s.p50}, expected ~50`);
    assert.ok(s.p95 >= 94 && s.p95 <= 97, `p95 was ${s.p95}, expected ~95`);
    assert.ok(s.p99 >= 98 && s.p99 <= 100, `p99 was ${s.p99}, expected ~99`);
  });

  test('the tail is not hidden by the mean', () => {
    const m = createMetrics();
    for (let i = 0; i < 95; i++) m.observe('GET /slow', 5, true);       // 95% are fast
    for (let i = 0; i < 5; i++) m.observe('GET /slow', 5000, true);     // 5% are catastrophic
    const s = m.snapshot()['GET /slow'];

    const mean = (95 * 5 + 5 * 5000) / 100;                            // 255ms — looks tolerable
    assert.ok(s.p50 <= 10, `p50 was ${s.p50}, expected ~5`);
    assert.ok(s.p99 >= 1000,
      `p99 was ${s.p99}. One in twenty users waits five seconds; a mean of ${mean}ms hides that, ` +
      'which is why you alert on percentiles and never on an average.');
  });
});

// ---------------------------------------------------------------------------
describe('trace propagation', () => {
  const VALID = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

  test('parses a valid traceparent', () => {
    const t = parseTraceparent(VALID);
    assert.equal(t.traceId, '4bf92f3577b34da6a3ce929d0e0e4736');
    assert.equal(t.spanId, '00f067aa0ba902b7');
    assert.equal(t.sampled, true);
  });

  test('rejects malformed headers without throwing', () => {
    for (const bad of ['', 'garbage', '00-tooshort-00f067aa0ba902b7-01', undefined, null, '00-' + 'z'.repeat(32) + '-00f067aa0ba902b7-01']) {
      assert.equal(parseTraceparent(bad), null, `"${bad}" must parse to null, not crash the request`);
    }
  });

  test('a child span keeps the trace id and gets a NEW span id', () => {
    const child = parseTraceparent(newTraceparent(parseTraceparent(VALID)));
    assert.equal(child.traceId, '4bf92f3577b34da6a3ce929d0e0e4736', 'the trace id is what stitches services together');
    assert.notEqual(child.spanId, '00f067aa0ba902b7', 'each hop needs its own span id');
    assert.equal(child.sampled, true, 'the sampling decision must propagate, or you get half a trace');
  });

  test('starts a fresh trace when there is no parent', () => {
    const root = parseTraceparent(newTraceparent(null));
    assert.ok(root, 'must produce a valid header');
    assert.match(root.traceId, /^[0-9a-f]{32}$/);
    assert.notEqual(root.traceId, '0'.repeat(32), 'an all-zero trace id is invalid');
  });
});
