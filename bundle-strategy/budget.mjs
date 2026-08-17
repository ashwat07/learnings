#!/usr/bin/env node
/**
 * budget.mjs — a per-commit bundle gate with attribution.
 *
 *   node budget.mjs                     # check the default variant against budget.json
 *   node budget.mjs --variant single
 *   node budget.mjs --update-baseline   # accept current numbers (the ratchet)
 *
 * Four properties, in order of importance (see the lab README):
 *   1. budget the INITIAL download, not the total
 *   2. attribute every change to a module, and to the import chain that pulled it in
 *   3. flag lazy → initial transitions even at constant size
 *   4. ratchet, so the check is green on day one and can only get tighter
 *
 * Exit code 1 on a breach, so it gates a merge.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, dflt) => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.split('=').slice(1).join('=') : dflt;
};

const variant = arg('variant', 'split');
const metaPath = join(here, 'dist', variant, 'meta.json');
const budgetPath = join(here, 'budget.json');

if (!existsSync(metaPath)) {
  console.error(`no metafile — run: node build.mjs --variant=${variant}`);
  process.exit(2);
}

const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
const outputs = meta.outputs;
const fmt = (b) => `${(b / 1024).toFixed(1)} KB`;

// ---------------------------------------------------------------------------
// What is in the initial download?
// ---------------------------------------------------------------------------

const eager = new Set();
const roots = Object.keys(outputs).filter((f) => /(^|\/)main\.js$/.test(outputs[f].entryPoint || ''));
const visit = (f) => {
  if (!f || eager.has(f) || !outputs[f]) return;
  eager.add(f);
  for (const imp of outputs[f].imports || []) if (imp.kind === 'import-statement') visit(imp.path);
};
for (const r of roots.length ? roots : Object.keys(outputs)) visit(r);

const initialBytes = [...eager].reduce((a, f) => a + outputs[f].bytes, 0);
const totalBytes = Object.values(outputs).reduce((a, o) => a + o.bytes, 0);

// Compressed size is what users actually download, so budget that too.
const initialBrotli = [...eager].reduce((a, f) => {
  const p = join(here, f);
  return a + (existsSync(p) ? zlib.brotliCompressSync(readFileSync(p)).length : 0);
}, 0);

/** module -> { bytes, initial } across all outputs. */
const modules = new Map();
for (const [file, o] of Object.entries(outputs)) {
  for (const [input, info] of Object.entries(o.inputs || {})) {
    const cur = modules.get(input) ?? { bytes: 0, initial: false, files: new Set() };
    cur.bytes += info.bytesInOutput;
    cur.initial = cur.initial || eager.has(file);
    cur.files.add(file);
    modules.set(input, cur);
  }
}

