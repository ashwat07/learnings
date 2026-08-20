/**
 * Lab 10 — Big tables, cheap retention, and push instead of poll.
 *
 *   node postgres/labs/10-partitioning-and-notify/lab.mjs
 *
 * Three mechanisms that only pay off at size, measured on 600,000 rows:
 *
 *   PARTITIONING   the planner skips whole tables it can prove are irrelevant
 *   MATVIEWS       an expensive aggregate, computed once — and the lock that surprises people
 *   LISTEN/NOTIFY  the database tells you, instead of you asking it every second
 *
 * It builds its own tables and drops them again.
 */

import postgres from 'postgres';
import { sql, explain, buffers, rule, note, table, good, bad } from '../../../lib/db.mjs';

const PG = { host: 'localhost', port: 5433, user: 'labs', password: 'labs', database: 'labs' };
const mk = (max = 1) => postgres({ ...PG, max, onnotice() {} });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MONTHS = 12;
const PER_MONTH = 50_000;
const START = '2026-01-01';

// pg_total_relation_size on a PARTITIONED parent returns 0 — the parent holds no data. You have
// to sum the tree, which is itself a useful reminder that a partitioned table is N tables.
// pg_partition_tree returns one row for an ordinary table, so this works for both.
const size = async (rel) => {
  // pg_partition_tree returns NO ROWS for an ordinary table and one row per partition (plus the
  // parent) for a partitioned one — so coalesce back to the plain size. And note the parent of a
  // partitioned table holds no data at all: pg_total_relation_size on it is 0, which is the first
  // thing that confuses everyone looking at partition sizes.
  const [r] = await sql.unsafe(
    `SELECT pg_size_pretty(coalesce(
        (SELECT sum(pg_total_relation_size(relid)) FROM pg_partition_tree('${rel}')),
        pg_total_relation_size('${rel}'))) AS s`);
  return r.s;
};

rule('SETUP');
{
  await sql.unsafe(`DROP TABLE IF EXISTS lab10_plain CASCADE`);
  await sql.unsafe(`DROP TABLE IF EXISTS lab10_part CASCADE`);

  const cols = `(id bigint NOT NULL, tenant_id int NOT NULL, kind text NOT NULL,
                 payload jsonb NOT NULL, occurred_at timestamptz NOT NULL)`;
  await sql.unsafe(`CREATE TABLE lab10_plain ${cols}`);
  await sql.unsafe(`CREATE TABLE lab10_part ${cols} PARTITION BY RANGE (occurred_at)`);

  // One partition per month, plus one for the future so inserts never fail. A range partitioned
  // table with no partition covering a value REJECTS the insert — which is the operational
  // burden partitioning brings: somebody has to create next month's partition before next month.
  for (let m = 0; m < MONTHS + 1; m++) {
    const from = `(date '${START}' + interval '${m} month')`;
    const to = `(date '${START}' + interval '${m + 1} month')`;
    await sql.unsafe(`CREATE TABLE lab10_part_${m} PARTITION OF lab10_part
                      FOR VALUES FROM ${from} TO ${to}`);
  }

  const rows = `
    SELECT g,
           1 + g % 50,
           (ARRAY['view','click','purchase','refund'])[1 + g % 4],
           jsonb_build_object('value', g % 1000, 'source', (ARRAY['web','ios','android'])[1 + g % 3]),
           date '${START}' + (g % ${MONTHS}) * interval '1 month' + (g % 27) * interval '1 day'
                           + (g % 1440) * interval '1 minute'
    FROM generate_series(1, ${MONTHS * PER_MONTH}) g`;
  await sql.unsafe(`INSERT INTO lab10_plain ${rows}`);
  await sql.unsafe(`INSERT INTO lab10_part ${rows}`);

  // The same index on both, so the comparison is about partitioning and nothing else. On the
  // partitioned table this creates one index PER PARTITION — declaring it on the parent is a
  // convenience, not a single shared structure.
  await sql.unsafe(`CREATE INDEX ON lab10_plain (occurred_at)`);
  await sql.unsafe(`CREATE INDEX ON lab10_part (occurred_at)`);
  await sql.unsafe(`ANALYZE lab10_plain`);
  await sql.unsafe(`ANALYZE lab10_part`);

  good(`${(MONTHS * PER_MONTH).toLocaleString()} rows, ${MONTHS + 1} monthly partitions`);
  note(`lab10_plain ${await size('lab10_plain')} · lab10_part ${await size('lab10_part')}`);
}

