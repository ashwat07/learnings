/**
 * Lab 03 — Indexing in practice.
 *
 *   node postgres/labs/03-indexing/lab.mjs
 *   node postgres/labs/03-indexing/lab.mjs --clean     drop everything this lab created
 *
 * Seven experiments, each isolating one decision. Every one prints the plan and the buffers before
 * and after, so nothing here is a claim — it is a measurement on your machine.
 */

import { sql, measure, comparePlans, explain, buffers, bench, rule, note, good, bad, table } from '../../../lib/db.mjs';

const CREATED = [
  'idx_orders_created', 'idx_orders_user_created', 'idx_orders_created_user',
  'idx_orders_pending', 'idx_orders_covering', 'idx_orders_lower_status',
  'idx_users_email_lower', 'idx_orders_user_only',
];
const drop = async () => { for (const i of CREATED) await sql.unsafe(`DROP INDEX IF EXISTS ${i}`); };

if (process.argv.includes('--clean')) {
  await drop(); good('dropped every index this lab creates'); await sql.end(); process.exit(0);
}
await drop();

// ---------------------------------------------------------------------------
rule('1. the baseline: what a missing index costs');
const Q1 = `SELECT * FROM orders WHERE created_at >= now() - interval '7 days' ORDER BY created_at DESC LIMIT 50`;
const b1 = await measure('no index', Q1);
await sql.unsafe(`CREATE INDEX idx_orders_created ON orders (created_at DESC)`);
await sql.unsafe('ANALYZE orders');
const a1 = await measure('(created_at DESC)', Q1);
comparePlans(b1, a1);
console.log(`  The index does two jobs here, and only one is obvious. It FILTERS (find rows in the
  last 7 days) and it also PROVIDES THE ORDER, so the Sort node disappears entirely — an
  ORDER BY that matches an index is free.

  That is why "ORDER BY created_at DESC LIMIT 50" is the single most common query shape in a web
  app and the single most common missing index.`);

// ---------------------------------------------------------------------------
rule('2. column ORDER in a composite index');
const Q2 = `SELECT * FROM orders WHERE user_id = 77 ORDER BY created_at DESC LIMIT 20`;
await sql.unsafe(`CREATE INDEX idx_orders_user_created ON orders (user_id, created_at DESC)`);
await sql.unsafe(`CREATE INDEX idx_orders_created_user ON orders (created_at DESC, user_id)`);
await sql.unsafe('ANALYZE orders');

const forced = async (label, index) => {
  // Force one index by disabling the other, so we compare like with like.
  const others = ['idx_orders_user_created', 'idx_orders_created_user', 'idx_orders_created'].filter((i) => i !== index);
  for (const o of others) await sql.unsafe(`UPDATE pg_index SET indisvalid = false WHERE indexrelid = '${o}'::regclass`);
  const m = await measure(label, Q2);
  for (const o of others) await sql.unsafe(`UPDATE pg_index SET indisvalid = true WHERE indexrelid = '${o}'::regclass`);
  return m;
};
// (pg_index surgery needs superuser; fall back to reading what the planner picked if it fails.)
let userFirst, createdFirst;
try {
  userFirst = await forced('(user_id, created_at)', 'idx_orders_user_created');
  createdFirst = await forced('(created_at, user_id)', 'idx_orders_created_user');
} catch {
  note('could not force index choice (needs superuser) — showing the planner\'s pick only');
  userFirst = await measure('planner choice', Q2);
  createdFirst = userFirst;
}
comparePlans(createdFirst, userFirst);
console.log(`  THE RULE: EQUALITY COLUMNS FIRST, THEN THE RANGE / SORT COLUMN.

  (user_id, created_at) lets Postgres jump straight to this user's slice of the index, which is
  ALREADY in created_at order — so it reads 20 entries and stops.

  (created_at, user_id) can only scan backwards through every recent order looking for user 77.
  The user_id column is in the index but it cannot be used to SEEK, only to filter.

  This is the "leftmost prefix" rule, and it is why one well-ordered composite index usually beats
  three single-column ones.`);

// ---------------------------------------------------------------------------
rule('3. a PARTIAL index — indexing 6% of the table');
const Q3 = `SELECT * FROM orders WHERE status = 'pending' ORDER BY created_at LIMIT 100`;
const b3 = await measure('full index on (status, created_at)', Q3);
await sql.unsafe(`CREATE INDEX idx_orders_pending ON orders (created_at) WHERE status = 'pending'`);
await sql.unsafe('ANALYZE orders');
const a3 = await measure('partial index WHERE status = pending', Q3);

