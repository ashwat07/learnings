/**
 * Drills for auth, security & compliance.
 *
 *   node auth-and-security/drills/run.mjs            all
 *   node auth-and-security/drills/run.mjs 03         one
 *   node auth-and-security/drills/run.mjs 03 --solution
 *
 * Security is the area where "it works" and "it is correct" diverge most, so every drill here is
 * checked ADVERSARIALLY: the runner plays the attacker. It measures timing variance, it tries the
 * bypass, it replays the token. Passing means the attack failed, not that the happy path worked.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
process.exit(0);
