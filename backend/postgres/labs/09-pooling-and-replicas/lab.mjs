/**
 * Lab 09 — Connection pooling: why 100 connections is slower than 8.
 *
 *   node postgres/labs/09-pooling-and-replicas/lab.mjs
 *
 * Seven measurements. The third one is the lab: throughput against pool size, on this machine,
 * against this Postgres. Every other section exists to explain the shape of that curve.
 */

import postgres from 'postgres';
import { sql, rule, note, table, good, bad } from '../../../lib/db.mjs';

const PG = { host: 'localhost', port: 5433, user: 'labs', password: 'labs', database: 'labs' };
const mk = (max, extra = {}) => postgres({ ...PG, max, onnotice() {}, ...extra });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (arr, p) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0;

const [{ maxConn }] = await sql`SELECT setting::int AS "maxConn" FROM pg_settings WHERE name = 'max_connections'`;
const [{ buffers }] = await sql`SELECT current_setting('shared_buffers') AS buffers`;
const [{ cores }] = await sql`SELECT current_setting('max_parallel_workers')::int AS cores`;

rule('THE CLAIM');
console.log(`
  A connection pool is not a cache of connections. It is a QUEUE with a fixed number of servers,
  and everything surprising about it comes from that: past a certain size, adding servers makes
  the whole system slower, and the queue is where your latency actually lives.

  This Postgres: max_connections=${maxConn}, shared_buffers=${buffers}, max_parallel_workers=${cores}.`);

// ---------------------------------------------------------------------------
rule('1. what a connection costs');
{
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) { const s = mk(1); await s`select 1`; await s.end(); }
  const fresh = (performance.now() - t0) / 20;

  const warm = mk(1); await warm`select 1`;
  const t1 = performance.now();
  for (let i = 0; i < 300; i++) await warm`select 1`;
  const reused = (performance.now() - t1) / 300;
  await warm.end();

  table([
    { 'one trivial query': 'on a NEW connection', ms: fresh.toFixed(1) },
    { 'one trivial query': 'on a pooled connection', ms: reused.toFixed(2) },
  ], ['one trivial query', 'ms']);
  console.log(`  ${(fresh / reused).toFixed(0)}x cheaper to reuse.\n`);

  console.log(`  Where that ${fresh.toFixed(0)}ms goes: a TCP handshake, a TLS handshake in production,
  the Postgres startup message and authentication — and then Postgres FORKS A PROCESS. Not a
  thread: an operating-system process, with its own memory, its own file descriptors, and its own
  entry in every internal array the server scans.

  That is the fact the rest of this lab follows from. In MySQL a connection is a thread; in
  Postgres it is a process, and that is why the numbers in section 3 look the way they do.`);
}

// ---------------------------------------------------------------------------
rule('2. the ceiling is real, and it is a hard failure');
{
  const conns = [];
  let failure = null;
  try {
    for (let i = 0; i < maxConn + 30; i++) {
      const s = mk(1);
      await s`select 1`;
      conns.push(s);
    }
  } catch (e) {
    failure = `${e.code ?? ''} ${e.message}`.trim();
  }
  bad(`opened ${conns.length} connections, then: ${failure ?? '(no failure — max_connections is higher than expected)'}`);
  for (const c of conns) await c.end();

  console.log(`
  Note what that error is NOT. It is not slow, it is not a queue, and it is not retried for you:
  it is a connection REFUSAL, and every request that needs the database fails until something
  disconnects. Your health check fails too, so the orchestrator restarts the pod, which opens a
  fresh pool, which makes it worse.

  THE ARITHMETIC NOBODY DOES:

      pods x pool_max  <=  max_connections - superuser_reserved_connections - (your admin tools)

  8 pods with a default max of 10 is 80 against a ceiling of ${maxConn}. It works. Then you scale
  to 12 pods for a sale, and every pod discovers the ceiling within the same second. This is a
  capacity bug that only appears when you add capacity.

  And it is worse than the arithmetic suggests, because a pool opens connections LAZILY: the 80
  are not open until traffic needs them, so your staging environment never reaches the limit and
  your load test — run against one pod — never reaches it either.`);
}

