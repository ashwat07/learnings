/**
 * Lab 08 — N+1 and the ORM traps.
 *
 *   node postgres/labs/08-n-plus-1-and-orms/lab.mjs
 *
 * The most expensive bug in backend engineering, and the one that never shows up in a slow-query
 * log — because every individual query IS fast.
 */

import { sql, bench, explain, rule, note, table } from '../../../lib/db.mjs';

await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_l8_items_order ON order_items (order_id)`);
await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_l8_orders_created ON orders (created_at DESC)`);
await sql.unsafe('ANALYZE');

const PAGE = 50;
let queryCount = 0;
const counted = (strings, ...args) => { queryCount++; return sql(strings, ...args); };

rule('the page we are building');
console.log(`  "Recent orders": ${PAGE} orders, each with its user's name and its line items.
  Three implementations, identical output, and a large spread.`);

// 1. The N+1 — what an ORM writes for you if you are not careful.
async function nPlusOne() {
  queryCount = 0;
  const orders = await counted`SELECT id, user_id, total_cents, created_at
                               FROM orders ORDER BY created_at DESC LIMIT ${PAGE}`;
  const out = [];
  for (const o of orders) {
    const [user] = await counted`SELECT id, name, country FROM users WHERE id = ${o.user_id}`;
    const items = await counted`SELECT product_id, quantity, price_cents
                                FROM order_items WHERE order_id = ${o.id}`;
    out.push({ ...o, user, items });
  }
  return out;
}

// 2. Batched — the DataLoader shape. Three queries, and the N is gone.
async function batched() {
  queryCount = 0;
  const orders = await counted`SELECT id, user_id, total_cents, created_at
                               FROM orders ORDER BY created_at DESC LIMIT ${PAGE}`;
  const userIds = [...new Set(orders.map((o) => o.user_id))];
  const orderIds = orders.map((o) => o.id);

  // = ANY($1) with an array is the batching primitive: ONE round trip, ONE plan.
  const users = await counted`SELECT id, name, country FROM users WHERE id = ANY(${userIds})`;
  const items = await counted`SELECT order_id, product_id, quantity, price_cents
                              FROM order_items WHERE order_id = ANY(${orderIds})`;

  const byUser = new Map(users.map((u) => [u.id, u]));
  const byOrder = new Map();
  for (const i of items) { if (!byOrder.has(i.order_id)) byOrder.set(i.order_id, []); byOrder.get(i.order_id).push(i); }
  return orders.map((o) => ({ ...o, user: byUser.get(o.user_id), items: byOrder.get(o.id) ?? [] }));
}

// 3. One query — the database does the assembly.
async function single() {
  queryCount = 0;
  return counted`
    SELECT o.id, o.user_id, o.total_cents, o.created_at,
           json_build_object('id', u.id, 'name', u.name, 'country', u.country) AS "user",
           coalesce(i.items, '[]'::json) AS items
    FROM (SELECT id, user_id, total_cents, created_at
          FROM orders ORDER BY created_at DESC LIMIT ${PAGE}) o
    JOIN users u ON u.id = o.user_id
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object('product_id', oi.product_id,
                                        'quantity', oi.quantity,
                                        'price_cents', oi.price_cents)) AS items
      FROM order_items oi WHERE oi.order_id = o.id
    ) i ON true`;
}

const results = [];
for (const [label, fn] of [['N+1 (1 + 2N queries)', nPlusOne], ['batched (3 queries)', batched], ['single query', single]]) {
  const r = await fn();
  const queries = queryCount;
  const b = await bench(label, fn, { runs: 5, warmup: 2 });
  results.push({ approach: label, queries, 'median ms': b.median.toFixed(1), rows: r.length });
}
rule('measured');
table(results, ['approach', 'queries', 'median ms', 'rows']);
const speedup = (Number(results[0]['median ms']) / Number(results[2]['median ms'])).toFixed(0);
console.log(`
  ${speedup}x — and NOT ONE of the ${results[0].queries} queries in the first version is slow. That is what makes
  N+1 so hard to find: your slow-query log is empty, your APM shows a slow endpoint containing no
  slow query, and every index is already correct.

  WHERE THE TIME GOES. Each query is a full round trip: serialise, syscall, network, parse, plan,
  execute, serialise back, deserialise. Even on localhost that is ~0.1-0.3ms of pure overhead;
  against a database in another availability zone it is 1-2ms. Multiply by ${results[0].queries}.

  Which is why N+1 is WORSE IN PRODUCTION than in development: your laptop has 0.05ms of latency
  to a container, production has 1ms to another host. The bug scales with the network you did not
  have while developing.`);

