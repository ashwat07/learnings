/**
 * check.mjs — runs `tsc` over each lab and reports which exercises still fail to compile.
 *
 *   npm run check              # your exercise files
 *   npm run check:solutions    # the reference solutions (should all pass)
 *   node check.mjs 03          # one lab
 *
 * A failing exercise is the normal state: the assertions are written first, and your job is to
 * make them compile.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const wantSolutions = process.argv.includes('--solutions');
const filter = process.argv.find((a) => /^\d+$/.test(a));
const file = wantSolutions ? 'solution.ts' : 'exercise.ts';

const labs = fs.readdirSync(path.join(root, 'labs'))
  .filter((d) => fs.statSync(path.join(root, 'labs', d)).isDirectory())
  .filter((d) => !filter || d.startsWith(filter))
  .sort();

const tsc = path.join(root, 'node_modules', '.bin', 'tsc');
if (!fs.existsSync(tsc)) {
  console.error('typescript is not installed. Run:  npm install');
  process.exit(1);
}

let failed = 0;
const rule = (s) => console.log(`\n\x1b[1m${s}\x1b[0m`);

for (const lab of labs) {
  const target = path.join(root, 'labs', lab, file);
  if (!fs.existsSync(target)) continue;

  // Any *.d.ts in the lab folder is compiled alongside it — that is how a lab can practise
  // ambient declarations and module augmentation against something the compiler can see.
  const ambient = fs.readdirSync(path.join(root, 'labs', lab))
    .filter((f) => f.endsWith('.d.ts'))
    .map((f) => path.join(root, 'labs', lab, f));

  let output = '';
  let ok = true;
  try {
    execFileSync(tsc, ['--noEmit', '--strict', '--target', 'ES2022', '--module', 'ESNext',
      '--moduleResolution', 'bundler', '--skipLibCheck',
      '--noUncheckedIndexedAccess', '--exactOptionalPropertyTypes', ...ambient, target], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    ok = false;
    output = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }

  if (ok) {
    console.log(`  \x1b[32m✓\x1b[0m ${lab}`);
  } else {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${lab}`);
    for (const line of String(output).split('\n').filter(Boolean).slice(0, 8)) {
      console.log(`      ${line.replace(root + path.sep, '')}`);
    }
  }
}

rule(failed ? `${failed} of ${labs.length} lab(s) still failing` : `all ${labs.length} lab(s) compile`);
if (!wantSolutions && failed) {
  console.log('\n  That is the expected starting state. Open the exercise file and make the');
  console.log('  Expect<...> assertions compile. Compare with solution.ts when you are stuck.\n');
}
process.exit(0);