/** The import chain that explains why a module is present. */
function why(target) {
  const inputs = meta.inputs;
  const entries = Object.values(outputs).map((o) => o.entryPoint).filter(Boolean);
  const queue = entries.map((e) => [e]);
  const seen = new Set(entries);
  while (queue.length) {
    const path = queue.shift();
    if (path.at(-1) === target) return path;
    for (const imp of inputs[path.at(-1)]?.imports ?? []) {
      if (seen.has(imp.path)) continue;
      seen.add(imp.path);
      queue.push([...path, imp.path]);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Baseline & budget
// ---------------------------------------------------------------------------

const current = {
  variant,
  initialBytes,
  initialBrotli,
  totalBytes,
  modules: Object.fromEntries([...modules].map(([k, v]) => [k, { bytes: v.bytes, initial: v.initial }])),
};

if (process.argv.includes('--update-baseline')) {
  const margin = 1.05;
  const budget = {
    ...(existsSync(budgetPath) ? JSON.parse(readFileSync(budgetPath, 'utf8')) : {}),
    [variant]: {
      initialBytes: Math.round(initialBytes * margin),
      initialBrotli: Math.round(initialBrotli * margin),
      maxDuplicatedBytes: 8 * 1024,
      baseline: current,
    },
  };
  writeFileSync(budgetPath, JSON.stringify(budget, null, 2));
  console.log(`baseline written to budget.json for "${variant}"`);
  console.log(`  initial ${fmt(initialBytes)} → budget ${fmt(initialBytes * margin)} (+5% margin)`);
  console.log('\nRatchet it down as you improve; never let it rise without a deliberate decision.');
  process.exit(0);
}

if (!existsSync(budgetPath)) {
  console.error('no budget.json — create one with: node budget.mjs --update-baseline');
  process.exit(2);
}

const config = JSON.parse(readFileSync(budgetPath, 'utf8'))[variant];
if (!config) {
  console.error(`no budget for variant "${variant}" — run: node budget.mjs --variant=${variant} --update-baseline`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

const failures = [];
const C = process.stdout.isTTY
  ? { red: (s) => `\x1b[31m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`,
      yellow: (s) => `\x1b[33m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` }
  : { red: (s) => s, green: (s) => s, yellow: (s) => s, dim: (s) => s, bold: (s) => s };

console.log(`\n${C.bold(`bundle budget — ${variant}`)}`);
const line = (label, actual, limit) => {
  const over = actual > limit;
  if (over) failures.push(`${label} ${fmt(actual)} over ${fmt(limit)}`);
  console.log(`  ${label.padEnd(20)} ${fmt(actual).padStart(10)} / ${fmt(limit).padStart(10)}  ` +
    (over ? C.red(`OVER by ${fmt(actual - limit)}`) : C.green('ok')));
};
line('initial download', initialBytes, config.initialBytes);
line('initial (brotli)', initialBrotli, config.initialBrotli);
console.log(`  ${'total shipped'.padEnd(20)} ${fmt(totalBytes).padStart(10)}   ${C.dim('(not budgeted — lazy growth is fine)')}`);

// --- what changed -----------------------------------------------------------

const base = config.baseline?.modules ?? {};
const changes = [];
for (const [name, cur] of modules) {
  const prev = base[name];
  const delta = cur.bytes - (prev?.bytes ?? 0);
  const becameInitial = cur.initial && prev && !prev.initial;
  if (!prev) changes.push({ name, delta, kind: 'new', initial: cur.initial });
  else if (becameInitial) changes.push({ name, delta, kind: 'lazy→INITIAL', initial: true });
  else if (Math.abs(delta) > 512) changes.push({ name, delta, kind: delta > 0 ? 'grew' : 'shrank', initial: cur.initial });
}
for (const name of Object.keys(base)) {
  if (!modules.has(name)) changes.push({ name, delta: -base[name].bytes, kind: 'removed', initial: false });
}

if (changes.length) {
  console.log(`\n  ${C.bold('changed since the baseline:')}`);
  for (const c of changes.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 12)) {
    const sign = c.delta >= 0 ? '+' : '−';
    const colour = c.kind === 'lazy→INITIAL' ? C.red : c.delta > 0 ? C.yellow : C.green;
    console.log(colour(`    ${sign}${fmt(Math.abs(c.delta)).padStart(9)}  ${c.kind.padEnd(12)} ${c.name}`));
    if (c.kind === 'lazy→INITIAL' || (c.kind === 'new' && c.initial && c.delta > 4096)) {
      failures.push(`${c.name} is now in the initial download`);
      const chain = why(c.name);
      if (chain) console.log(C.dim(`        why: ${chain.join(' → ')}`));
    }
  }
} else {
  console.log(`\n  ${C.dim('no module changes since the baseline')}`);
}

// --- duplication ------------------------------------------------------------

const duplicated = [...modules].filter(([, m]) => m.files.size > 1);
const duplicatedBytes = duplicated.reduce((a, [, m]) => a + m.bytes * (m.files.size - 1) / m.files.size, 0);
if (duplicatedBytes > (config.maxDuplicatedBytes ?? Infinity)) {
  failures.push(`${fmt(duplicatedBytes)} duplicated across chunks`);
  console.log(C.red(`\n  ${fmt(duplicatedBytes)} duplicated across chunks (limit ${fmt(config.maxDuplicatedBytes)})`));
  for (const [name, m] of duplicated) console.log(`    ${name} in ${m.files.size} outputs`);
}

console.log(failures.length
  ? C.red(`\nFAIL — ${failures.length} problem(s):\n  ${failures.join('\n  ')}\n`)
  : C.green('\nPASS\n'));

process.exit(failures.length ? 1 : 0);