rule('how to SEE it');
console.log(`
  1. COUNT QUERIES PER REQUEST. One counter in your DB wrapper, logged with the request. An
     endpoint doing 300 queries is a bug regardless of how fast each one is. This single metric
     finds more N+1 than any profiler.

  2. pg_stat_statements: sort by CALLS, not by time.

       SELECT calls, mean_exec_time, total_exec_time, query
       FROM pg_stat_statements ORDER BY calls DESC LIMIT 20;

     A query called 400,000 times at 0.2ms is 80 seconds of database time and will never appear
     in a "slowest queries" list.

  3. In the PLAN: a Nested Loop whose inner side shows "loops=50" is an N+1 the database is doing
     on your behalf — sometimes fine, sometimes the same bug one level down.

  4. In TESTS: assert the query count. A test that fails when an endpoint goes from 3 queries to
     53 catches the regression on the day someone adds a lazy association.`);

rule('the ORM traps, and what each looks like');
table([
  { trap: 'lazy loading in a loop', looks: 'orders.forEach(o => o.user.name)', fix: 'eager load: include / preload / with' },
  { trap: 'eager loading EVERYTHING', looks: 'include: { user: true, items: { include: { product: true }}}', fix: 'load what the response needs, no more' },
  { trap: 'the JOIN explosion', looks: 'one JOIN per collection, rows multiply', fix: 'batch separately, or json_agg in a LATERAL' },
  { trap: 'SELECT *', looks: 'findMany() with no select', fix: 'select what you serialise; it also enables index-only scans' },
  { trap: 'count() for pagination', looks: 'SELECT count(*) on every page', fix: 'keyset pagination, or an approximate count' },
  { trap: 'OFFSET 10000', looks: 'page 200 of a list', fix: 'keyset: WHERE created_at < $cursor' },
  { trap: 'a transaction per row', looks: 'for (row of rows) await tx(...)', fix: 'one transaction, or one statement' },
  { trap: 'the ORM inside a migration', looks: 'model.update() over 2M rows', fix: 'one UPDATE ... FROM, batched by id range' },
], ['trap', 'looks', 'fix']);

rule('the JOIN explosion, demonstrated');
const [{ joined }] = await sql`
  SELECT count(*)::int AS joined
  FROM (SELECT id FROM orders ORDER BY created_at DESC LIMIT 50) o
  JOIN order_items i ON i.order_id = o.id`;
console.log(`
  50 orders joined to their items produce ${joined} rows, not 50. Add a second collection — say
  order.payments — and you get 50 x items x payments, with every order column repeated in every row.

  That is why "just use one big JOIN" is not the universal answer. Two collections on the same
  parent is exactly where you want either separate batched queries (approach 2) or a LATERAL with
  json_agg (approach 3), which aggregates BEFORE the join and keeps the row count at 50.`);

rule('OFFSET vs keyset pagination');
const eo = await explain(`SELECT id, created_at FROM orders ORDER BY created_at DESC OFFSET 100000 LIMIT 20`);
const ek = await explain(`SELECT id, created_at FROM orders
   WHERE created_at < (SELECT created_at FROM orders ORDER BY created_at DESC OFFSET 100000 LIMIT 1)
   ORDER BY created_at DESC LIMIT 20`);
const scanned = (e) => e.nodes.reduce((n, x) => Math.max(n, x['Actual Rows'] ?? 0), 0);
table([
  { pagination: 'OFFSET 100000', ms: eo.executionMs.toFixed(1), 'rows touched': scanned(eo) },
  { pagination: 'keyset (WHERE created_at < cursor)', ms: ek.executionMs.toFixed(1), 'rows touched': scanned(ek) },
], ['pagination', 'ms', 'rows touched']);
console.log(`
  OFFSET does not skip work — it FETCHES AND DISCARDS every row it skips. Page 5,000 reads 100,000
  rows to return 20, and the deeper the page the slower it gets.

  Keyset pagination ("the seek method") passes the last row's sort key as a cursor:

    WHERE (created_at, id) < ($last_created_at, $last_id)
    ORDER BY created_at DESC, id DESC
    LIMIT 20

  Constant time at any depth, and CORRECT under concurrent inserts — OFFSET silently skips or
  repeats rows when the data shifts between page loads.

  The cost: no random access to page N. Which almost no real interface needs, and infinite scroll
  needs least of all. Include the tiebreaker (id) or rows with equal timestamps will be skipped.`);

for (const i of ['idx_l8_items_order', 'idx_l8_orders_created']) await sql.unsafe(`DROP INDEX IF EXISTS ${i}`);
await sql.end();