// ---------------------------------------------------------------------------
rule('1. partition pruning — the planner skips what it can prove is irrelevant');
{
  const q = (t) => `SELECT count(*), sum((payload->>'value')::int)
                    FROM ${t}
                    WHERE occurred_at >= date '${START}' + interval '3 month'
                      AND occurred_at <  date '${START}' + interval '4 month'`;

  const rows = [];
  for (const t of ['lab10_plain', 'lab10_part']) {
    const e = await explain(q(t));
    const b = buffers(e.nodes);
    const scanned = e.nodes.filter((n) => /Scan/.test(n['Node Type']) && n['Relation Name'])
      .map((n) => n['Relation Name']);
    rows.push({
      table: t,
      buffers: (b.hit + b.read).toLocaleString(),
      'exec ms': e.executionMs.toFixed(1),
      'plan ms': e.planningMs.toFixed(2),
      'relations touched': scanned.length <= 2 ? scanned.join(', ') : `${scanned.length} relations`,
    });
  }
  table(rows, ['table', 'buffers', 'exec ms', 'plan ms', 'relations touched']);

  const [plain, part] = rows.map((r) => Number(r.buffers.replace(/,/g, '')));
  console.log(`  ${(plain / part).toFixed(1)}x fewer buffers, and the partitioned plan does not use the index at all.\n`);

  console.log(`  Read the last column. The plain table has to consult an index and then fetch scattered
  heap pages; the partitioned table narrows to ONE PHYSICAL TABLE and reads it sequentially. That
  is why the partitioned version is faster despite doing a "Seq Scan" — a sequential scan of one
  month beats an index lookup across a year.

  Pruning happens in two places, and the difference matters:
    PLAN TIME     the constant is known while planning, so the plan contains only the partitions
                  that can match. Cheapest, and what you get from a literal or a parameter the
                  planner can see.
    RUN TIME      the value is not known until execution — a subquery, a parameter under a generic
                  plan, a nested-loop join key. Postgres can still prune, and EXPLAIN ANALYZE
                  reports it as "Partitions removed: N". Look for that line; if it is missing and
                  you expected pruning, your query is scanning everything.

  THE THING THAT SILENTLY DISABLES IT: a predicate the planner cannot map onto the partition key.

      WHERE occurred_at >= now() - interval '30 days'     -- prunes (now() is stable)
      WHERE date_trunc('month', occurred_at) = '2026-04-01'  -- DOES NOT PRUNE
      WHERE occurred_at::date = '2026-04-15'                 -- DOES NOT PRUNE

  Wrapping the partition key in a function throws pruning away, exactly as it throws away a normal
  index (drill 03). The fix is the same: put the function on the CONSTANT, never on the column.`);
}

// ---------------------------------------------------------------------------
rule('2. what partitioning COSTS — planning, and a query with no key');
{
  // A query that cannot prune has to plan against every partition.
  const noKey = (t) => `SELECT count(*) FROM ${t} WHERE tenant_id = 7`;
  const rows = [];
  for (const t of ['lab10_plain', 'lab10_part']) {
    const e = await explain(noKey(t));
    const b = buffers(e.nodes);
    rows.push({ table: t, 'plan ms': e.planningMs.toFixed(2), 'exec ms': e.executionMs.toFixed(1), buffers: (b.hit + b.read).toLocaleString() });
  }
  table(rows, ['table', 'plan ms', 'exec ms', 'buffers']);

  console.log(`
  A query with no partition-key predicate must touch every partition — and PLAN against every
  partition, which is where the planning time goes. With 13 partitions that is noise. With 1,000
  (daily partitions for three years) planning a simple query can take longer than executing it,
  and it is paid on EVERY execution.

  So the real costs of partitioning, none of which show up in a demo:
    · planning time grows with partition count. Keep it in the tens or low hundreds, not thousands.
    · UNIQUE constraints must include the partition key. A globally-unique email column is not
      possible on a partitioned table unless email is part of the key — which it is not.
    · foreign keys REFERENCING a partitioned table were impossible before PG12 and are still
      awkward. Plan the schema around that.
    · somebody has to create next month's partition. Miss it and inserts start failing at
      midnight on the 1st. Use pg_partman, or a scheduled job, and ALERT on the newest partition's
      upper bound rather than trusting the job.
    · every index is per-partition, so a query with no key does N index lookups instead of one.

  WHEN IT IS WORTH IT — and it is a shorter list than people assume:
    1. RETENTION. You delete old data on a schedule. This is the best reason by a wide margin —
       section 3 measures why.
    2. The table is big enough that maintenance hurts: VACUUM, REINDEX and ANALYZE all become
       per-partition and therefore incremental.
    3. Queries almost always filter on the partition key, so pruning is the normal case.

  If none of those are true, an index is cheaper and simpler. Partitioning a 5-million-row table
  because it "feels big" adds operational burden and buys nothing.`);
}