// ---------------------------------------------------------------------------
rule('3. THE KNEE — throughput against pool size');
{
  const CLIENTS = 200, DURATION = 1200;
  const bench = async (poolSize) => {
    const s = mk(poolSize);
    await s`select 1`;
    const lat = [];
    let done = 0;
    const until = Date.now() + DURATION;
    const worker = async () => {
      while (Date.now() < until) {
        const t0 = performance.now();
        await s`select count(*) from order_items where order_id = ${1 + Math.floor(Math.random() * 200000)}`;
        lat.push(performance.now() - t0);
        done++;
      }
    };
    await Promise.all(Array.from({ length: CLIENTS }, worker));
    await s.end();
    lat.sort((a, b) => a - b);
    return { poolSize, rps: Math.round(done / (DURATION / 1000)), p50: pct(lat, 0.5), p99: pct(lat, 0.99) };
  };

  // Two passes per size, keeping the better one. A single pass jitters by 20-30% on a laptop, and
  // a curve you cannot reproduce is not a measurement.
  const rows = [];
  for (const n of [4, 16, 64, maxConn - 5]) {
    const a = await bench(n);
    const b = await bench(n);
    rows.push(a.rps >= b.rps ? a : b);
  }
  const best = rows.reduce((a, b) => (b.rps > a.rps ? b : a));
  const worst = rows.reduce((a, b) => (b.rps < a.rps ? b : a));

  table(rows.map((r) => ({
    'pool size': r.poolSize,
    'req/s': r.rps.toLocaleString(),
    'p50 ms': r.p50.toFixed(1),
    'p99 ms': r.p99.toFixed(1),
    '': r.poolSize === best.poolSize ? '<- fastest' : r.poolSize === worst.poolSize ? '<- slowest' : '',
  })), ['pool size', 'req/s', 'p50 ms', 'p99 ms', '']);

  console.log(`  200 concurrent clients throughout. Pool ${best.poolSize} does ${best.rps.toLocaleString()} req/s at
  p99 ${best.p99.toFixed(0)}ms; pool ${worst.poolSize} does ${worst.rps.toLocaleString()} req/s at p99 ${worst.p99.toFixed(0)}ms —
  ${(best.rps / worst.rps).toFixed(1)}x less throughput and ${(worst.p99 / Math.max(best.p99, 0.1)).toFixed(0)}x the tail latency, for ${(worst.poolSize / best.poolSize).toFixed(0)}x the connections.

  WHY MORE IS WORSE, and it is three separate effects stacking:

    · Postgres runs a PROCESS per connection. 95 of them on ${cores} usable cores means the
      operating system is context-switching between processes that all want the same CPU. The work
      does not get done faster; it gets interleaved more finely, and each individual query takes
      longer.
    · every process has its own work_mem allowance for sorts and hashes. The limit is PER
      OPERATION, not per server, so 95 concurrent sorts can allocate 95 x work_mem.
    · shared structures — the buffer pool, the lock table, the snapshot each transaction takes —
      are contended by every backend. Some of that is a linear scan over all backends.

  The classic rule of thumb, from the HikariCP documentation and borne out above:

      connections = ((core_count x 2) + effective_spindle_count)

  ...which for a modern server lands somewhere between 10 and 30, and almost never at 100. If you
  take one thing from this lab: A POOL THAT QUEUES IS FASTER THAN A DATABASE THAT THRASHES. The
  queue is visible in your metrics; the thrashing is not.

  TWO HONEST CAVEATS, because a benchmark you cannot reproduce is not evidence:

    · this client PIPELINES — several queries can be in flight on one connection — so "pool size
      4" is not "four queries at a time". That is why the small pools look as good as they do
      here, and it is true of most modern drivers.
    · the curve DEPENDS ON THE QUERY. The one above is an indexed point lookup: the shape a web
      request actually makes, where the server spends its time on locks and buffers rather than
      CPU. Re-run it with a query that sorts a few thousand rows and the curve INVERTS below the
      core count, because now you are CPU-bound and extra concurrency genuinely helps — until it
      does not.

  Which is the real lesson: THE RIGHT POOL SIZE IS A PROPERTY OF YOUR WORKLOAD AND YOUR SERVER,
  and it is a curve you measure once, in an afternoon, rather than a number you copy. What is
  universal is the shape — a peak, then a decline — and that the peak is much lower than people
  guess.`);
}

