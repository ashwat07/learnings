/**
 * Drills for the Node runtime itself.
 *
 *   node node-runtime/drills/run.mjs            all
 *   node node-runtime/drills/run.mjs 03         one
 *   node node-runtime/drills/run.mjs 03 --solution
 *
 * NO DOCKER, NO DATABASE. These are about V8, libuv and the standard library, so they need
 * nothing but the `node` on your PATH.
 *
 * Each drill hands your code a situation the runtime makes awkward: a callback whose phase you
 * have to know, a CPU burst that stops the world, a socket that splits your message in half, a
 * producer faster than its consumer. Passing means you understood the machine, not that the
 * happy path ran.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rule, good, bad, note, table } from '../../lib/console.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const filter = process.argv.find((a) => /^\d+$/.test(a));
const showSolution = process.argv.includes('--solution');

const drills = fs.readdirSync(here)
  .filter((d) => fs.statSync(path.join(here, d)).isDirectory())
  .filter((d) => !filter || d.startsWith(filter))
  .sort();

let passed = 0, failed = 0;

// An unhandled rejection anywhere is a failure of the drill, not a warning to scroll past — two
// of these drills are specifically about not leaking one.
const rejections = [];
process.on('unhandledRejection', (r) => rejections.push(r));

for (const dir of drills) {
  const meta = await import(path.join(here, dir, 'meta.mjs'));
  rule(`${dir} — ${meta.title}`);
  console.log(`  \x1b[1mTASK\x1b[0m  ${meta.task.replace(/\n/g, '\n        ')}`);
  console.log(`  \x1b[1mPASS IF\x1b[0m  ${meta.passIf}\n`);

  rejections.length = 0;
  let checks;
  try {
    const solution = await import(`${path.join(here, dir, 'solution.mjs')}?t=${Date.now()}`);
    checks = await meta.check(solution);
  } catch (e) {
    checks = [{ check: 'your solution ran', actual: String(e && e.message).split('\n')[0].slice(0, 64), pass: false }];
  }
  if (rejections.length) {
    checks.push({ check: 'no unhandled rejections escaped', actual: `${rejections.length} leaked`, pass: false });
  }

  table(checks.map((c) => ({ check: c.check, actual: String(c.actual), '': c.pass ? 'ok' : 'FAIL' })), ['check', 'actual', '']);
  const pass = checks.every((c) => c.pass);
  console.log();
  (pass ? good : bad)(pass ? 'PASS' : 'not yet');
  pass ? passed++ : failed++;

  if (showSolution) {
    console.log('\n  \x1b[2mreference answer:\x1b[0m');
    console.log(fs.readFileSync(path.join(here, dir, 'reference.mjs'), 'utf8')
      .split('\n').map((l) => '    \x1b[2m' + l + '\x1b[0m').join('\n'));
  }
}

rule('result');
console.log(`  ${passed} passing, ${failed} to go\n`);
if (failed) note('Edit solution.mjs in a failing drill. `--solution` shows the reference.');
process.exit(0);