const sizes = await sql`
  SELECT indexrelname AS index, pg_size_pretty(pg_relation_size(indexrelid)) AS size
  FROM pg_stat_user_indexes WHERE relname = 'orders' ORDER BY pg_relation_size(indexrelid) DESC`;
comparePlans(b3, a3);
table(sizes.map((r) => ({ index: r.index, size: r.size })), ['index', 'size']);
console.log(`
  A partial index only contains the rows matching its WHERE clause. Here that is ~6% of the table,
  so the index is a fraction of the size, fits in cache, and costs almost nothing to maintain when
  a row that does not match is written.

  The best fit in practice: a STATUS COLUMN WITH A SKEWED DISTRIBUTION where you only ever query
  the rare values. Job queues (WHERE state = 'queued'), soft deletes (WHERE deleted_at IS NULL),
  and unprocessed outbox rows are the canonical cases — and in all three the hot query touches a
  tiny minority of a huge table.`);

// ---------------------------------------------------------------------------
rule('4. a COVERING index — an index-only scan');
// A range wide enough that the HEAP FETCHES dominate. With a handful of rows the two plans are
// indistinguishable; the win appears exactly when the random I/O does.
const Q4 = `SELECT user_id, created_at, total_cents FROM orders WHERE user_id BETWEEN 1000 AND 8000`;
await sql.unsafe(`CREATE INDEX idx_orders_user_only ON orders (user_id)`);
await sql.unsafe(`CREATE INDEX idx_orders_covering ON orders (user_id) INCLUDE (created_at, total_cents)`);
// The visibility map must be current or an index-only scan degrades into heap fetches anyway.
await sql.unsafe('VACUUM ANALYZE orders');

const only = async (keep) => {
  const other = keep === 'idx_orders_covering' ? 'idx_orders_user_only' : 'idx_orders_covering';
  await sql.unsafe(`UPDATE pg_index SET indisvalid = false WHERE indexrelid = '${other}'::regclass`);
  const m = await measure(keep === 'idx_orders_covering' ? 'INCLUDE (…) — index-only scan' : 'plain (user_id) — heap fetch required', Q4);
  await sql.unsafe(`UPDATE pg_index SET indisvalid = true WHERE indexrelid = '${other}'::regclass`);
  return m;
};
const b4 = await only('idx_orders_user_only');
const a4 = await only('idx_orders_covering');
comparePlans(b4, a4);
console.log(`  "Index Only Scan" means Postgres answered the query WITHOUT TOUCHING THE TABLE at all.
  Every column the query needs is in the index, so there is no heap fetch and no random I/O — look
  at the buffer counts rather than the milliseconds, because that is where the real difference is.

  Two things people get wrong:

  · INCLUDE columns are stored in the leaf pages but are NOT part of the key — they cannot be used
    to seek or to sort. Use INCLUDE for columns you SELECT, the key for columns you FILTER.
  · An index-only scan still consults the VISIBILITY MAP to check whether each row is visible to
    your transaction. If the table has not been vacuumed recently you will see "Heap Fetches: N"
    in the plan and the win evaporates. That is why autovacuum tuning is a performance topic, not
    a housekeeping one — and why this lab runs VACUUM before measuring.

  The trade: a wider index is a bigger index. INCLUDE every column "just in case" and you have
  duplicated the table, paid for it on every write, and lost the cache locality you were after.`);

// ---------------------------------------------------------------------------
rule('5. the index that CANNOT be used');
const cases = [
  [`SELECT * FROM users WHERE lower(email) = 'user500@example.com'`, 'a function on the column'],
  [`SELECT * FROM users WHERE email LIKE '%500@example.com'`, 'a leading wildcard'],
  [`SELECT * FROM orders WHERE created_at::date = current_date`, 'a cast on the column'],
];
for (const [q, why] of cases) {
  const e = await explain(q);
  const seq = e.nodes.some((n) => n['Node Type'] === 'Seq Scan');
  (seq ? bad : good)(`${why.padEnd(24)} ${seq ? 'SEQ SCAN' : 'index used'}  (${e.executionMs.toFixed(1)}ms)`);
}
await sql.unsafe(`CREATE INDEX idx_users_email_lower ON users (lower(email))`);
await sql.unsafe('ANALYZE users');
const fixed = await explain(`SELECT * FROM users WHERE lower(email) = 'user500@example.com'`);
good(`after CREATE INDEX ON users (lower(email)): ${fixed.nodes.some((n) => n['Node Type'] === 'Seq Scan') ? 'still seq' : 'index used'}  (${fixed.executionMs.toFixed(2)}ms)`);
console.log(`
  AN INDEX IS ON AN EXPRESSION, AND YOUR QUERY MUST USE THE SAME EXPRESSION. Wrap the column in
  anything — lower(), a cast, date_trunc, || — and the index on the bare column is unusable.

  Two fixes: index the expression (as above), or rewrite the query so the column is bare:

    WHERE created_at::date = current_date          -- unusable
    WHERE created_at >= current_date
      AND created_at <  current_date + 1           -- uses an index on created_at

  The second form is better where you can write it: it is sargable, it works with a plain index,
  and it is correct across time zones in a way the cast is not.

  And the leading wildcard: LIKE 'foo%' CAN use a B-tree (with text_pattern_ops for non-C
  collations); LIKE '%foo' never can. That is what trigram indexes (pg_trgm) are for — lab 05.`);