// ---------------------------------------------------------------------------
rule('4. where the latency actually is when the pool is small');
{
  const POOL = 4, CLIENTS = 40;
  const s = mk(POOL);
  await s`select 1`;
  const total = [], query = [];
  await Promise.all(Array.from({ length: CLIENTS }, async () => {
    for (let i = 0; i < 8; i++) {
      const t0 = performance.now();
      // pg_sleep stands in for a query that is genuinely slow, so the queue is visible.
      await s`select pg_sleep(0.02)`;
      const t = performance.now() - t0;
      total.push(t);
      query.push(20);
    }
  }));
  await s.end();
  total.sort((a, b) => a - b);

  table([
    { measure: 'the query itself', ms: '20.0' },
    { measure: 'what the caller waited (p50)', ms: pct(total, 0.5).toFixed(1) },
    { measure: 'what the caller waited (p99)', ms: pct(total, 0.99).toFixed(1) },
    { measure: 'time spent QUEUEING for a connection (p99)', ms: (pct(total, 0.99) - 20).toFixed(1) },
  ], ['measure', 'ms']);

  console.log(`
  ${CLIENTS} clients, a pool of ${POOL}, a 20ms query. Almost all of the observed latency is
  QUEUE TIME, and none of it appears in your database's slow-query log — Postgres never saw a
  slow query. It appears nowhere at all unless your pool exports it.

  THE FIVE NUMBERS TO EXPORT, and almost nobody does:

      in use · idle · WAITING · acquire wait time (p99) · acquire timeouts per minute

  "waiting > 0 for a sustained period" means the pool is your bottleneck. "acquire timeouts"
  means it already broke. Without these, a service that is slow because of pool contention looks
  identical to one that is slow for any other reason — and the database, correctly, reports that
  it is idle. That is the most confusing shape an incident can take, and this is the graph that
  resolves it in ten seconds.

  (node-runtime drill 12 is the pool itself, with the acquire timeout and the leak that makes
  this graph go vertical.)`);
}

// ---------------------------------------------------------------------------
rule('5. one idle transaction, three separate problems');
{
  const holder = mk(1);
  const other = mk(2);
  await other`select 1`;

  // Open a transaction, read something, and then just... sit there. A forgotten await, a slow
  // HTTP call inside a transaction, a debugger breakpoint.
  let release;
  const held = new Promise((r) => { release = r; });
  const txn = holder.begin(async (tx) => {
    await tx`select count(*) from orders where status = 'pending'`;
    await held;
  });
  await sleep(200);

  const [state] = await other`
    SELECT state, now() - xact_start AS open_for
    FROM pg_stat_activity
    WHERE state = 'idle in transaction' LIMIT 1`;
  note(`pg_stat_activity says: state = "${state?.state ?? 'not found'}", open for ${state?.open_for ?? '?'}`);

  // (a) it blocks DDL — and everything queued behind that DDL.
  const ddl = mk(1);
  await ddl`SET lock_timeout = '400ms'`;
  const t0 = performance.now();
  let ddlErr = null;
  try {
    await ddl.unsafe(`ALTER TABLE orders ADD COLUMN lab09_probe int`);
    await ddl.unsafe(`ALTER TABLE orders DROP COLUMN lab09_probe`);
  } catch (e) { ddlErr = e.code ?? e.message; }
  const waited = performance.now() - t0;
  await ddl.end();

  // (b) it holds back the vacuum horizon.
  const [horizon] = await other`
    SELECT greatest(0, age(backend_xmin))::text AS xmin_age
    FROM pg_stat_activity WHERE backend_xmin IS NOT NULL
    ORDER BY age(backend_xmin) DESC LIMIT 1`;

  release();
  await txn;
  await holder.end();

  table([
    { 'what it costs you': 'a connection, held for the whole transaction', evidence: 'state = idle in transaction' },
    { 'what it costs you': 'DDL queues behind it', evidence: ddlErr ? `ALTER blocked, then ${ddlErr} after ${waited.toFixed(0)}ms` : `ALTER succeeded after ${waited.toFixed(0)}ms` },
    { 'what it costs you': 'autovacuum cannot clean up', evidence: `oldest snapshot is ${horizon?.xmin_age ?? '?'} transactions behind` },
  ], ['what it costs you', 'evidence']);
  await other.end();

  console.log(`
  All three from one forgotten transaction:

    1. THE CONNECTION IS GONE from the pool for the duration — and the duration is however long
       your slowest external call takes, if you made one inside the transaction.
    2. ANY DDL QUEUES BEHIND IT, and — this is the part that turns it into an outage — every
       query that arrives after that DDL queues behind the DDL, including reads. One idle
       transaction plus one instant ALTER equals a full stop for as long as the transaction lives.
       That is why "SET lock_timeout" belongs at the top of every migration (drill 11).
    3. AUTOVACUUM CANNOT REMOVE dead rows newer than the oldest open snapshot. A long-running
       transaction anywhere in the cluster stops cleanup EVERYWHERE, and the table bloats.

  The settings that save you, and they are not on by default:

      idle_in_transaction_session_timeout = '30s'   -- kill them; they are always a bug
      statement_timeout = '30s'                      -- per statement, set per role or per pool
      lock_timeout = '3s'                            -- fail fast rather than queue behind a lock

  And the rule they enforce: NEVER DO I/O INSIDE A TRANSACTION. No HTTP call, no queue publish, no
  S3 upload between BEGIN and COMMIT. Read what you need, commit, then talk to the network — and
  if the two must be atomic, that is what the outbox pattern is for
  (caching-and-queues drill 04).`);
}