// ---------------------------------------------------------------------------
rule('3. retention — DELETE versus DETACH');
{
  const beforePlain = await size('lab10_plain');
  const beforePart = await size('lab10_part');

  const t0 = performance.now();
  const del = await sql.unsafe(`DELETE FROM lab10_plain
                                WHERE occurred_at < date '${START}' + interval '1 month'`);
  const deleteMs = performance.now() - t0;

  const [dead] = await sql`SELECT n_dead_tup FROM pg_stat_user_tables WHERE relname = 'lab10_plain'`;
  const afterDelete = await size('lab10_plain');
  await sql.unsafe(`VACUUM lab10_plain`);
  const afterVacuum = await size('lab10_plain');

  const t1 = performance.now();
  await sql.unsafe(`ALTER TABLE lab10_part DETACH PARTITION lab10_part_0`);
  await sql.unsafe(`DROP TABLE lab10_part_0`);
  const detachMs = performance.now() - t1;
  const afterDetach = await size('lab10_part');

  table([
    { 'removing one month': `DELETE (${del.count.toLocaleString()} rows)`, ms: deleteMs.toFixed(0), 'dead tuples left': Number(dead.n_dead_tup).toLocaleString(), 'table size': `${beforePlain} -> ${afterDelete} -> ${afterVacuum} after VACUUM` },
    { 'removing one month': 'DETACH + DROP PARTITION', ms: detachMs.toFixed(0), 'dead tuples left': '0', 'table size': `${beforePart} -> ${afterDetach}` },
  ], ['removing one month', 'ms', 'dead tuples left', 'table size']);

  console.log(`
  The time difference is the least of it. What DELETE actually costs:

    · it writes a WAL record PER ROW. Deleting 50 million rows generates gigabytes of WAL, which
      every replica must receive and replay — so a retention job is a replication-lag incident.
    · it leaves the rows in place as DEAD TUPLES. autovacuum reclaims them for REUSE, but the
      table does not SHRINK — look at the size column above, before and after VACUUM. Getting the
      space back needs VACUUM FULL, which rewrites the table under ACCESS EXCLUSIVE, or
      pg_repack, which does not.
    · it takes a row lock on every row and holds it until commit, so a big DELETE either runs in
      one enormous transaction or has to be batched (drill 11).
    · the indexes bloat too, and stay bloated.

  DETACH is a catalogue update. The partition becomes an ordinary table you can archive to object
  storage, keep for compliance, or DROP — and DROP returns the space to the filesystem
  immediately. This is the whole reason time-series tables get partitioned, and it is the argument
  that survives when the pruning argument does not.

  One sharp edge: plain DETACH takes ACCESS EXCLUSIVE on the parent for a moment, so it queues
  behind any running query and then blocks everything behind itself. Use

      ALTER TABLE ... DETACH PARTITION ... CONCURRENTLY;

  which does not — at the cost of not being usable inside a transaction block (PG14+).`);
}

