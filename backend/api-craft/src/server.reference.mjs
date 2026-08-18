/**
 * The reference implementation. Read it AFTER you have made the suite pass yourself — the value
 * is in the twenty minutes of getting the idempotency transaction right, not in reading mine.
 */

import Fastify from 'fastify';
import crypto from 'node:crypto';
import { z } from 'zod';
import { sql } from '../../lib/db.mjs';

export const ORDER_STATUSES = ['pending', 'paid', 'shipped', 'delivered', 'cancelled'];
export const errorBody = ({ code, message, details }) => ({ error: { code, message, ...(details ? { details } : {}) } });

const encodeCursor = (row) => Buffer.from(JSON.stringify([row.created_at, String(row.id)])).toString('base64url');
const decodeCursor = (c) => {
  const [createdAt, id] = JSON.parse(Buffer.from(c, 'base64url').toString());
  if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) throw new Error('bad cursor');
  return { createdAt, id };
};

export function build({ logger = false } = {}) {
  const app = Fastify({ logger, disableRequestLogging: !logger, genReqId: (req) => req.headers['x-request-id'] ?? crypto.randomUUID() });
  let shuttingDown = false;

  // The request id, on every response, reusing the inbound one so a trace survives across services.
  app.addHook('onRequest', async (req, reply) => { reply.header('x-request-id', req.id); });

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/readyz', async (req, reply) => {
    if (shuttingDown) return reply.code(503).send({ status: 'not_ready', reason: 'draining' });
    try { await sql`SELECT 1`; }
    catch { return reply.code(503).send({ status: 'not_ready', reason: 'database unreachable' }); }
    return reply.code(200).send({ status: 'ready' });
  });

  const listQuery = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(ORDER_STATUSES).optional(),
    cursor: z.string().optional(),
  });

  app.get('/orders', async (req, reply) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send(errorBody({ code: 'validation_error', message: 'Invalid query parameters', details: parsed.error.flatten().fieldErrors }));
    }
    const { limit, status, cursor } = parsed.data;

    let after = null;
    if (cursor) {
      try { after = decodeCursor(cursor); }
      catch { return reply.code(400).send(errorBody({ code: 'validation_error', message: 'Malformed cursor', details: { cursor: ['not a valid cursor'] } })); }
    }

    // KEYSET pagination: (created_at, id) < (cursor) — constant time at any depth, and correct
    // under concurrent inserts. See postgres lab 08.
    const rows = await sql`
      SELECT id, user_id, status, total_cents, created_at FROM orders
      WHERE ${status ? sql`status = ${status}` : sql`true`}
        AND ${after ? sql`(created_at, id) < (${after.createdAt}::timestamptz, ${after.id}::bigint)` : sql`true`}
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit + 1}`;                       // fetch one extra to know if there is a next page

    const hasMore = rows.length > limit;
    const data = rows.slice(0, limit);
    return reply.send({ data, nextCursor: hasMore ? encodeCursor(data.at(-1)) : null });
  });

  app.get('/orders/:id', async (req, reply) => {
    const id = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!id.success) return reply.code(400).send(errorBody({ code: 'validation_error', message: 'id must be a positive integer', details: { id: ['not a number'] } }));
    const [row] = await sql`SELECT id, user_id, status, total_cents, created_at FROM orders WHERE id = ${id.data}`;
    if (!row) return reply.code(404).send(errorBody({ code: 'not_found', message: 'Order not found' }));
    return reply.send(row);
  });

  const createBody = z.object({
    userId: z.number().int().positive(),
    totalCents: z.number().int().positive(),
    status: z.enum(ORDER_STATUSES).default('pending'),
  });

  app.post('/orders', async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send(errorBody({ code: 'validation_error', message: 'Invalid request body', details: parsed.error.flatten().fieldErrors }));
    }
    const body = parsed.data;
    const key = req.headers['idempotency-key'];
    const hash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');

    if (!key) {
      const row = await insert(body);
      return reply.code(201).header('location', `/orders/${row.id}`).send(row);
    }

    // The claim and the write happen in ONE transaction — the same argument as the outbox drill.
    // ON CONFLICT DO NOTHING + RETURNING is an atomic claim, so eight simultaneous retries
    // produce exactly one winner with no SELECT-then-INSERT race.
    let created = null;
    await sql.begin(async (tx) => {
      const claimed = await tx`
        INSERT INTO idempotency_keys (key, request_hash, response_status, response_body)
        VALUES (${key}, ${hash}, 201, '{}'::jsonb)
        ON CONFLICT (key) DO NOTHING RETURNING key`;
      if (claimed.length === 0) return;
      const [row] = await tx`INSERT INTO orders (user_id, status, total_cents, created_at)
                             VALUES (${body.userId}, ${body.status}, ${body.totalCents}, now())
                             RETURNING id, user_id, status, total_cents, created_at`;
      await tx`UPDATE idempotency_keys SET response_body = ${tx.json(row)} WHERE key = ${key}`;
      created = row;
    });

    if (created) return reply.code(201).header('location', `/orders/${created.id}`).send(created);

    // A replay. Wait briefly for the winner to finish writing its response body.
    for (let i = 0; i < 40; i++) {
      const [stored] = await sql`SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE key = ${key}`;
      if (stored?.request_hash !== hash) {
        return reply.code(409).send(errorBody({ code: 'idempotency_key_reuse', message: 'This Idempotency-Key was used with a different request body' }));
      }
      if (stored.response_body?.id) return reply.code(200).send(stored.response_body);
      await new Promise((r) => setTimeout(r, 25));
    }
    return reply.code(409).send(errorBody({ code: 'idempotency_key_reuse', message: 'Original request still in flight' }));
  });

  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send(errorBody({ code: 'not_found', message: 'No such route' })));

  app.setErrorHandler((err, req, reply) => {
    if (err.validation || err.statusCode === 400) {
      return reply.code(400).send(errorBody({ code: 'validation_error', message: 'Invalid request' }));
    }
    // Log the REAL error; return a generic one. Never leak table names, paths or query text.
    req.log.error({ err, reqId: req.id }, 'unhandled error');
    return reply.code(err.statusCode && err.statusCode < 500 ? err.statusCode : 500)
      .send(errorBody({ code: 'internal_error', message: 'Something went wrong', details: { requestId: req.id } }));
  });

  app.decorate('beginShutdown', () => { shuttingDown = true; });
  app.decorate('isReady', () => !shuttingDown);
  return app;

  async function insert(body) {
    const [row] = await sql`INSERT INTO orders (user_id, status, total_cents, created_at)
                            VALUES (${body.userId}, ${body.status}, ${body.totalCents}, now())
                            RETURNING id, user_id, status, total_cents, created_at`;
    return row;
  }
}
