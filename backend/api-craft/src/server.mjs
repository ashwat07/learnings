/**
 * The service you are building.
 *
 *   node --test api-craft/test/       run the suite (most of it fails — that is the exercise)
 *   node api-craft/src/server.mjs     run it for real on :3100
 *
 * Everything marked TODO is yours. The tests define the contract precisely; read them when a
 * message is ambiguous. Nothing here is a trick — every requirement is something a real service
 * needs and most services get wrong.
 */

import Fastify from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.mjs';

export const ORDER_STATUSES = ['pending', 'paid', 'shipped', 'delivered', 'cancelled'];

/**
 * The error envelope. ONE shape for every failure in the service, so clients can write one
 * handler. This is the single highest-value decision in an API and it has to be made on day one.
 */
export function errorBody({ code, message, details }) {
  return { error: { code, message, ...(details ? { details } : {}) } };
}

export function build({ logger = false } = {}) {
  const app = Fastify({ logger, disableRequestLogging: !logger });

  // ---------------------------------------------------------------------------
  // Health vs readiness. They are DIFFERENT and conflating them causes rolling
  // restarts to take the whole service down.
  // ---------------------------------------------------------------------------
  let ready = true;
  let shuttingDown = false;

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/readyz', async (req, reply) => {
    // TODO: readiness must reflect whether this instance can SERVE TRAFFIC right now:
    //   · the database must be reachable  (SELECT 1)
    //   · once shutdown has begun it must report NOT ready, so the load balancer stops
    //     sending new requests BEFORE we start refusing them
    // Respond 200 { status: 'ready' } or 503 { status: 'not_ready', reason }.
    return reply.code(200).send({ status: 'ready' });
  });

  // ---------------------------------------------------------------------------
  // GET /orders — cursor pagination.
  // ---------------------------------------------------------------------------
  const listQuery = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(ORDER_STATUSES).optional(),
    cursor: z.string().optional(),
  });

  app.get('/orders', async (req, reply) => {
    // TODO:
    //   · validate the query string with listQuery; on failure 400 with code 'validation_error'
    //     and details listing the offending fields
    //   · return { data: [...], nextCursor: string | null }
    //   · paginate by KEYSET, not OFFSET (postgres lab 08). The cursor encodes the last row's
    //     (created_at, id); decoding a malformed cursor is a 400, not a 500
    //   · nextCursor is null on the last page
    void listQuery;
    return reply.code(501).send(errorBody({ code: 'not_implemented', message: 'GET /orders' }));
  });

  // ---------------------------------------------------------------------------
  // GET /orders/:id
  // ---------------------------------------------------------------------------
  app.get('/orders/:id', async (req, reply) => {
    // TODO: 200 with the order, or 404 with code 'not_found'.
    // A non-numeric id is a 400, not a 500 — and definitely not a database error leaking out.
    return reply.code(501).send(errorBody({ code: 'not_implemented', message: 'GET /orders/:id' }));
  });

  // ---------------------------------------------------------------------------
  // POST /orders — validation and idempotency.
  // ---------------------------------------------------------------------------
  const createBody = z.object({
    userId: z.number().int().positive(),
    totalCents: z.number().int().positive(),
    status: z.enum(ORDER_STATUSES).default('pending'),
  });

  app.post('/orders', async (req, reply) => {
    // TODO:
    //   · validate with createBody; 400 'validation_error' with per-field details
    //   · 201 on success, with a Location header pointing at the new resource
    //   · IDEMPOTENCY: if the request carries an Idempotency-Key header, a repeat with the same
    //     key must NOT create a second order. Return the ORIGINAL response (200 or 201) instead.
    //     The same key with a DIFFERENT body is a 409 'idempotency_key_reuse'.
    //   · the key store and the order must be written in ONE transaction (caching drill 04)
    void createBody;
    return reply.code(501).send(errorBody({ code: 'not_implemented', message: 'POST /orders' }));
  });

  // ---------------------------------------------------------------------------
  // Cross-cutting concerns.
  // ---------------------------------------------------------------------------

  // TODO: a 404 handler that returns the error envelope, not Fastify's default.
  // TODO: an error handler that:
  //   · logs the real error with the request id
  //   · returns the envelope with code 'internal_error' and a GENERIC message — never the
  //     exception text, which leaks table names, file paths and query fragments
  //   · echoes the request id so a user can quote it in a support ticket

  // TODO: every response should carry a request id header (x-request-id), reusing the inbound
  // one if present so it can be traced across services.

  app.decorate('beginShutdown', () => { shuttingDown = true; ready = false; });
  app.decorate('isReady', () => ready && !shuttingDown);
  return app;
}

// ---------------------------------------------------------------------------
// Graceful shutdown. The order of operations matters and is the whole point.
// ---------------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const app = build({ logger: true });
  await app.listen({ port: 3100, host: '0.0.0.0' });

  const shutdown = async (signal) => {
    app.log.info({ signal }, 'shutting down');
    // TODO, in this order:
    //   1. flip readiness to false and WAIT a few seconds — the load balancer needs time to
    //      notice before you stop accepting connections. Skipping this is why "graceful"
    //      deploys still drop requests.
    //   2. stop accepting new connections, let in-flight requests finish (app.close())
    //   3. close the database pool
    //   4. exit 0 — with a hard timeout that exits non-zero if step 2 hangs
    await app.close();
    await sql.end();
    process.exit(0);
  };
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => shutdown(sig));
}
