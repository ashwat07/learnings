/**
 * The drill runner. Each drill is a REAL problem with a MACHINE-CHECKED target.
 *
 *   node postgres/drills/run.mjs            run them all
 *   node postgres/drills/run.mjs 03         run one
 *   node postgres/drills/run.mjs --solution show the reference answer for the ones you pass
 *
 * You edit `solution.sql` in each drill folder. The runner applies it, runs the drill's query,
 * and asserts things you cannot fake: the plan must not contain a Seq Scan, the query must touch
 * fewer than N buffers, the results must be identical to the reference.
 *
 * Everything the runner creates is dropped again afterwards, so drills do not contaminate
 * each other or the labs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql, explain, buffers, usesSeqScan, usesIndex, rule, good, bad, note, table } from '../../lib/db.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const filter = process.argv.find((a) => /^\d+$/.test(a));
const showSolution = process.argv.includes('--solution');

const drills = fs.readdirSync(here)
  .filter((d) => fs.statSync(path.join(here, d)).isDirectory())
  .filter((d) => !filter || d.startsWith(filter))
  .sort();

const stripComments = (s) => s.replace(/^\s*--.*$/gm, '');

/**
 * Drop every index that is NOT backing a constraint, on every lab table. Without this a drill can
 * "pass" because a previous lab left an index behind — which is exactly what happened the first
 * time this runner was written.
 */
async function resetIndexes() {
  const rows = await sql`
    SELECT indexrelid::regclass::text AS name
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    WHERE c.relname IN ('orders', 'users', 'products', 'order_items', 'events')
      AND NOT i.indisprimary
      AND NOT EXISTS (SELECT 1 FROM pg_constraint x WHERE x.conindid = i.indexrelid)`;
  for (const r of rows) await sql.unsafe(`DROP INDEX IF EXISTS ${r.name}`);
  const stats = await sql`SELECT oid::regclass::text AS name FROM pg_statistic_ext`;
  for (const r of stats) await sql.unsafe(`DROP STATISTICS IF EXISTS ${r.name}`);
}

let passed = 0, failed = 0;

for (const dir of drills) {
  const meta = await import(path.join(here, dir, 'meta.mjs'));
  const solutionPath = path.join(here, dir, 'solution.sql');
  const yours = fs.readFileSync(solutionPath, 'utf8');
  const reference = fs.readFileSync(path.join(here, dir, 'reference.sql'), 'utf8');

  rule(`${dir} — ${meta.title}`);
  console.log(`  \x1b[1mTASK\x1b[0m  ${meta.task.replace(/\n/g, '\n        ')}`);
  console.log(`  \x1b[1mPASS IF\x1b[0m  ${meta.passIf}\n`);

  // A clean slate, every time. Drills must not be able to pass on someone else's index.
  await resetIndexes();
  await meta.setup?.(sql);
  const applied = stripComments(yours);
  // A BEHAVIOURAL drill (concurrency, queues) does not apply your SQL as DDL — it hands the
  // statement to its own harness, which runs it on several real connections at once.
  if (applied.trim() && !meta.behavioural) {
    try { await sql.unsafe(applied); }
    catch (e) { bad(`your solution.sql failed to run: ${e.message}`); failed++; await meta.teardown?.(sql); continue; }
  }
  await sql.unsafe('ANALYZE');

  const result = await evaluate(meta, applied);
  report(result, meta);

  if (result.pass) { passed++; } else {
    failed++;
    if (!applied.trim()) note('solution.sql is empty — that is the starting state. Open it.');
  }

  if (showSolution || (!result.pass && process.env.SHOW_SOLUTION)) {
    console.log('\n  \x1b[2mreference answer:\x1b[0m');
    console.log(reference.split('\n').map((l) => '    \x1b[2m' + l + '\x1b[0m').join('\n'));
  }

  await meta.teardown?.(sql);
  await cleanup(applied);
}

rule('result');
console.log(`  ${passed} passing, ${failed} to go\n`);
if (failed) {
  note('Open the solution.sql for a failing drill and write the DDL. Run again.');
  note('Stuck? `node postgres/drills/run.mjs 03 --solution` shows the reference answer.');
}
await sql.end();
process.exit(0);

