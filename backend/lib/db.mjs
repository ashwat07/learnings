/**
 * The database handle every lab uses, plus the two helpers that make these labs measurable:
 * `explain()` and `bench()`.
 *
 * Everything is deliberately thin. You should be able to read this file in three minutes and then
 * trust every number the labs print.
 */

import postgres from 'postgres';

export const sql = postgres({
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5433),
  user: process.env.PGUSER ?? 'labs',
  password: process.env.PGPASSWORD ?? 'labs',
  database: process.env.PGDATABASE ?? 'labs',
  max: Number(process.env.PGPOOL ?? 10),
  idle_timeout: 20,
  onnotice: () => {},
});

/**
 * Run EXPLAIN (ANALYZE, BUFFERS) and return the parts that matter.
 *
 * BUFFERS is the option people skip and it is the most informative one: `shared hit` vs `shared
 * read` tells you whether a query was served from the buffer cache or went to disk, which is
 * usually the difference between the number you measured and the number production will see.
 */
export async function explain(query, { analyze = true, verbose = false } = {}) {
  const opts = ['FORMAT JSON', analyze ? 'ANALYZE' : null, analyze ? 'BUFFERS' : null, verbose ? 'VERBOSE' : null]
    .filter(Boolean).join(', ');
  const [row] = await sql.unsafe(`EXPLAIN (${opts}) ${query}`);
  const plan = row['QUERY PLAN'][0];
  return {
    plan: plan.Plan,
    planningMs: plan['Planning Time'],
    executionMs: plan['Execution Time'],
    summary: summarise(plan.Plan),
    nodes: flatten(plan.Plan),
    raw: plan,
  };
}

/** A one-line-per-node description of what the planner chose — the thing you read first. */
function summarise(node, depth = 0) {
  const parts = [];
  const label = `${'  '.repeat(depth)}${node['Node Type']}` +
    (node['Relation Name'] ? ` on ${node['Relation Name']}` : '') +
    (node['Index Name'] ? ` using ${node['Index Name']}` : '');
  const rows = node['Actual Rows'] ?? null;
  const planned = node['Plan Rows'] ?? null;
  const ms = node['Actual Total Time'] ?? null;
  parts.push(`${label}${ms != null ? `  (${ms.toFixed(2)}ms` : ''}${rows != null ? `, rows ${rows}` : ''}${planned != null && rows != null ? ` vs planned ${planned}` : ''}${ms != null ? ')' : ''}`);
  for (const child of node.Plans ?? []) parts.push(summarise(child, depth + 1));
  return parts.join('\n');
}

function flatten(node, out = []) {
  out.push(node);
  for (const child of node.Plans ?? []) flatten(child, out);
  return out;
}

/** Total buffers touched — the number that survives both a warm cache and a cold one. */
export function buffers(nodes) {
  const sum = (k) => nodes.reduce((n, x) => n + (x[k] ?? 0), 0);
  return { hit: sum('Shared Hit Blocks'), read: sum('Shared Read Blocks'), dirtied: sum('Shared Dirtied Blocks') };
}

export const usesIndex = (nodes) => nodes.some((n) => /Index Scan|Index Only Scan|Bitmap Index Scan/.test(n['Node Type']));
export const usesSeqScan = (nodes) => nodes.some((n) => n['Node Type'] === 'Seq Scan');

/**
 * Run something N times and report the median, because a single timing on a database is noise: the
 * first run pays for cache misses and plan caching, and the mean is dominated by outliers.
 */
export async function bench(label, fn, { runs = 7, warmup = 2 } = {}) {
  for (let i = 0; i < warmup; i++) await fn();
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return { label, median: times[Math.floor(times.length / 2)], min: times[0], max: times.at(-1), runs };
}

// ---------------------------------------------------------------------------
// Output helpers, so every lab prints in the same shape.
// ---------------------------------------------------------------------------

export const rule = (s) => console.log(`\n\x1b[1m${s}\x1b[0m\n${'─'.repeat(Math.min(s.length, 78))}`);
export const good = (s) => console.log(`  \x1b[32m✓\x1b[0m ${s}`);
export const bad = (s) => console.log(`  \x1b[31m✗\x1b[0m ${s}`);
export const note = (s) => console.log(`  \x1b[2m${s}\x1b[0m`);

export function table(rows, columns) {
  if (!rows.length) return;
  const cols = columns ?? Object.keys(rows[0]);
  const width = Object.fromEntries(cols.map((c) => [c, Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length))]));
  const line = (cells) => '  ' + cols.map((c) => String(cells[c] ?? '').padEnd(width[c])).join('  ');
  console.log('\x1b[2m' + line(Object.fromEntries(cols.map((c) => [c, c]))) + '\x1b[0m');
  console.log('\x1b[2m' + '  ' + cols.map((c) => '─'.repeat(width[c])).join('  ') + '\x1b[0m');
  for (const r of rows) console.log(line(r));
}

/** Print a plan comparison — the standard shape for "before and after an index". */
export function comparePlans(a, b) {
  table([
    { plan: a.label, 'exec ms': a.executionMs.toFixed(2), scan: a.usesIndex ? 'index' : 'SEQ SCAN', 'buffers read': a.buffers.read, 'buffers hit': a.buffers.hit },
    { plan: b.label, 'exec ms': b.executionMs.toFixed(2), scan: b.usesIndex ? 'index' : 'SEQ SCAN', 'buffers read': b.buffers.read, 'buffers hit': b.buffers.hit },
  ], ['plan', 'exec ms', 'scan', 'buffers read', 'buffers hit']);
  const speedup = a.executionMs / b.executionMs;
  console.log(`\n  \x1b[1m${speedup.toFixed(1)}x faster\x1b[0m, ${a.buffers.read + a.buffers.hit} -> ${b.buffers.read + b.buffers.hit} buffers touched\n`);
}

/** Convenience: measure a query end to end and package it for comparePlans. */
export async function measure(label, query) {
  const e = await explain(query);
  return { label, ...e, buffers: buffers(e.nodes), usesIndex: usesIndex(e.nodes) };
}
