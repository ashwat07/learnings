/**
 * Lab 02 — Reading a plan.
 *
 *   node postgres/labs/02-explain-analyze/lab.mjs
 *
 * Five plans, each chosen to teach one thing you have to be able to spot at a glance.
 */

import { sql, explain, buffers, rule, note, good, bad, table } from '../../../lib/db.mjs';

const show = async (label, query, lesson) => {
  const e = await explain(query);
  const b = buffers(e.nodes);
  rule(label);
  console.log('  ' + query.trim().replace(/\n\s+/g, '\n  '));
  console.log();
  console.log(e.summary.split('\n').map((l) => '  ' + l).join('\n'));
  console.log();
  note(`planning ${e.planningMs.toFixed(2)}ms · execution ${e.executionMs.toFixed(2)}ms · ` +
       `buffers hit ${b.hit} read ${b.read}`);
  if (lesson) console.log('\n  ' + lesson.replace(/\n/g, '\n  '));
  return { e, b };
};

// ---------------------------------------------------------------------------

rule('READ THIS FIRST');
console.log(`
  A plan is a TREE, and it executes from the LEAVES UPWARD. The indented lines are children; they
  run first and feed their parent.

  Every node reports four numbers, and you compare them in this order:

    1. actual rows  vs  planned rows   → is the planner's ESTIMATE right? If it is off by 100x,
                                          every decision above this node was made on bad
                                          information, and that is your bug.
    2. actual time                     → where the time actually went. Note it is CUMULATIVE:
                                          a parent's time includes its children's.
    3. buffers hit / read              → how much data was touched. The number that survives
                                          the trip to production.
    4. loops                           → a node with loops=5000 ran five thousand times.
                                          Its "actual time" is PER LOOP; multiply.

  And the single most useful habit: run EXPLAIN (ANALYZE, BUFFERS), never bare EXPLAIN. Bare
  EXPLAIN shows you what the planner GUESSED. You want to know what happened.`);

// 1. A sequential scan, and what "cost" units are.
await show('1. a sequential scan',
  `SELECT count(*) FROM orders WHERE total_cents > 300000`,
  `Seq Scan means Postgres read EVERY row. That is not automatically wrong — for a predicate that
matches a large fraction of the table, a sequential read is FASTER than an index, because it
reads pages in order instead of jumping around. The planner chose this deliberately.

Look at the buffer count above: that is the whole table, in 8KB pages. Multiply by 8KB to see how
much reading it took to produce one number.`);

// 2. Index scan vs bitmap scan — the same query, both ways.
await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id)`);
await sql.unsafe('ANALYZE orders');
const q2 = `SELECT * FROM orders WHERE user_id = 42`;
await show('2a. what the planner chose', q2,
  `An index gets you from "read 200,000 rows" to "read the 85 you want". The node type tells you
HOW it fetched them, and the planner picks between two strategies by estimated row count.`);

// Forcing the alternative is the single most useful debugging technique in Postgres: you cannot
// argue with the planner, but you can ask "what would the other plan have cost?"
await sql.unsafe('SET enable_bitmapscan = off');
await show('2b. the same query with bitmap scans DISABLED', q2,
  `A plain Index Scan walks the index and fetches each row from the heap ONE AT A TIME, in index
order — which is random order on disk. A Bitmap Heap Scan collects the matching PAGES first and
reads them in PHYSICAL order, turning random I/O into sequential I/O.

That is why bitmap wins as soon as more than a handful of rows match, and it is why an index that
matches 30% of a table can be SLOWER than reading the table in order: every match is a random
page read.

The technique matters more than the result: SET enable_<node> = off does not belong in
production, but it is how you find out what the planner was comparing against.`);
await sql.unsafe('SET enable_bitmapscan = on');

// 3. A bitmap scan — the middle ground people never recognise.
await show('3. a bitmap heap scan',
  `SELECT * FROM orders WHERE user_id BETWEEN 100 AND 4000`,
  `Bitmap Index Scan → Bitmap Heap Scan is what Postgres does when an index matches TOO MANY rows
for a plain index scan but too few for a sequential one.

It reads the index, builds a bitmap of which PAGES contain matches, then reads those pages IN
PHYSICAL ORDER. That converts random I/O into sequential I/O, which is the entire point.

If you see "Recheck Cond" and "lossy" in the output, the bitmap ran out of work_mem and degraded
to page granularity — a signal that work_mem is too small for this query.`);

// 4. A join, and the three join strategies.
await show('4. a join',
  `SELECT u.country, count(*)
   FROM orders o JOIN users u ON u.id = o.user_id
   WHERE o.created_at >= now() - interval '30 days'
   GROUP BY u.country`,
  `Three join strategies, and the planner picks by estimated size:

  Nested Loop   for each row on the left, look up the right. Great when the left side is TINY.
                A nested loop over a big left side with no index on the right is the classic
                O(n*m) disaster.
  Hash Join     build a hash table of the smaller side, probe it with the larger. The default
                for big unsorted joins. Watch for "Batches: 4" — that means it spilled to disk
                because work_mem was too small.
  Merge Join    both sides sorted, walk them together. Cheap if the inputs are already sorted
                (e.g. both come from indexes), expensive if it has to sort them.

