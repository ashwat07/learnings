#!/usr/bin/env node
/**
 * make-fonts.mjs — fetch two real font files for the font-loading lab.
 *
 * The lab needs actual font binaries: `font-display` behaviour, FOIT/FOUT timing and the
 * metric-mismatch layout shift are all things you have to see, and no amount of prose replaces
 * watching text swap.
 *
 * This downloads from Google Fonts (fonts.gstatic.com). It needs internet ONCE. The fonts are
 * open-licensed (Inter and Playfair Display are both SIL OFL 1.1); they are downloaded into
 * ./fonts/ which is gitignored, so nothing is redistributed by this repo.
 *
 * If you are offline, the lab still works: the server returns a 404 after the configured delay,
 * which is enough to observe the block/swap timeline (the browser cannot know the request will
 * fail until it does). What you lose is the moment of swapping to the real font.
 *
 *   node make-fonts.mjs
 *   node make-fonts.mjs --clean
 */

import { mkdirSync, writeFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'fonts');

if (process.argv.includes('--clean')) {
  if (existsSync(dir)) { rmSync(dir, { recursive: true }); console.log(`removed ${dir}`); }
  else console.log('nothing to clean');
  process.exit(0);
}

// The CSS API gives us the current woff2 URLs; hard-coding binary URLs would rot.
const FAMILIES = [
  { file: 'inter-400', css: 'https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap' },
  { file: 'inter-700', css: 'https://fonts.googleapis.com/css2?family=Inter:wght@700&display=swap' },
  { file: 'playfair-700', css: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&display=swap' },
];

// Ask as a modern browser or Google serves you an older format.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

mkdirSync(dir, { recursive: true });

let ok = 0;
for (const { file, css } of FAMILIES) {
  try {
    const cssText = await (await fetch(css, { headers: { 'user-agent': UA } })).text();
    // Prefer the latin subset — that is what a real site would subset to.
    const blocks = cssText.split('@font-face').filter((b) => b.includes('url('));
    const latin = blocks.find((b) => /unicode-range:[^;]*U\+0000/.test(b)) ?? blocks.at(-1);
    const url = latin.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
    if (!url) throw new Error('no woff2 URL in the CSS response');

    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    const out = join(dir, `${file}.woff2`);
    writeFileSync(out, buf);
    console.log(`  ${file}.woff2  ${(buf.length / 1024).toFixed(1)} KB`);
    ok++;
  } catch (err) {
    console.log(`  ${file}: FAILED — ${err.message}`);
  }
}

console.log(`\n${ok}/${FAMILIES.length} fonts downloaded into ${dir}`);
if (ok) {
  console.log('\nServed by the lab server at, for example:');
  console.log('  /api/font?name=inter-400&delay=2000');
  console.log('  /api/font?name=playfair-700&delay=3000&cc=max-age%3D31536000');
} else {
  console.log('\nNo fonts available — the lab falls back to the timeline-only demo, which still');
  console.log('shows block/swap/failure periods. See the lab README.');
}
console.log('\nLicences: Inter and Playfair Display are SIL OFL 1.1. ./fonts is gitignored.');