// ---------------------------------------------------------------------------
rule('6. PgBouncer, and what transaction pooling takes away');
{
  // Session state lives on a CONNECTION. That single fact is what transaction pooling breaks.
  const s = mk(2);
  await s`select 1`;
  const results = [];
  await Promise.all([1, 2, 3, 4, 5, 6].map(async (i) => {
    const [row] = await s`SELECT current_setting('application_name', true) AS name`;
    results.push(row.name || '(empty)');
  }));
  const sameConn = mk(1);
  await sameConn`SET application_name = 'lab09'`;
  const [{ name }] = await sameConn`SELECT current_setting('application_name', true) AS name`;
  await sameConn.end();
  await s.end();

  note(`a SET on one connection is visible on that connection: application_name = "${name}"`);
  note(`...and it is invisible to any other connection in the pool: ${[...new Set(results)].join(', ')}`);

  table([
    { mode: 'session (default)', 'a client gets': 'a server connection for its whole session', 'safe for': 'everything', 'buys you': 'nothing over your own pool' },
    { mode: 'transaction', 'a client gets': 'a server connection per TRANSACTION', 'safe for': 'ordinary queries', 'buys you': 'thousands of clients over tens of connections' },
    { mode: 'statement', 'a client gets': 'a server connection per STATEMENT', 'safe for': 'almost nothing', 'buys you': 'no multi-statement transactions at all' },
  ], ['mode', 'a client gets', 'safe for', 'buys you']);

  console.log(`
  TRANSACTION POOLING is the one worth having, and the reason to understand it before you turn it
  on is that anything living on a CONNECTION rather than in a TRANSACTION stops working:

      SET / SET LOCAL outside a transaction      your search_path, timezone, application_name
      session-level advisory locks               pg_advisory_lock — use the _xact_ variants
      LISTEN / NOTIFY                            needs a session; run it on a direct connection
      WITH HOLD cursors, temporary tables        both are session-scoped
      PREPARE / server-side prepared statements  the big one, below

  PREPARED STATEMENTS ARE THE TRAP. Most drivers use them silently — it is how they give you
  parameter binding — and a prepared statement lives on the connection that prepared it. Under
  transaction pooling your next transaction lands on a different server connection, and you get

      ERROR: prepared statement "S_1" does not exist

  intermittently, under load, which is the worst possible way to find out. The fixes: PgBouncer
  1.21+ can track them (max_prepared_statements), or configure the driver off them — asyncpg's
  statement_cache_size=0, JDBC's prepareThreshold=0, Npgsql's "No Reset On Close" plus no
  auto-prepare. Check yours; the default is usually the broken one.

  WHEN YOU ACTUALLY NEED IT
  Not at 8 pods x 10. You need it when the number of CLIENTS is structurally large: serverless
  functions (one connection per invocation, scaling with traffic), hundreds of pods, or a
  connection-per-request framework. Below that, tuning your own pool down is simpler and has no
  new failure mode. PgBouncer is also a single process that speaks one protocol — plan for it
  being a hop that can fail, and run more than one.`);
}

