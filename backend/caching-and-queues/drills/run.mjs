/**
 * Drills for caching, rate limiting and queues.
 *
 *   node caching-and-queues/drills/run.mjs           all
 *   node caching-and-queues/drills/run.mjs 02        one
 *   node caching-and-queues/drills/run.mjs 02 --solution
 *
 * Every drill is scored on BEHAVIOUR UNDER CONCURRENCY, because that is the only thing that
 * distinguishes a correct implementation from one that merely looks correct:
 *
 *   · how many times did the origin actually run?
 *   · did exactly N requests get allowed through the limiter, under 500 racing clients?
 *   · did a duplicate delivery produce one side effect or two?
 *
 * You edit solution.mjs in each folder.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redis } from '../../lib/redis.mjs';
import { rule, good, bad, note, table } from '../../lib/db.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const filter = process.argv.find((a) => /^\d+$/.test(a));
const showSolution = process.argv.includes('--solution');

const drills = fs.readdirSync(here)
  .filter((d) => fs.statSync(path.join(here, d)).isDirectory())
  .filter((d) => !filter || d.startsWith(filter))
  .sort();

let passed = 0, failed = 0;

for (const dir of drills) {
  const meta = await import(path.join(here, dir, 'meta.mjs'));
  rule(`${dir} — ${meta.title}`);
  console.log(`  \x1b[1mTASK\x1b[0m  ${meta.task.replace(/\n/g, '\n        ')}`);
  console.log(`  \x1b[1mPASS IF\x1b[0m  ${meta.passIf}\n`);

  // A clean keyspace every time: a drill must never pass on a value another drill left behind.
  const keys = await redis.keys('drill:*');
  if (keys.length) await redis.del(...keys);

  let checks;
  try {
    const solution = await import(`${path.join(here, dir, 'solution.mjs')}?t=${Date.now()}`);
    checks = await meta.check(solution);
  } catch (e) {
    checks = [{ check: 'your solution ran', actual: e.message.split('\n')[0].slice(0, 60), pass: false }];
  }

  table(checks.map((c) => ({ check: c.check, actual: String(c.actual), '': c.pass ? 'ok' : 'FAIL' })), ['check', 'actual', '']);
  const pass = checks.every((c) => c.pass);
  console.log();
  (pass ? good : bad)(pass ? 'PASS' : 'not yet');
  pass ? passed++ : failed++;

  if (showSolution) {
    console.log('\n  \x1b[2mreference answer:\x1b[0m');
    const ref = fs.readFileSync(path.join(here, dir, 'reference.mjs'), 'utf8');
    console.log(ref.split('\n').map((l) => '    \x1b[2m' + l + '\x1b[0m').join('\n'));
  }
}

rule('result');
console.log(`  ${passed} passing, ${failed} to go\n`);
if (failed) note('Edit solution.mjs in a failing drill. `--solution` shows the reference.');
await redis.quit();
process.exit(0);
