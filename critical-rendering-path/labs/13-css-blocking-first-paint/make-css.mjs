#!/usr/bin/env node
// Generates the stylesheets for Lab 13.
//
//   node make-css.mjs            # 20 stylesheets + an @import chain
//   node make-css.mjs --count 40
//   node make-css.mjs --clean

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'css');
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : Number(args[i + 1]); };

if (args.includes('--clean')) {
  if (existsSync(dir)) { rmSync(dir, { recursive: true }); console.log(`removed ${dir}`); }
  process.exit(0);
}

const COUNT = flag('count', 20);
const IMPORT_DEPTH = flag('depth', 4);
const RULES_PER_FILE = flag('rules', 900);

mkdirSync(dir, { recursive: true });

/** Rules that are mostly UNUSED by the demo page — which is realistic, and is what the
 *  Coverage tab will show you. */
function rules(fileIndex) {
  const lines = [`/* css/part-${String(fileIndex).padStart(2, '0')}.css — generated for Lab 13 */`];
  for (let i = 0; i < RULES_PER_FILE; i++) {
    const n = fileIndex * RULES_PER_FILE + i;
    // Deliberately descendant-heavy selectors: they widen style invalidation as well as bloat.
    lines.push(
      `.mod-${fileIndex} .widget-${n} > .body .label-${n} { ` +
      `color: hsl(${n % 360} 60% 60%); padding: ${(n % 9) + 1}px; ` +
      `border-radius: ${(n % 5) + 1}px; letter-spacing: 0.0${n % 9}em; }`
    );
  }
  // Two rules per file that the page DOES use, so the files aren't entirely dead weight.
  lines.push(`.used-${fileIndex} { outline: 1px solid hsl(${(fileIndex * 18) % 360} 60% 50%); }`);
  lines.push(`.hero { --touched-by-${fileIndex}: 1; }`);
  return lines.join('\n') + '\n';
}

let total = 0;
for (let i = 0; i < COUNT; i++) {
  const src = rules(i);
  writeFileSync(join(dir, `part-${String(i).padStart(2, '0')}.css`), src);
  total += src.length;
}

// --- the @import chain: a latency chain the preload scanner cannot see ------
for (let i = 0; i < IMPORT_DEPTH; i++) {
  const next = i + 1 < IMPORT_DEPTH
    ? `@import url("imported-${String(i + 1).padStart(2, '0')}.css");\n`
    : '';
  const discovery = i === 0
    ? 'reached from a <link> in the HTML'
    : `not even discoverable until level ${i - 1} arrived and was parsed`;
  writeFileSync(join(dir, `imported-${String(i).padStart(2, '0')}.css`),
    // @import MUST come first in a stylesheet, which is exactly why it serialises.
    `${next}/* imported level ${i} — ${discovery} */\n` +
    `.import-depth-${i} { --depth: ${i}; }\n` + rules(100 + i));
  total += RULES_PER_FILE * 60;
}

console.log(`css/  ${COUNT} stylesheets + a ${IMPORT_DEPTH}-deep @import chain`);
console.log(`      ~${(total / 1024).toFixed(0)} kB of CSS, of which the demo page uses almost none.`);
console.log(`\nOpen the Coverage tab (⌘⇧P → "Show Coverage") and reload to see the unused percentage.`);
console.log('Next: cd ../.. && ./serve.sh   then open /labs/13-css-blocking-first-paint/');
