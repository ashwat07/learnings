/**
 * Drills for background jobs, brokers and backpressure.
 *
 *   node jobs-and-messaging/drills/run.mjs            all
 *   node jobs-and-messaging/drills/run.mjs 02         one
 *   node jobs-and-messaging/drills/run.mjs 02 --solution
 *
 * Every drill runs your code against a hostile world: workers that crash mid-job, a message that
 * can never succeed, a producer faster than the consumer, and a step that fails after two others
 * have already committed. Passing means the system stayed correct, not that the happy path ran.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redis } from '../../lib/redis.mjs';
import { sql, rule, good, bad, note, table } from '../../lib/db.mjs';

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
    console.log(fs.readFileSync(path.join(here, dir, 'reference.mjs'), 'utf8')
      .split('\n').map((l) => '    \x1b[2m' + l + '\x1b[0m').join('\n'));
  }
}

rule('result');
console.log(`  ${passed} passing, ${failed} to go\n`);
if (failed) note('Edit solution.mjs in a failing drill. `--solution` shows the reference.');
await redis.quit();
await sql.end();
process.exit(0);
