/**
 * audit.mjs — what is actually in a lockfile.
 *
 *   node audit.mjs ../../../bundle-strategy/package-lock.json
 *
 * Not a replacement for `npm audit` — a complement to it, and arguably a more useful one. `npm
 * audit` tells you about *known* CVEs. This tells you the size and shape of the trust surface,
 * which is the number that decides how bad an *unknown* problem would be.
 *
 * Zero dependencies, which is the joke and also the point.
 */

import fs from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
if (!file) {
  console.error('usage: node audit.mjs <path/to/package-lock.json>');
  process.exit(1);
}

const lock = JSON.parse(fs.readFileSync(file, 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'package.json'), 'utf8'));

if (lock.lockfileVersion < 2) {
  console.error('This expects lockfileVersion 2 or 3 (npm 7+).');
  process.exit(1);
}

const entries = Object.entries(lock.packages).filter(([p]) => p !== '');
const direct = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
]);

const nameOf = (p) => p.split('node_modules/').pop();
const depthOf = (p) => p.split('node_modules/').length - 1;

const installScripts = entries.filter(([, m]) => m.hasInstallScript);
const noIntegrity = entries.filter(([, m]) => !m.integrity && !m.link && m.resolved);
const versions = new Map();
for (const [p, m] of entries) {
  if (!m.version) continue;
  const n = nameOf(p);
  if (!versions.has(n)) versions.set(n, new Set());
  versions.get(n).add(m.version);
}
const duplicated = [...versions].filter(([, v]) => v.size > 1);
const maxDepth = Math.max(...entries.map(([p]) => depthOf(p)));

const rule = (s) => console.log(`\n\x1b[1m${s}\x1b[0m\n${'─'.repeat(s.length)}`);
const row = (k, v) => console.log(`  ${String(k).padEnd(46)} ${v}`);

rule(`${pkg.name ?? file} — trust surface`);
row('direct dependencies you chose', direct.size);
row('packages actually installed', entries.length);
row('multiplier', `${(entries.length / Math.max(direct.size, 1)).toFixed(0)}×`);
row('deepest nesting', maxDepth);
row('packages installed at >1 version', duplicated.length);
row('packages that run code at install time', installScripts.length);
row('packages with no integrity hash in the lockfile', noIntegrity.length);

if (installScripts.length) {
  rule('runs code on your machine during `npm install`');
  console.log('  These execute as your user, on your laptop and in CI, before any code review of');
  console.log('  the built artifact. This is the highest-privilege moment in the whole pipeline.\n');
  for (const [p, m] of installScripts) row(nameOf(p), m.version ?? '');
  console.log('\n  Mitigation:  npm ci --ignore-scripts   (then allow-list the few that truly need it)');
}

if (noIntegrity.length) {
  rule('no integrity hash');
  for (const [p, m] of noIntegrity.slice(0, 20)) row(nameOf(p), m.resolved ?? '');
  console.log('\n  A lockfile entry without an integrity hash pins a VERSION, not CONTENT.');
}

if (duplicated.length) {
  rule(`installed at more than one version (${duplicated.length})`);
  for (const [n, v] of duplicated.slice(0, 20)) row(n, [...v].join(', '));
  console.log('\n  Each duplicate is bytes in your bundle AND a second thing to patch when a CVE lands.');
}

rule('the number to remember');
console.log(`  You made ${direct.size} decisions. You are trusting ${entries.length} packages.`);
console.log(`  Every one of them can run code in your build, and most can run code in your users'`);
console.log('  browsers. Nobody on your team has read 99% of it, and that is true everywhere —');
console.log('  which is why the controls are structural (lockfile, --ignore-scripts, SRI, CSP,');
console.log('  least-privilege CI) rather than "review your dependencies".\n');
