#!/usr/bin/env node
/**
 * analyse.mjs — read a build's metafile and answer the questions a size report should.
 *
 *   node analyse.mjs split
 *   node analyse.mjs single --why src/vendor/chart-data.js
 *   node analyse.mjs single --top 15
 *
 * Every bundler can emit a metafile / stats file (esbuild `metafile: true`, webpack `--json`,
 * rollup's `generateBundle`, vite's rollup output). The analysis below is the part that matters
 * and the part bundled visualisers usually bury: **which module is how big, and WHY is it here.**
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const variant = process.argv[2] ?? 'split';
const metaPath = join(here, 'dist', variant, 'meta.json');

if (!existsSync(metaPath)) {
  console.error(`no metafile at dist/${variant}/meta.json — run: node build.mjs --variant=${variant}`);
  process.exit(2);
}

const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
};

const fmt = (b) => `${(b / 1024).toFixed(1)} KB`;
const TOP = Number(arg('top') ?? 12);

// ---------------------------------------------------------------------------
// 1. Output files, and which are initial vs lazy
// ---------------------------------------------------------------------------

const outputs = meta.outputs;
const eager = new Set();
const roots = Object.keys(outputs).filter((f) => /(^|\/)main\.js$/.test(outputs[f].entryPoint || ''));
const visit = (f) => {
  if (!f || eager.has(f) || !outputs[f]) return;
  eager.add(f);
  for (const imp of outputs[f].imports || []) if (imp.kind === 'import-statement') visit(imp.path);
};
for (const r of roots.length ? roots : Object.keys(outputs)) visit(r);

console.log(`\n${variant}\n${'─'.repeat(60)}`);
console.log('output files:');
for (const [file, o] of Object.entries(outputs).sort((a, b) => b[1].bytes - a[1].bytes)) {
  const kind = eager.has(file) ? 'initial' : 'lazy   ';
  console.log(`  ${kind}  ${fmt(o.bytes).padStart(10)}  ${file}`);
}
const initial = Object.entries(outputs).filter(([f]) => eager.has(f)).reduce((a, [, o]) => a + o.bytes, 0);
const total = Object.values(outputs).reduce((a, o) => a + o.bytes, 0);
console.log(`  ${'─'.repeat(40)}`);
console.log(`  initial download: ${fmt(initial)}   ·   total shipped: ${fmt(total)}`);

// ---------------------------------------------------------------------------
// 2. What is inside, per source module
// ---------------------------------------------------------------------------

const contributions = new Map();
for (const [file, o] of Object.entries(outputs)) {
  for (const [input, info] of Object.entries(o.inputs || {})) {
    const cur = contributions.get(input) ?? { bytes: 0, files: new Set() };
    cur.bytes += info.bytesInOutput;
    cur.files.add(file);
    contributions.set(input, cur);
  }
}

console.log(`\nlargest source modules (after tree shaking and minification):`);
for (const [input, c] of [...contributions].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, TOP)) {
  const inEager = [...c.files].some((f) => eager.has(f));
  console.log(`  ${fmt(c.bytes).padStart(10)}  ${inEager ? 'initial' : 'lazy   '}  ${input}` +
    (c.files.size > 1 ? `   ⚠ duplicated across ${c.files.size} output files` : ''));
}

// Duplication across chunks is the cost of splitting, and the thing nobody looks for.
const duplicated = [...contributions].filter(([, c]) => c.files.size > 1);
if (duplicated.length) {
  const wasted = duplicated.reduce((a, [, c]) => a + c.bytes * (c.files.size - 1) / c.files.size, 0);
  console.log(`\n⚠ ${duplicated.length} module(s) appear in more than one output file (~${fmt(wasted)} duplicated).`);
  console.log('  That is the cost of splitting. If it is large, your chunk boundaries are wrong.');
}

// ---------------------------------------------------------------------------
// 3. "Why is this here?" — the import chain from an entry to a module
// ---------------------------------------------------------------------------

const why = arg('why');
if (why) {
  const inputs = meta.inputs;
  const target = Object.keys(inputs).find((k) => k.includes(why));
  if (!target) {
    console.log(`\nno input matching "${why}"`);
  } else {
    // Breadth-first from every entry input, following import edges, to find the shortest chain.
    const entries = Object.values(outputs).map((o) => o.entryPoint).filter(Boolean);
    const queue = entries.map((e) => [e]);
    const seen = new Set(entries);
    let chain = null;
    while (queue.length && !chain) {
      const path = queue.shift();
      const node = path.at(-1);
      if (node === target) { chain = path; break; }
      for (const imp of inputs[node]?.imports ?? []) {
        if (seen.has(imp.path)) continue;
        seen.add(imp.path);
        queue.push([...path, imp.path]);
      }
    }
    console.log(`\nwhy is ${target} in the bundle?`);
    if (!chain) console.log('  no import chain found from an entry point (dead code? dynamic only?)');
    else chain.forEach((step, i) => console.log(`  ${'  '.repeat(i)}${i ? '└─ ' : ''}${step}`));
  }
}

console.log('\nnext: node analyse.mjs <variant> --why <module>   ·   node build.mjs --analyse=<variant>');
