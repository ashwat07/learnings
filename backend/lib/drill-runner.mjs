/**
 * The drill runner, shared by every course whose drills need no containers.
 *
 * A course's run.mjs is then three lines:
 *
 *   import { runDrills } from '../../lib/drill-runner.mjs';
 *   await runDrills(import.meta.url, { title: '...' });
 *
 * Each drill directory needs meta.mjs (title, task, passIf, check) and solution.mjs, plus a
 * reference.mjs that --solution prints.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rule, good, bad, note, table } from './console.mjs';

/** Re-exec with --expose-gc if we do not have it: a memory check without a forced GC is fiction. */
export function ensureGc(metaUrl) {
  if (typeof globalThis.gc === 'function') return false;
  const { spawnSync } = require('node:child_process');
  const r = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(metaUrl), ...process.argv.slice(2)],
    { stdio: 'inherit' });
  process.exit(r.status ?? 0);
}

export async function runDrills(runnerUrl, { gc = false, setup, teardown } = {}) {
  if (gc && typeof globalThis.gc !== 'function') {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(runnerUrl), ...process.argv.slice(2)],
      { stdio: 'inherit' });
    process.exit(r.status ?? 0);
  }

  const here = path.dirname(fileURLToPath(runnerUrl));
  const filter = process.argv.find((a) => /^\d+$/.test(a));
  const showSolution = process.argv.includes('--solution');

  const drills = fs.readdirSync(here)
    .filter((d) => fs.statSync(path.join(here, d)).isDirectory())
    .filter((d) => !filter || d.startsWith(filter))
    .sort();

  const rejections = [];
  process.on('unhandledRejection', (r) => rejections.push(r));
  process.on('uncaughtException', (err) => {
    console.log(`\n  \x1b[31m✗\x1b[0m your solution threw where nobody could catch it — that IS the failure:\n`);
    console.log(String(err.stack).split('\n').slice(0, 6).map((l) => '    ' + l).join('\n'));
    process.exit(1);
  });

  let passed = 0, failed = 0;
  const ctx = setup ? await setup() : undefined;

  for (const dir of drills) {
    const meta = await import(path.join(here, dir, 'meta.mjs'));
    rule(`${dir} — ${meta.title}`);
    console.log(`  \x1b[1mTASK\x1b[0m  ${meta.task.replace(/\n/g, '\n        ')}`);
    console.log(`  \x1b[1mPASS IF\x1b[0m  ${meta.passIf}\n`);

    rejections.length = 0;
    let checks;
    try {
      const solution = await import(`${path.join(here, dir, 'solution.mjs')}?t=${Date.now()}`);
      checks = await meta.check(solution, ctx);
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

  if (teardown) await teardown(ctx);
  rule('result');
  console.log(`  ${passed} passing, ${failed} to go\n`);
  if (failed) note('Edit solution.mjs in a failing drill. `--solution` shows the reference.');
  process.exit(0);
}