// ---------------------------------------------------------------------------

async function evaluate(meta, userSql = '') {
  const e = await explain(meta.query);
  const b = buffers(e.nodes);
  const rows = await sql.unsafe(meta.query);
  const checks = [];
  if (meta.behavioural) {
    for (const c of await meta.custom(sql, { plan: e, buffers: b, rows }, { userSql })) checks.push(c);
    return { checks, pass: checks.every((c) => c.pass), e, b };
  }

  if (meta.maxBuffers != null) {
    const total = b.hit + b.read;
    checks.push({ check: `buffers <= ${meta.maxBuffers}`, actual: total, pass: total <= meta.maxBuffers });
  }
  if (meta.noSeqScanOn) {
    const seq = e.nodes.some((n) => n['Node Type'] === 'Seq Scan' && n['Relation Name'] === meta.noSeqScanOn);
    checks.push({ check: `no Seq Scan on ${meta.noSeqScanOn}`, actual: seq ? 'Seq Scan present' : 'none', pass: !seq });
  }
  if (meta.requireIndex) {
    checks.push({ check: 'uses an index', actual: usesIndex(e.nodes) ? 'yes' : 'no', pass: usesIndex(e.nodes) });
  }
  if (meta.requireNodeType) {
    const has = e.nodes.some((n) => n['Node Type'] === meta.requireNodeType);
    checks.push({ check: `plan contains ${meta.requireNodeType}`, actual: has ? 'yes' : e.nodes.map((n) => n['Node Type']).join(', ').slice(0, 40), pass: has });
  }
  if (meta.maxHeapFetches != null) {
    const hf = e.nodes.reduce((n, x) => n + (x['Heap Fetches'] ?? 0), 0);
    checks.push({ check: `Heap Fetches <= ${meta.maxHeapFetches}`, actual: hf, pass: hf <= meta.maxHeapFetches });
  }
  if (meta.maxEstimateError != null) {
    const n = e.nodes.find((x) => x['Actual Rows'] != null && x['Plan Rows'] != null && x['Node Type'] !== 'Gather');
    const err = Math.max(n['Actual Rows'], 1) / Math.max(n['Plan Rows'], 1);
    const ratio = err < 1 ? 1 / err : err;
    checks.push({ check: `row estimate within ${meta.maxEstimateError}x`, actual: `${ratio.toFixed(1)}x`, pass: ratio <= meta.maxEstimateError });
  }
  if (meta.expectRows != null) {
    checks.push({ check: `returns ${meta.expectRows} rows`, actual: rows.length, pass: rows.length === meta.expectRows });
  }
  if (meta.custom) {
    for (const c of await meta.custom(sql, { plan: e, buffers: b, rows }, { userSql })) checks.push(c);
  }

  return { checks, pass: checks.every((c) => c.pass), e, b };
}

function report({ checks, pass, e, b }, meta) {
  table(checks.map((c) => ({ check: c.check, actual: String(c.actual), '': c.pass ? 'ok' : 'FAIL' })), ['check', 'actual', '']);
  console.log();
  if (!meta.behavioural) note(`plan: ${e.summary.split('\n')[0].trim()}  ·  ${e.executionMs.toFixed(2)}ms  ·  ${b.hit + b.read} buffers`);
  (pass ? good : bad)(pass ? 'PASS' : 'not yet');
}

/** Drop anything the candidate DDL created, so drills stay independent. */
async function cleanup(ddl) {
  for (const m of ddl.matchAll(/create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?([a-z0-9_]+)/gi)) {
    await sql.unsafe(`DROP INDEX IF EXISTS ${m[1]}`);
  }
  for (const m of ddl.matchAll(/create\s+statistics\s+(?:if\s+not\s+exists\s+)?([a-z0-9_]+)/gi)) {
    await sql.unsafe(`DROP STATISTICS IF EXISTS ${m[1]}`);
  }
  for (const m of ddl.matchAll(/create\s+materialized\s+view\s+(?:if\s+not\s+exists\s+)?([a-z0-9_]+)/gi)) {
    await sql.unsafe(`DROP MATERIALIZED VIEW IF EXISTS ${m[1]}`);
  }
}