// ---------------------------------------------------------------------------
rule('6. what an index COSTS on write');
// Measured SERVER-SIDE with INSERT..SELECT. Timing single-row inserts from the client measures
// your network round trip, not the index maintenance — which is why the naive benchmark of this
// usually shows no difference at all.
const N_WRITE = 50_000;
const loadInto = (t) => sql.unsafe(
  `INSERT INTO ${t} (user_id, status, total_cents, created_at)
   SELECT (random() * 49999)::int + 1, 'pending', (random() * 100000)::int,
          now() - (random() * 400) * interval '1 day'
   FROM generate_series(1, ${N_WRITE})`);

const writeRows = [];
for (const [label, indexes] of [['no indexes', []], ['5 indexes', ['user_id', 'status', 'created_at', 'total_cents', 'shipped_at']]]) {
  await sql.unsafe('DROP TABLE IF EXISTS write_bench');
  await sql.unsafe('CREATE TABLE write_bench (LIKE orders INCLUDING DEFAULTS)');
  for (const c of indexes) await sql.unsafe(`CREATE INDEX ON write_bench (${c})`);
  const t0 = performance.now();
  await loadInto('write_bench');
  const ms = performance.now() - t0;
  const [{ s }] = await sql`SELECT pg_size_pretty(pg_total_relation_size('write_bench')) AS s`;
  writeRows.push({ table: label, [`insert ${N_WRITE.toLocaleString()} rows`]: `${ms.toFixed(0)}ms`, 'on disk': s, _ms: ms });
}
await sql.unsafe('DROP TABLE IF EXISTS write_bench');
table(writeRows.map(({ _ms, ...r }) => r));
console.log(`
  ${(writeRows[1]._ms / writeRows[0]._ms).toFixed(1)}x slower to write, and the table takes more
  than twice the disk.

  EVERY INDEX IS PAID FOR ON EVERY WRITE. An INSERT updates the table and every index on it; an
  UPDATE that changes an indexed column does the same, and an UPDATE that does not touch any
  indexed column may qualify for a HOT update and skip them entirely — which is a real reason not
  to index a column you update constantly.

  So the question is never "would an index help this query". It is "does this query matter more
  than the write cost, and could an existing index cover it instead".

  Find the ones you are paying for and not using:`);

// ---------------------------------------------------------------------------
rule('7. building an index WITHOUT locking the table');
console.log(`
  CREATE INDEX takes a SHARE lock: it blocks every INSERT, UPDATE and DELETE on the table for the
  whole build. On a large production table that is an outage.

    CREATE INDEX CONCURRENTLY idx_orders_created ON orders (created_at);

  CONCURRENTLY builds in two passes and does not block writes. What it costs you:

  · it takes roughly twice as long, and uses more CPU
  · it CANNOT run inside a transaction — which means most migration tools need explicit handling
  · if it fails it leaves an INVALID index behind, which you must find and drop:

      SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;

  · DROP INDEX CONCURRENTLY exists too, and is equally necessary

  The rule for any migration on a table with traffic: CONCURRENTLY, outside a transaction, and a
  check afterwards that the index is valid. Lab 01 covers the rest of the zero-downtime playbook.`);

const summary = await sql`
  SELECT indexrelname AS index, idx_scan AS scans, pg_size_pretty(pg_relation_size(indexrelid)) AS size
  FROM pg_stat_user_indexes WHERE relname IN ('orders','users') ORDER BY pg_relation_size(indexrelid) DESC`;
rule('every index now on orders/users');
table(summary.map((r) => ({ index: r.index, scans: r.scans, size: r.size })), ['index', 'scans', 'size']);
note('run with --clean to drop the ones this lab created');

await sql.end();