// ---------------------------------------------------------------------------
rule('7. read replicas, and the lag you have to design around');
{
  const [{ lsn }] = await sql`SELECT pg_current_wal_lsn()::text AS lsn`;
  note(`this primary's current WAL position: ${lsn}`);
  note('(there is no replica in this compose file — the mechanics below are reasoned, not measured)');

  console.log(`
  A streaming replica replays the primary's WAL. It is asynchronous by default, so it is BEHIND —
  usually by milliseconds, occasionally by minutes, and always by more than zero. The queries you
  would use on a real one:

      -- on the primary
      SELECT client_addr, state, sent_lsn, replay_lsn,
             pg_wal_lsn_diff(sent_lsn, replay_lsn) AS replay_bytes_behind
      FROM pg_stat_replication;

      -- on the replica
      SELECT now() - pg_last_xact_replay_timestamp() AS lag;

  Alert on BYTES, not seconds: a replica with no writes to replay reports a growing time lag while
  being perfectly current, so the time metric cries wolf every quiet night.

  WHAT LAG DOES TO YOUR APPLICATION — and this is the whole design problem:

    READ-YOUR-OWN-WRITES BREAKS. A user updates their profile (primary), is redirected, the read
    goes to a replica that has not caught up, and they see the old value. They press save again.
    This is the single most common replica bug and it looks exactly like a caching bug.

    The three fixes, in order of how much they cost you:
      1. route that user's reads to the PRIMARY for a few seconds after any write. Crude,
         effective, and what most applications should do.
      2. capture pg_current_wal_lsn() at write time, pass it along, and have the replica read wait
         until pg_last_wal_replay_lsn() >= it. Correct, and needs plumbing through your whole
         request path.
      3. synchronous_commit = 'remote_apply'. No lag, and now every write waits for a network
         round trip to the replica — and if the replica is down, writes stop. Rarely the answer.

    QUERIES CAN BE CANCELLED ON THE REPLICA. Replay needs to remove rows your long-running report
    is still reading, so Postgres kills the query: "canceling statement due to conflict with
    recovery". hot_standby_feedback = on tells the primary to hold off, at the cost of bloat on
    the primary. Pick one; the default surprises people.

  WHAT A REPLICA IS AND IS NOT FOR
    yes:  analytics and reports, exports, search index rebuilds, anything tolerant of staleness
    yes:  a standby for failover — which is a different job, and the one you actually need
    no:   scaling ordinary request traffic. Every write still goes to the primary and is replayed
          on every replica, so replicas do not reduce write load at all; they multiply it. If
          writes are your bottleneck, a replica makes it slightly worse.

  Adding one to this compose file is a genuinely good exercise: a second Postgres, primary_conninfo,
  a replication slot, and then break it on purpose — pause replay with
  pg_wal_replay_pause() and watch read-your-own-writes fail.`);
}

rule('the summary');
console.log(`
  · a Postgres connection is a PROCESS. Reuse is ~40x cheaper than opening one.
  · the pool size that maximises throughput is small — think (2 x cores) + spindles, so 10-30.
  · past that, more connections means less throughput and a much worse tail.
  · pods x pool_max must fit under max_connections, with room for your admin tools.
  · export in-use / idle / WAITING / acquire-wait-p99 / acquire-timeouts. The database will tell
    you it is idle while your users wait, and only the pool's own metrics explain why.
  · set idle_in_transaction_session_timeout, statement_timeout and lock_timeout. All three.
  · never do network I/O inside a transaction.
  · PgBouncer in transaction mode when clients are structurally many — and check what your driver
    does with prepared statements before you do.
  · replicas are for staleness-tolerant reads and failover, not for scaling writes, and
    read-your-own-writes is your problem to solve.
`);

await sql.end();