If a join is slow, the question is almost never "which strategy" — it is "why is the row estimate
wrong", because the estimate is what chose the strategy.`);

// 5. The estimate being wrong, on purpose — the most important lesson in the lab.
rule('5. when the planner is WRONG');
const CORRELATED = `SELECT * FROM orders WHERE status = 'pending' AND shipped_at IS NULL`;
const est = async () => {
  const e = await explain(CORRELATED);
  const n = e.nodes.find((x) => x['Actual Rows'] != null && x['Plan Rows'] != null && x['Node Type'] !== 'Gather');
  return { planned: n['Plan Rows'], actual: n['Actual Rows'], node: n['Node Type'] };
};

console.log(`  ${CORRELATED}\n`);
const before = await est();

// The fix, applied live — in two steps, because WHICH KIND of statistics you ask for matters and
// the difference is not documented anywhere prominent.
await sql.unsafe(`CREATE STATISTICS orders_dep (dependencies, ndistinct) ON status, shipped_at FROM orders`);
await sql.unsafe('ANALYZE orders');
const withDeps = await est();
await sql.unsafe('DROP STATISTICS orders_dep');

await sql.unsafe(`CREATE STATISTICS orders_mcv (dependencies, ndistinct, mcv) ON status, shipped_at FROM orders`);
await sql.unsafe('ANALYZE orders');
const withMcv = await est();

table([
  { statistics: 'default (columns assumed independent)', planned: before.planned, actual: before.actual, 'off by': `${(before.actual / before.planned).toFixed(1)}x` },
  { statistics: '+ dependencies, ndistinct', planned: withDeps.planned, actual: withDeps.actual, 'off by': `${(withDeps.actual / withDeps.planned).toFixed(1)}x` },
  { statistics: '+ mcv', planned: withMcv.planned, actual: withMcv.actual, 'off by': `${(withMcv.actual / withMcv.planned).toFixed(1)}x` },
], ['statistics', 'planned', 'actual', 'off by']);

console.log(`
  In this data every 'pending' order has a NULL shipped_at — the columns are perfectly dependent.
  Postgres estimates a multi-column predicate by MULTIPLYING the selectivities, which assumes they
  are INDEPENDENT, so it expects the two filters to compound and predicts far too few rows.

  Extended statistics tell the planner the truth — but LOOK AT THE MIDDLE ROW. Adding
  "dependencies" changed almost nothing, because functional-dependency statistics only apply to
  EQUALITY predicates, and "shipped_at IS NULL" is not one. Only "mcv" — which stores the actual
  most-common COMBINATIONS of values — fixes it:

    CREATE STATISTICS orders_stats (dependencies, ndistinct, mcv)
      ON status, shipped_at FROM orders;
    ANALYZE orders;

  So the practical advice is: ask for all three kinds unless you have a reason not to. "mcv" costs
  more to collect and store, and it is the one that actually rescues most real queries.

  Almost nobody uses any of this, and it is the highest-leverage fix for a whole class of "why did
  it pick a nested loop" problems. A wrong estimate is not cosmetic — it is what makes the planner
  choose a nested loop over a hash join and turn 20ms into 20 seconds.`);

// ---------------------------------------------------------------------------
rule('the checklist for any slow query');
console.log(`
  1. actual vs planned rows, at EVERY node. Find the first node where they diverge — everything
     above it was decided on a lie.
  2. Seq Scan on a big table with a selective predicate  → a missing index (lab 03).
  3. loops = N on the inner side of a Nested Loop        → an N+1 in the plan itself (lab 08).
  4. "Sort Method: external merge  Disk: 12MB"           → work_mem too small; it spilled.
  5. "Batches: 8" on a Hash Join                         → the same, for hashing.
  6. buffers read >> buffers hit                         → cold cache, or the working set does
                                                            not fit in shared_buffers.
  7. Rows Removed by Filter: 4,000,000                   → the index found rows the predicate
                                                            then threw away. Index the right thing.

  And two things that are NOT in the plan and catch people out:
  · planning time can exceed execution time on simple queries with many partitions or indexes
  · EXPLAIN ANALYZE actually RUNS the query — including the INSERT/UPDATE/DELETE. Wrap it in a
    transaction and ROLLBACK if you do not mean it.`);

await sql.unsafe('DROP INDEX IF EXISTS idx_orders_user');
await sql.unsafe('DROP STATISTICS IF EXISTS orders_mcv');
await sql.end();
