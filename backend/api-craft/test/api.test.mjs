/**
 * The contract. These tests ARE the specification — when a TODO in server.mjs is ambiguous, the
 * assertion here is the answer.
 *
 *   node --test api-craft/test/
 *   node --test --test-name-pattern="idempot" api-craft/test/
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { build, ORDER_STATUSES } from '../src/server.mjs';
import { sql } from '../../lib/db.mjs';

// Tests must be isolated and re-runnable. Every POST in this file uses an amount unique to THIS
// run, so assertions can count rows without seeing what a previous run left behind — and the
// `after` hook removes them anyway.
const RUN = Math.floor(Math.random() * 900000) + 100000;
const amount = (n) => RUN * 10 + n;

let app;
before(async () => {
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS idempotency_keys (
      key text PRIMARY KEY,
      request_hash text NOT NULL,
      response_status int NOT NULL,
      response_body jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now())`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_api_orders ON orders (created_at DESC, id DESC)`);
  app = build();
  await app.ready();
});
after(async () => {
  await app.close();
  await sql`DELETE FROM orders WHERE total_cents >= ${RUN * 10} AND total_cents < ${RUN * 10 + 10}`;
  await sql.unsafe('DROP TABLE IF EXISTS idempotency_keys');
  await sql.end();
});

const call = (opts) => app.inject(opts);
const json = (res) => JSON.parse(res.body);

// ---------------------------------------------------------------------------
describe('health and readiness', () => {
  test('GET /healthz is 200 and cheap', async () => {
    const res = await call({ method: 'GET', url: '/healthz' });
    assert.equal(res.statusCode, 200);
    assert.equal(json(res).status, 'ok');
  });

  test('GET /readyz checks the database', async () => {
    const res = await call({ method: 'GET', url: '/readyz' });
    assert.equal(res.statusCode, 200);
    assert.equal(json(res).status, 'ready');
  });

  test('GET /readyz reports NOT ready once shutdown begins', async () => {
    const a = build();
    await a.ready();
    a.beginShutdown();
    const res = await a.inject({ method: 'GET', url: '/readyz' });
    await a.close();
    assert.equal(res.statusCode, 503, 'a draining instance must fail readiness so the LB stops sending traffic');
    assert.equal(json(res).status, 'not_ready');
  });
});

// ---------------------------------------------------------------------------
describe('GET /orders — listing and pagination', () => {
  test('returns a data array and a nextCursor', async () => {
    const res = await call({ method: 'GET', url: '/orders?limit=5' });
    assert.equal(res.statusCode, 200);
    const body = json(res);
    assert.ok(Array.isArray(body.data), 'body.data must be an array');
    assert.equal(body.data.length, 5);
    assert.ok('nextCursor' in body, 'body must have nextCursor (string or null)');
  });

  test('the cursor actually pages, with no overlap and no gaps', async () => {
    const first = json(await call({ method: 'GET', url: '/orders?limit=10' }));
    const second = json(await call({ method: 'GET', url: `/orders?limit=10&cursor=${encodeURIComponent(first.nextCursor)}` }));
    const ids1 = first.data.map((o) => String(o.id));
    const ids2 = second.data.map((o) => String(o.id));
    assert.equal(new Set([...ids1, ...ids2]).size, 20, 'pages must not overlap');
    const twenty = json(await call({ method: 'GET', url: '/orders?limit=20' }));
    assert.deepEqual([...ids1, ...ids2], twenty.data.map((o) => String(o.id)), 'two pages of 10 must equal one page of 20');
  });

  test('pagination is KEYSET, not OFFSET', async () => {
    // An offset implementation degrades with depth; keyset does not. Ten pages deep must still
    // be fast, and must still be correct.
    let cursor = null;
    for (let i = 0; i < 10; i++) {
      const url = `/orders?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const body = json(await call({ method: 'GET', url }));
      assert.equal(body.data.length, 20, `page ${i + 1} must be full`);
      cursor = body.nextCursor;
      assert.ok(cursor, `page ${i + 1} must return a cursor`);
    }
  });

  test('filters by status', async () => {
    const body = json(await call({ method: 'GET', url: '/orders?limit=25&status=cancelled' }));
    assert.ok(body.data.length > 0);
    assert.ok(body.data.every((o) => o.status === 'cancelled'));
  });

  test('rejects an invalid limit with 400 and field details', async () => {
    const res = await call({ method: 'GET', url: '/orders?limit=9999' });
    assert.equal(res.statusCode, 400);
    const body = json(res);
    assert.equal(body.error.code, 'validation_error');
    assert.ok(body.error.details, 'a validation error must say WHICH field');
    assert.ok(JSON.stringify(body.error.details).includes('limit'));
  });

  test('rejects an unknown status with 400', async () => {
    const res = await call({ method: 'GET', url: '/orders?status=teleported' });
    assert.equal(res.statusCode, 400);
    assert.equal(json(res).error.code, 'validation_error');
  });

  test('a malformed cursor is a 400, not a 500', async () => {
    const res = await call({ method: 'GET', url: '/orders?cursor=not-a-real-cursor' });
    assert.equal(res.statusCode, 400, 'user input must never produce a 500');
    assert.equal(json(res).error.code, 'validation_error');
  });
});

// ---------------------------------------------------------------------------
describe('GET /orders/:id', () => {
  test('returns the order', async () => {
    const list = json(await call({ method: 'GET', url: '/orders?limit=1' }));
    const id = list.data[0].id;
    const res = await call({ method: 'GET', url: `/orders/${id}` });
    assert.equal(res.statusCode, 200);
    assert.equal(String(json(res).id), String(id));
  });

  test('404 for an id that does not exist', async () => {
    const res = await call({ method: 'GET', url: '/orders/999999999' });
    assert.equal(res.statusCode, 404);
    assert.equal(json(res).error.code, 'not_found');
  });

  test('400 for a non-numeric id — not a 500', async () => {
    const res = await call({ method: 'GET', url: '/orders/abc' });
    assert.equal(res.statusCode, 400);
    assert.equal(json(res).error.code, 'validation_error');
  });
});

// ---------------------------------------------------------------------------
describe('POST /orders — validation', () => {
  test('creates an order and returns 201 with Location', async () => {
    const res = await call({ method: 'POST', url: '/orders', payload: { userId: 1, totalCents: amount(1) } });
    assert.equal(res.statusCode, 201);
    const body = json(res);
    assert.ok(body.id, 'the created order must be returned');
    assert.equal(body.status, 'pending', 'status must default to pending');
    assert.ok(res.headers.location?.includes(String(body.id)), 'a 201 must carry a Location header');
  });

  test('rejects a missing field with per-field details', async () => {
    const res = await call({ method: 'POST', url: '/orders', payload: { userId: 1 } });
    assert.equal(res.statusCode, 400);
    const body = json(res);
    assert.equal(body.error.code, 'validation_error');
    assert.ok(JSON.stringify(body.error.details).includes('totalCents'));
  });

  test('rejects a negative amount', async () => {
    const res = await call({ method: 'POST', url: '/orders', payload: { userId: 1, totalCents: -1 } });
    assert.equal(res.statusCode, 400);
  });

  test('rejects an unknown status', async () => {
    const res = await call({ method: 'POST', url: '/orders', payload: { userId: 1, totalCents: 1, status: 'teleported' } });
    assert.equal(res.statusCode, 400);
    assert.ok(ORDER_STATUSES.length > 0);
  });

  test('malformed JSON is a 400, not a 500', async () => {
    const res = await call({ method: 'POST', url: '/orders', payload: '{"userId": 1,', headers: { 'content-type': 'application/json' } });
    assert.equal(res.statusCode, 400);
  });
});

// ---------------------------------------------------------------------------
describe('POST /orders — idempotency', () => {
  const key = () => `test-${Math.random().toString(36).slice(2)}`;

  test('a repeated key does not create a second order', async () => {
    const k = key();
    const payload = { userId: 2, totalCents: amount(2) };
    const first = await call({ method: 'POST', url: '/orders', payload, headers: { 'idempotency-key': k } });
    const second = await call({ method: 'POST', url: '/orders', payload, headers: { 'idempotency-key': k } });

    assert.equal(first.statusCode, 201);
    assert.ok([200, 201].includes(second.statusCode), 'a replay returns the original response');
    assert.equal(json(second).id, json(first).id, 'the replay must return the ORIGINAL order, not a new one');

    const [{ n }] = await sql`SELECT count(*)::int AS n FROM orders WHERE total_cents = ${amount(2)}`;
    assert.equal(n, 1, 'exactly one order may exist for this key');
  });

  test('the same key with a different body is a 409', async () => {
    const k = key();
    await call({ method: 'POST', url: '/orders', payload: { userId: 3, totalCents: amount(3) }, headers: { 'idempotency-key': k } });
    const res = await call({ method: 'POST', url: '/orders', payload: { userId: 3, totalCents: amount(4) }, headers: { 'idempotency-key': k } });
    assert.equal(res.statusCode, 409, 'reusing a key for a different request is a client bug and must be loud');
    assert.equal(json(res).error.code, 'idempotency_key_reuse');
  });

  test('concurrent replays of one key still create exactly one order', async () => {
    const k = key();
    const payload = { userId: 4, totalCents: amount(5) };
    const results = await Promise.all(Array.from({ length: 8 }, () =>
      call({ method: 'POST', url: '/orders', payload, headers: { 'idempotency-key': k } })));
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM orders WHERE total_cents = ${amount(5)}`;
    assert.equal(n, 1, 'eight simultaneous retries must produce ONE order');
    const ids = new Set(results.filter((r) => r.statusCode < 300).map((r) => String(json(r).id)));
    assert.equal(ids.size, 1, 'every successful response must describe the same order');
  });
});

// ---------------------------------------------------------------------------
describe('cross-cutting', () => {
  test('an unknown route returns the error envelope', async () => {
    const res = await call({ method: 'GET', url: '/nope' });
    assert.equal(res.statusCode, 404);
    assert.equal(json(res).error.code, 'not_found', 'even 404s use one envelope');
  });

  test('every response carries x-request-id', async () => {
    const res = await call({ method: 'GET', url: '/healthz' });
    assert.ok(res.headers['x-request-id'], 'a request id is how a user quotes an error to support');
  });

  test('an inbound x-request-id is echoed, not replaced', async () => {
    const res = await call({ method: 'GET', url: '/healthz', headers: { 'x-request-id': 'trace-abc-123' } });
    assert.equal(res.headers['x-request-id'], 'trace-abc-123', 'ids must survive across services');
  });

  test('an internal error never leaks the exception', async () => {
    const a = build();
    a.get('/boom', async () => { throw new Error('SELECT * FROM secret_table failed at /srv/app/db.js:42'); });
    await a.ready();
    const res = await a.inject({ method: 'GET', url: '/boom' });
    await a.close();
    assert.equal(res.statusCode, 500);
    const body = json(res);
    assert.equal(body.error.code, 'internal_error');
    assert.ok(!JSON.stringify(body).includes('secret_table'), 'never return the exception text');
    assert.ok(!JSON.stringify(body).includes('/srv/app'), 'never return file paths');
  });
});
