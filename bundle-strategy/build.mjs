#!/usr/bin/env node
/**
 * build.mjs — build the fixture app several ways and print what changed.
 *
 *   node build.mjs                # the default variant
 *   node build.mjs --all          # every variant, with a comparison table
 *   node build.mjs --variant=split
 *   node build.mjs --analyse=split
 *
 * esbuild is used because it is one binary, has no config file, and rebuilds fast enough that
 * you can change something and re-read the numbers immediately. Everything here (splitting,
 * tree shaking, side-effect handling, metafiles) exists in webpack/rollup/vite too — the flags
 * differ, the concepts do not.
 */

import { build, analyzeMetafile } from 'esbuild';
import { rmSync, mkdirSync, readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, 'src');
const dist = join(here, 'dist');

const arg = (name, dflt) => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.split('=').slice(1).join('=') : dflt;
};

// ---------------------------------------------------------------------------
// The variants. Each one is a real build; the differences are the lesson.
// ---------------------------------------------------------------------------

const VARIANTS = {
  /** No bundling at all: every module is its own file, as the browser sees them. */
  'no-bundle': {
    note: 'no bundling — one request per module, native ESM',
    options: { bundle: false, format: 'esm', outdir: 'dist/no-bundle', splitting: false, minify: false },
    entries: 'all',
  },

  /** One file, everything in it. The 2015 default, and still the right answer for small apps. */
  single: {
    note: 'one bundle, minified, tree-shaken',
    options: { bundle: true, format: 'esm', minify: true, splitting: false, outfile: 'dist/single/main.js' },
  },

  /** Route-based code splitting via dynamic import + esbuild's chunking. */
  split: {
    note: 'code-split: shared code hoisted into a chunk, admin lazy',
    options: { bundle: true, format: 'esm', minify: true, splitting: true, outdir: 'dist/split', chunkNames: 'chunks/[name]-[hash]' },
  },

  /** Everything static: the admin route (and the chart library) end up in the main bundle. */
  'no-split': {
    note: 'all routes imported statically — admin + chart in the main bundle',
    options: { bundle: true, format: 'esm', minify: true, splitting: false, outfile: 'dist/no-split/main.js' },
    transform: (code) => code
      .replace("  // ROUTE_ADMIN\n", "")
      .replace("  admin: async (el, data) => (await import('./routes/admin.js')).render(el, data),",
        "  admin: (el, data) => renderAdmin(el, data),")
      .replace("import { track } from './lib/analytics.js';",
        "import { track } from './lib/analytics.js';\nimport { render as renderAdmin } from './routes/admin.js';"),
  },

  /** Tree shaking disabled, to show what it was doing. */
  'no-treeshake': {
    note: 'tree shaking off — everything the barrel touches is included',
    options: { bundle: true, format: 'esm', minify: true, splitting: false, treeShaking: false, outfile: 'dist/no-treeshake/main.js' },
  },

  /** Everything imported through the barrel file, to show what that costs. */
  barrel: {
    note: 'every route imports from lib/index.js (the barrel)',
    options: { bundle: true, format: 'esm', minify: true, splitting: false, outfile: 'dist/barrel/main.js' },
    transformAll: (code, file) => (file.includes('routes/')
      ? code.replace(/from '\.\.\/lib\/(format|dates|validate)\.js'/g, "from '../lib/index.js'")
      : code),
  },
};

// ---------------------------------------------------------------------------

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

/** Some variants need edited source; write it to a temp tree rather than mutating src/. */
function prepareSource(variant) {
  const v = VARIANTS[variant];
  if (!v.transform && !v.transformAll) return src;

  const tmp = join(here, '.tmp', variant);
  rmSync(tmp, { recursive: true, force: true });
  for (const file of walk(src)) {
    const rel = file.slice(src.length + 1);
    const target = join(tmp, rel);
    mkdirSync(dirname(target), { recursive: true });
    let code = readFileSync(file, 'utf8');
    if (v.transform && rel === 'main.js') code = v.transform(code);
    if (v.transformAll) code = v.transformAll(code, rel);
    writeFileSync(target, code);
  }
  return tmp;
}