// ---------------------------------------------------------------------------
rule('4. materialised views, and the lock nobody expects');
{
  // Deliberately expensive: 7,000-odd groups over 550,000 rows, with JSONB extraction per row.
  // A refresh that finishes in 20ms cannot demonstrate a lock that lasts as long as the refresh.
  const AGG = `SELECT tenant_id,
                      date_trunc('day', occurred_at) AS month,
                      kind,
                      payload->>'source' AS source,
                      count(*) AS events,
                      sum((payload->>'value')::int) AS total,
                      avg((payload->>'value')::int) AS mean
               FROM lab10_part
               GROUP BY 1, 2, 3, 4`;

  const t0 = performance.now();
  await sql.unsafe(`SELECT count(*) FROM (${AGG}) x`);
  const liveMs = performance.now() - t0;

  await sql.unsafe(`DROP MATERIALIZED VIEW IF EXISTS lab10_rollup`);
  const t1 = performance.now();
  await sql.unsafe(`CREATE MATERIALIZED VIEW lab10_rollup AS ${AGG}`);
  const buildMs = performance.now() - t1;
  // CONCURRENTLY requires a UNIQUE index. Without one it fails, and that is the most common
  // reason people conclude "REFRESH CONCURRENTLY does not work".
  await sql.unsafe(`CREATE UNIQUE INDEX ON lab10_rollup (tenant_id, month, kind, source)`);
  await sql.unsafe(`ANALYZE lab10_rollup`);

  const t2 = performance.now();
  await sql.unsafe(`SELECT * FROM lab10_rollup WHERE tenant_id = 7`);
  const readMs = performance.now() - t2;

  // Now the lock. REFRESH (without CONCURRENTLY) takes ACCESS EXCLUSIVE — it blocks READS.
  const reader = mk(1);
  await reader`SET lock_timeout = '250ms'`;   // also warms the connection
  const refresher = mk(1);
  await refresher`SELECT 1`;                  // connect BEFORE timing, or the sleep below races
                                              // connection setup instead of the refresh

  // Poll pg_locks while the refresh runs rather than sampling once — a single sample either
  // misses the window or lands in it, and "sometimes" is not evidence.
  const watchLocks = (async () => {
    const seen = new Set();
    const until = Date.now() + 2000;
    while (Date.now() < until) {
      const rows = await sql`
        SELECT mode FROM pg_locks
        WHERE relation = 'lab10_rollup'::regclass AND granted AND mode LIKE '%Exclusive%'`;
      for (const r of rows) seen.add(r.mode);
      if (seen.size) return [...seen];
      await sleep(5);
    }
    return [...seen];
  })();

  // Measure how long the reader WAITED, rather than whether its lock_timeout fired. A refresh
  // that finishes in 100ms blocks a reader for 100ms — real, and invisible to a 250ms timeout.
  // Hammer the view with reads for the whole refresh and keep the WORST wait. A single attempt
  // either lands inside the exclusive window or misses it, and a lab that reports "sometimes"
  // has not measured anything.
  let blocked = 'not blocked';
  let readDuringPlain = 0;
  const refresh = refresher.unsafe(`REFRESH MATERIALIZED VIEW lab10_rollup`);
  const hammer = (async () => {
    for (let i = 0; i < 60; i++) {
      const t = performance.now();
      try { await reader`SELECT count(*) FROM lab10_rollup`; }
      catch (e) { blocked = e.code ?? e.message; }
      readDuringPlain = Math.max(readDuringPlain, performance.now() - t);
      await sleep(2);
    }
  })();
  await refresh;
  await hammer;
  const lockMode = (await watchLocks).join(', ') || 'none observed';

  // ...and with CONCURRENTLY, readers are not blocked at all.
  let blocked2 = 'not blocked';
  let readDuringRefresh = 0;
  const t4 = performance.now();
  const refresh2 = refresher.unsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY lab10_rollup`);
  const hammer2 = (async () => {
    for (let i = 0; i < 60; i++) {
      const t = performance.now();
      try { await reader`SELECT count(*) FROM lab10_rollup`; }
      catch (e) { blocked2 = e.code ?? e.message; }
      readDuringRefresh = Math.max(readDuringRefresh, performance.now() - t);
      await sleep(2);
    }
  })();
  await refresh2;
  const concurrentMs = performance.now() - t4;
  await hammer2;
  await reader.end();
  await refresher.end();

  table([
    { operation: 'the aggregate, computed live', ms: liveMs.toFixed(0) },
    { operation: 'reading it from the matview', ms: readMs.toFixed(1) },
    { operation: 'building the matview', ms: buildMs.toFixed(0) },
    { operation: 'REFRESH — lock held on the view', ms: '—', result: lockMode },
    { operation: 'REFRESH — worst read latency during it', ms: readDuringPlain.toFixed(0), result: blocked === 'not blocked' ? `a count(*) waited ${readDuringPlain.toFixed(0)}ms for the lock` : `reader BLOCKED, then ${blocked}` },
    { operation: 'REFRESH CONCURRENTLY — worst read latency', ms: concurrentMs.toFixed(0), result: blocked2 === 'not blocked' ? `worst read ${readDuringRefresh.toFixed(0)}ms — never waited` : `reader got ${blocked2}` },
  ], ['operation', 'ms', 'result']);

  console.log(`  ${(liveMs / readMs).toFixed(0)}x faster to read the answer than to compute it.\n`);

  console.log(`  A materialised view is a CACHED QUERY RESULT stored as a real table, with real indexes.
  Which means it is exactly as stale as its last refresh, and the interesting question is never
  "should I use one" but "how do I refresh it".

    REFRESH MATERIALIZED VIEW               takes ACCESS EXCLUSIVE. It blocks READS — see the
                                            table above. On a dashboard view refreshed every five
                                            minutes, that is a periodic outage of your dashboard.
    REFRESH MATERIALIZED VIEW CONCURRENTLY  builds the new contents alongside, then diffs them in.
                                            Readers never block. Requires a UNIQUE index, is
                                            slower, and needs roughly double the space during the
                                            refresh.

  Use CONCURRENTLY. The unique-index requirement is not a formality — it is how the diff is
  computed — and forgetting it is why people believe CONCURRENTLY is unavailable.

  WHEN A MATVIEW IS THE WRONG TOOL
    · you need the answer to be current. A matview is stale by construction; if "stale by up to
      five minutes" is not acceptable, stop here.
    · the refresh is expensive and the data is append-only. Then you want an INCREMENTAL rollup —
      a real table, updated by trigger or by a job that processes only new rows, with an upsert
      (drill 14). More code, and it scales with new data instead of with total data.
    · you only need it fast, not precomputed. Try an index first. A matview is a second copy of
      your data, with its own staleness and its own refresh failure mode.`);
}

// ---------------------------------------------------------------------------
rule('5. LISTEN/NOTIFY — the database tells you');
{
  const listener = mk(1);
  const notifier = mk(1);

  const latencies = [];
  let unlisten;
  await new Promise(async (ready) => {
    unlisten = await listener.listen('lab10_events', (payload) => {
      const sentAt = Number(payload);
      if (Number.isFinite(sentAt)) latencies.push(performance.now() - sentAt);
    });
    ready();
  });

  for (let i = 0; i < 20; i++) {
    await notifier.notify('lab10_events', String(performance.now()));
    await sleep(15);
  }
  await sleep(150);
  latencies.sort((a, b) => a - b);

  const POLL_MS = 1000;
  table([
    { approach: 'LISTEN/NOTIFY', 'detection delay': `p50 ${latencies.length ? latencies[Math.floor(latencies.length / 2)].toFixed(2) : '?'}ms, p99 ${latencies.length ? latencies.at(-1).toFixed(2) : '?'}ms`, 'queries per minute per worker': '0' },
    { approach: `polling every ${POLL_MS}ms`, 'detection delay': `${POLL_MS / 2}ms average, ${POLL_MS}ms worst`, 'queries per minute per worker': String(60_000 / POLL_MS) },
  ], ['approach', 'detection delay', 'queries per minute per worker']);
  note(`${latencies.length} of 20 notifications received`);

  await unlisten?.unlisten?.();
  await listener.end();
  await notifier.end();

  console.log(`
  Sub-millisecond, and zero queries while idle. Polling every second costs 60 queries a minute per
  worker — with 20 workers that is 1,200 queries a minute to discover nothing has happened — and
  still adds half a second of latency on average.

  NOTIFY IS TRANSACTIONAL, which is the property that makes it genuinely useful: the notification
  is delivered on COMMIT, and not at all if you roll back. So

      INSERT INTO jobs (...) VALUES (...);
      NOTIFY jobs_ready;

  in one transaction can never tell a worker about a job that does not exist. Compare with
  publishing to Redis from inside a database transaction, which absolutely can (and is what the
  outbox pattern exists to fix — caching-and-queues drill 04).

  AND THE LIMITS, all of which matter:
    · NOT PERSISTENT. A listener that is disconnected at the moment of the NOTIFY never learns it
      happened. There is no backlog and no replay. So NOTIFY is a HINT — "there might be work" —
      and the worker must still be able to find the work by querying. The correct pattern is:
      poll slowly as a floor (every 30s), and let NOTIFY collapse the latency to nothing in the
      common case. Never NOTIFY alone.
    · payload limit is 8000 bytes, and you should not use it for data anyway — send an id, or
      nothing, and let the worker read the row. The payload can arrive after the row has changed
      again.
    · duplicate notifications in one transaction are collapsed; identical payloads are deduped.
    · it needs a SESSION, so it does not survive PgBouncer in transaction mode (lab 09). Run
      listeners on a direct connection.
    · the whole queue is a single shared 8GB buffer for the cluster. A listener that stops reading
      while notifications keep arriving can fill it and then NOTIFY starts failing — for everyone.
    · notifications do NOT cross to replicas.

  WHEN TO USE IT: cache invalidation, "wake up, there is a job", config reload, pushing a change
  to a WebSocket fan-out (realtime drill 02). Anywhere a hint saves a poll.
  WHEN NOT TO: as your message queue. No persistence, no acknowledgement, no consumer groups, no
  replay — the same limits as Redis pub/sub, for the same reasons. If losing a message matters,
  you want a table you poll or a real broker (jobs-and-messaging drill 02).`);
}

rule('cleanup');
await sql.unsafe(`DROP MATERIALIZED VIEW IF EXISTS lab10_rollup`);
await sql.unsafe(`DROP TABLE IF EXISTS lab10_plain CASCADE`);
await sql.unsafe(`DROP TABLE IF EXISTS lab10_part CASCADE`);
good('dropped everything this lab created');
await sql.end();
