/**
 * Lab 02 — CommonJS and ESM, and the seam between them.
 *
 *   node node-runtime/labs/02-modules/lab.mjs
 *
 * Every file in tree/ exists to demonstrate one difference. Read them as you go; they are five
 * lines each.
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rule, note, table, good, bad } from '../../../lib/console.mjs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const t = (p) => path.join(here, 'tree', p);

rule('THE ONE-PARAGRAPH VERSION');
console.log(`
  CommonJS resolves and loads modules AT RUNTIME, one require() call at a time, synchronously.
  ESM is parsed first, its whole graph resolved and linked before ANY of it runs, and only then
  evaluated. That single difference produces all of the behaviour below: live bindings, top-level
  await, hoisted imports, tree shaking, cycle semantics, and why you cannot require() something
  that has to be fetched.

  It is not "old syntax vs new syntax". They are two different loading models.`);

// ---------------------------------------------------------------------------
rule('1. what you get instead of __dirname');

table([
  { 'CommonJS': '__dirname', 'ESM': 'import.meta.dirname   (Node 20.11+)' },
  { 'CommonJS': '__filename', 'ESM': 'import.meta.filename  (Node 20.11+)' },
  { 'CommonJS': 'require(x)', 'ESM': 'await import(x), or createRequire(import.meta.url)' },
  { 'CommonJS': 'module.exports', 'ESM': 'export / export default' },
  { 'CommonJS': 'require.resolve(x)', 'ESM': 'import.meta.resolve(x)' },
  { 'CommonJS': 'require.main === module', 'ESM': 'import.meta.url === pathToFileURL(process.argv[1]).href' },
], ['CommonJS', 'ESM']);
console.log(`
  Before 20.11 the incantation was:
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
  You will still see it everywhere, and it is what this file uses so it runs on older Node too.

  import.meta.dirname is: ${import.meta.dirname ?? '(not available on this Node)'}`);

// ---------------------------------------------------------------------------
rule('2. live bindings vs a copied value — the difference that bites');

{
  const esm = await import(t('counter.mjs'));
  const before = esm.count;
  esm.increment();
  const after = esm.count;

  const cjs = require(t('counter.cjs'));
  const cjsBefore = cjs.count;
  cjs.increment();
  const cjsAfter = cjs.count;

  table([
    { module: 'ESM  (export let count)', 'before increment()': before, 'after': after, 'is it live?': after === before + 1 ? 'YES' : 'no' },
    { module: 'CJS  (module.exports = { count })', 'before increment()': cjsBefore, 'after': cjsAfter, 'is it live?': cjsAfter === cjsBefore + 1 ? 'YES' : 'no — a copy' },
  ], ['module', 'before increment()', 'after', 'is it live?']);

  console.log(`
  The CJS module's internal counter DID go up — cjs.read() returns ${cjs.read()}. What you imported
  was a snapshot of the value at require time, taken when the object literal was built.

  An ESM import is a live binding: a view onto the exporting module's variable. Reassign it there
  and every importer sees the new value immediately.

  Why this matters in practice: the CJS pattern that works is exporting a FUNCTION or an object
  you mutate, never a primitive you reassign. Every "my config is undefined but only in
  production" bug is a module that reassigned an export after someone had already required it.`);
}

// ---------------------------------------------------------------------------
rule('3. import is HOISTED and evaluated before your code runs');

{
  console.log('\n  A dynamic import(), which runs where you put it:');
  console.log('    (about to import side-effect.mjs)');
  await import(t('side-effect.mjs'));
  console.log(`
  A STATIC import is different: it is hoisted to the top of the module and the entire graph is
  evaluated before the first line of your file runs. So this does not do what it looks like:

      dotenv.config();                    // <- looks like it runs first
      import { db } from './db.js';       // <- actually runs BEFORE the line above

  ...and db.js reads process.env at import time, before dotenv has loaded anything. In CommonJS
  the equivalent code works, because require() runs in order. This is the single most common
  breakage when a codebase migrates, and the fixes are: --env-file=.env (Node 20.6+), a dynamic
  import after config, or --import ./setup.mjs.`);
}

// ---------------------------------------------------------------------------
rule('4. interop, in both directions');

{
  const stat = await import(t('shapes.cjs'));
  const dyn = await import(t('dynamic.cjs'));
  let reqEsm;
  try { reqEsm = Object.keys(require(t('counter.mjs'))).join(', '); }
  catch (e) { reqEsm = `${e.code}`; }

  table([
    { direction: 'import a CJS module with a static shape', result: `named exports found: ${Object.keys(stat).filter((k) => k !== 'default').join(', ')}` },
    { direction: 'import a CJS module built in a loop', result: `named exports found: ${Object.keys(dyn).filter((k) => k !== 'default').join(', ') || 'NONE — only default'}` },
    { direction: 'require() an ESM module', result: reqEsm },
  ], ['direction', 'result']);

  console.log(`
  IMPORTING CJS: Node runs a static analyser (cjs-module-lexer) over the source to guess the
  named exports. It handles \`exports.foo = ...\` and a few other shapes. It cannot see through a
  loop, a conditional, or a call — so dynamic.cjs gives you only \`default\`, and the fix is
  always the same:
        import pkg from 'some-cjs-package';
        const { thing } = pkg;
  \`default\` is module.exports itself, and it is always correct. Named imports from CJS are a
  convenience that sometimes works.

  REQUIRING ESM: on Node 20.19+/22.12+ this works for a graph with no top-level await. Before
  that it threw ERR_REQUIRE_ESM, which is the error that made half of npm painful for three
  years. It still throws if the module — or anything it imports — uses top-level await, because
  require() has to return synchronously and there is nowhere to put the wait.

  The rule that follows: a library published as ESM-only cannot be require()d by everyone. A
  library published as CJS can be imported by everyone. That asymmetry is why dual publishing
  exists, and why it is worth avoiding by shipping one format and meaning it.`);
}

// ---------------------------------------------------------------------------
rule('5. cycles: an error you can see vs data that is quietly wrong');

{
  const esmB = await import(t('cycle-b.mjs'));
  const cjsA = require(t('cycle-a.cjs'));

  table([
    { 'circular import': 'ESM', 'what happens': esmB.seenAtEval },
    { 'circular import': 'CommonJS', 'what happens': `got a partial exports object: ${cjsA.sawFromB}` },
  ], ['circular import', 'what happens']);

  console.log(`
  ESM linking means the binding EXISTS before either module is evaluated, but reading it before
  its initialiser has run is a temporal dead zone error — loud, immediate, with a stack trace.

  CommonJS hands you whatever module.exports happened to contain at that moment: an object
  missing half its properties, with no error at all. Your code reads \`undefined\`, calls it,
  and fails somewhere else entirely with "x is not a function".

  Note that FUNCTION declarations survive both, because they are hoisted — which is why circular
  requires often appear to work until someone converts a function to an arrow-function const.

  Either way: a cycle is a design problem. The usual fix is to extract the shared thing into a
  third module that neither of the other two imports back.`);
}

// ---------------------------------------------------------------------------
rule('6. how Node decides which one your file is');

table([
  { file: 'x.mjs', 'treated as': 'ESM', always: 'yes' },
  { file: 'x.cjs', 'treated as': 'CommonJS', always: 'yes' },
  { file: 'x.js', 'treated as': 'whatever the NEAREST package.json says', always: '"type": "module" -> ESM, otherwise CJS' },
  { file: 'no package.json anywhere', 'treated as': 'CommonJS', always: 'the historical default' },
], ['file', 'treated as', 'always']);

console.log(`
  This directory is ESM because backend/package.json says "type": "module".

  THE exports FIELD is the other half, and it does two jobs people conflate:

      "exports": {
        ".":          { "import": "./dist/index.mjs", "require": "./dist/index.cjs" },
        "./helpers":  "./dist/helpers.mjs"
      }

    1. CONDITIONS pick a file per environment ("import", "require", "node", "browser",
       "development", "types" — and "types" must come FIRST or TypeScript ignores it).
    2. ENCAPSULATION: once "exports" exists, nothing outside the listed paths is importable.
       No more require('lodash/internal/deep'). This breaks consumers, and it is intentional.

  THE DUAL PACKAGE HAZARD is what you buy with that first line. If your package ships both an
  .mjs and a .cjs build, a dependency graph can end up loading BOTH. Now there are two copies of
  every class, two module-level caches, and two of whatever singleton you thought you had:

      instanceof fails across the boundary
      a registry populated through one copy is empty in the other
      "why do I have two database pools" — this is why

  Ways out, in order of preference: ship ESM only; or ship CJS only and let everyone import it;
  or ship a thin ESM wrapper that re-exports the single CJS implementation, so there is exactly
  one copy of the state.`);

// ---------------------------------------------------------------------------
rule('7. the practical checklist');
console.log(`
  · "type": "module" and .js everywhere, or CJS everywhere. Mixing per-file is how you end up
    debugging the loader instead of your program.
  · TypeScript: "module": "nodenext" and "moduleResolution": "nodenext". Anything else lies to
    you about what Node will do at runtime, and the lie surfaces at deploy.
  · With nodenext, relative imports in ESM need the .js extension — even from .ts source. It
    looks wrong and it is correct: you are naming the OUTPUT file.
  · Node 22.6+ can run .ts directly (--experimental-strip-types); 23.6+ does it by default for
    type-only syntax. tsx and ts-node still cover more (decorators, enums, path aliases).
  · Top-level await is ESM only, and it makes your module un-require()-able. That is a real API
    decision, not a detail.
  · Import a package's SUBPATH only if its "exports" field lists it. Deep imports that work today
    break on a patch release.
  · For a CLI or a server, the entry point's format is the one that constrains everything else —
    choose it first, once.`);