async function buildVariant(name) {
  const v = VARIANTS[name];
  const root = prepareSource(name);
  const entryPoints = v.entries === 'all'
    ? walk(root).map((f) => f)
    : [join(root, 'main.js')];

  const outPath = v.options.outdir ?? dirname(v.options.outfile);
  rmSync(join(here, outPath), { recursive: true, force: true });

  const result = await build({
    ...v.options,
    entryPoints,
    absWorkingDir: here,
    metafile: true,
    logLevel: 'silent',
    target: 'es2022',
  });

  const files = Object.entries(result.metafile.outputs)
    .map(([file, meta]) => ({ file, bytes: meta.bytes, entry: Boolean(meta.entryPoint) }))
    .sort((a, b) => b.bytes - a.bytes);

  const total = files.reduce((a, f) => a + f.bytes, 0);
  // The initial download is the app's entry plus everything it STATICALLY imports, transitively.
  // Chunks reached only through a dynamic import are not part of it — that is the whole point of
  // splitting, and getting this calculation wrong is how people conclude splitting "did nothing".
  //
  // Note esbuild also sets `entryPoint` on chunks created from dynamic imports, so filtering on
  // that field alone would count the lazy chunks as initial.
  const outputs = result.metafile.outputs;
  const isAppEntry = ([, meta]) => meta.entryPoint && /(^|\/)main\.js$/.test(meta.entryPoint);
  const roots = Object.keys(outputs).filter((f) => isAppEntry([f, outputs[f]]));
  const eager = new Set();
  const visit = (file) => {
    if (!file || eager.has(file) || !outputs[file]) return;
    eager.add(file);
    for (const imp of outputs[file].imports || []) {
      if (imp.kind === 'import-statement') visit(imp.path);
    }
  };
  for (const r of roots.length ? roots : Object.keys(outputs)) visit(r);
  const initial = files.filter((f) => eager.has(f.file)).reduce((a, f) => a + f.bytes, 0);

  writeFileSync(join(here, outPath, 'meta.json'), JSON.stringify(result.metafile, null, 2));
  return { name, note: v.note, files, total, initial, metafile: result.metafile };
}

const fmt = (b) => `${(b / 1024).toFixed(1)} KB`;

const only = arg('variant', null);
const analyse = arg('analyse', null);
const all = process.argv.includes('--all');

mkdirSync(dist, { recursive: true });

if (analyse) {
  const r = await buildVariant(analyse);
  console.log(await analyzeMetafile(r.metafile, { verbose: true }));
  process.exit(0);
}

const names = all ? Object.keys(VARIANTS) : [only ?? 'split'];
const results = [];
for (const name of names) results.push(await buildVariant(name));

console.log('');
for (const r of results) {
  console.log(`${r.name.padEnd(14)} ${fmt(r.initial).padStart(10)} initial   ${fmt(r.total).padStart(10)} total   ` +
    `${String(r.files.length).padStart(2)} file(s)   ${r.note}`);
}

if (results.length > 1) {
  const base = results.find((r) => r.name === 'single') ?? results[0];
  console.log('\nrelative to the single-bundle build:');
  for (const r of results) {
    const d = r.initial - base.initial;
    console.log(`  ${r.name.padEnd(14)} ${d === 0 ? 'baseline' : `${d > 0 ? '+' : ''}${(d / 1024).toFixed(1)} KB initial`}`);
  }
}

console.log('\nfiles written to dist/<variant>/, with a metafile at dist/<variant>/meta.json');
console.log('run `node build.mjs --analyse=<variant>` for esbuild\'s own breakdown,');
console.log('or `node analyse.mjs <variant>` for the per-module report the labs use.');
