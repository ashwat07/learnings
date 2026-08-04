#!/usr/bin/env node
// Generates the module sets for Lab 12.
//
//   node make-modules.mjs                # 50 modules + bundle + a 10-deep import chain
//   node make-modules.mjs --count 100
//   node make-modules.mjs --clean

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const modulesDir = join(here, 'modules');
const chainDir = join(here, 'chain');
const bundlePath = join(here, 'bundle.js');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(args[i + 1]);
};

if (args.includes('--clean')) {
  for (const p of [modulesDir, chainDir, bundlePath]) {
    if (existsSync(p)) { rmSync(p, { recursive: true }); console.log(`removed ${p}`); }
  }
  process.exit(0);
}

const COUNT = flag('count', 50);
const CHAIN = flag('chain', 10);
const PAD_KB = flag('pad', 12);      // each module is padded so bytes are non-trivial

/** Padding that a minifier couldn't remove and gzip can still compress — realistic-ish. */
function padding(kb, seed) {
  const lines = [];
  const target = kb * 1024;
  let i = 0;
  while (lines.join('\n').length < target) {
    lines.push(`const _k${seed}_${i} = { id: ${i}, label: "field-${seed}-${i}", ` +
      `calc(x) { return x * ${(i % 7) + 1} + ${seed}; } };`);
    i++;
  }
  return lines.join('\n');
}

function moduleSource(i, isModule) {
  const body = `
// module ${i} — generated for Lab 12
${padding(PAD_KB, i)}

const value${i} = (() => {
  let acc = 0;
  for (let j = 0; j < 20000; j++) acc += Math.sqrt(j) % ${(i % 9) + 2};
  return acc;
})();

globalThis.__lab12 ??= { order: [], firstAt: null, lastAt: null };
globalThis.__lab12.order.push(${i});
globalThis.__lab12.firstAt ??= performance.now();
globalThis.__lab12.lastAt = performance.now();
globalThis.__lab12_report?.();
`;
  return isModule ? `${body}\nexport default value${i};\n` : body;
}

// --- 50 standalone classic scripts ----------------------------------------
mkdirSync(modulesDir, { recursive: true });
let totalBytes = 0;
for (let i = 0; i < COUNT; i++) {
  const src = moduleSource(i, false);
  writeFileSync(join(modulesDir, `mod-${String(i).padStart(2, '0')}.js`), src);
  totalBytes += src.length;
}

// --- the same code, concatenated ------------------------------------------
let bundle = '// Lab 12 bundle — the same 50 modules, one file, one request.\n';
for (let i = 0; i < COUNT; i++) bundle += moduleSource(i, false);
writeFileSync(bundlePath, bundle);

// --- a deep import chain: the latency-bound case --------------------------
// chain/step-00.js imports step-01, which imports step-02, ... Each round trip must
// complete before the next dependency is even DISCOVERED.
mkdirSync(chainDir, { recursive: true });
for (let i = 0; i < CHAIN; i++) {
  const next = i + 1 < CHAIN ? `import next from './step-${String(i + 1).padStart(2, '0')}.js';\n` : '';
  const src = `${next}// chain step ${i} — nothing below this line can be fetched until this file arrives\n` +
    moduleSource(i, true);
  writeFileSync(join(chainDir, `step-${String(i).padStart(2, '0')}.js`), src);
}

console.log(`modules/   ${COUNT} files, ${(totalBytes / 1024).toFixed(0)} kB total`);
console.log(`bundle.js  1 file,  ${(bundle.length / 1024).toFixed(0)} kB`);
console.log(`chain/     ${CHAIN} files, each discovered only after the previous one arrives`);
console.log(`\nNote: modules/ and bundle.js contain the same code and nearly the same bytes.`);
console.log(`Any difference you measure between them is per-request overhead, not payload.\n`);
console.log('Next: cd ../.. && ./serve.sh   then open /labs/12-network-waterfall/');
