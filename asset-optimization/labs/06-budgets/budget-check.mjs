#!/usr/bin/env node
/**
 * budget-check.mjs — a byte budget you can enforce in CI, with no browser.
 *
 *   node budget-check.mjs http://localhost:8080/render/ssr-par/product/3
 *   node budget-check.mjs --budget js=170,css=60,images=900,fonts=100,total=1400 <url>
 *   node budget-check.mjs --json <url>
 *
 * It fetches the HTML, extracts the subresources the HTML declares, fetches those, and totals
 * the bytes per type. What it deliberately does NOT do is run JavaScript — so it sees what the
 * initial HTML costs, which is the number a budget should be about. Anything a bundle adds at
 * runtime is invisible here and needs a real browser (see the build challenge).
 *
 * Exit code 1 if a budget is exceeded.
 */

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const urls = args.filter((a) => !a.startsWith('--'));
const budgetArg = args.find((a) => a.startsWith('--budget'))?.split('=').slice(1).join('=');

// Defaults, in KB, aimed at a mid-range phone on 4G.
const BUDGET = { js: 170, css: 60, images: 900, fonts: 100, html: 40, total: 1400 };
if (budgetArg) {
  for (const pair of budgetArg.split(',')) {
    const [k, v] = pair.split('=');
    if (k in BUDGET) BUDGET[k] = Number(v);
  }
}

if (!urls.length) {
  console.error('usage: node budget-check.mjs [--json] [--budget js=170,total=1400] <url>');
  process.exit(2);
}

const C = process.stdout.isTTY && !asJson
  ? { red: (s) => `\x1b[31m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m`,
      green: (s) => `\x1b[32m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` }
  : { red: (s) => s, yellow: (s) => s, green: (s) => s, dim: (s) => s, bold: (s) => s };

const KB = (b) => b / 1024;
const fmt = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(2)} MB` : `${KB(b).toFixed(1)} KB`);

function classify(url, contentType = '') {
  const path = url.split('?')[0].toLowerCase();
  if (/\.(js|mjs)$/.test(path) || contentType.includes('javascript')) return 'js';
  if (/\.css$/.test(path) || contentType.includes('text/css')) return 'css';
  if (/\.(png|jpe?g|webp|avif|gif|svg|bmp)$/.test(path) || contentType.startsWith('image/')) return 'images';
  if (/\.(woff2?|ttf|otf)$/.test(path) || contentType.startsWith('font/')) return 'fonts';
  if (contentType.includes('text/html')) return 'html';
  return 'other';
}

/** Pull the subresources the HTML itself declares. No JS execution, by design. */
function subresources(html, base) {
  const found = new Set();
  const push = (u) => {
    if (!u || u.startsWith('data:') || u.startsWith('#')) return;
    try { found.add(new URL(u, base).href); } catch { /* ignore */ }
  };

  for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) push(m[1]);
  for (const m of html.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const tag = m[0];
    if (/rel\s*=\s*["'](stylesheet|preload|modulepreload)["']/i.test(tag)) push(m[1]);
  }
  for (const m of html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) push(m[1]);
  for (const m of html.matchAll(/\bsrcset\s*=\s*["']([^"']+)["']/gi)) {
    // Only the first candidate: a budget should count what one visitor downloads, not the menu.
    push(m[1].split(',')[0].trim().split(/\s+/)[0]);
  }
  for (const m of html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) push(m[1]);
  return [...found];
}

// ---------------------------------------------------------------------------

const reports = [];
let failures = 0;

for (const url of urls) {
  const res = await fetch(url, { headers: { 'accept-encoding': 'br, gzip' } });
  const html = await res.text();
  const htmlBytes = Buffer.byteLength(html);

  const totals = { js: 0, css: 0, images: 0, fonts: 0, html: htmlBytes, other: 0 };
  const assets = [];

  const subs = subresources(html, url);
  await Promise.all(subs.map(async (sub) => {
    try {
      const r = await fetch(sub, { headers: { 'accept-encoding': 'br, gzip' } });
      const buf = Buffer.from(await r.arrayBuffer());
      const type = classify(sub, r.headers.get('content-type') || '');
      totals[type] = (totals[type] || 0) + buf.length;
      assets.push({
        url: sub.replace(new URL(url).origin, ''),
        type,
        bytes: buf.length,
        encoding: r.headers.get('content-encoding') || 'identity',
        cache: r.headers.get('cache-control') || '(none)',
      });
    } catch { /* unreachable subresource */ }
  }));

  const total = Object.values(totals).reduce((a, b) => a + b, 0);
  const results = Object.entries(BUDGET).map(([key, kb]) => {
    const actual = key === 'total' ? total : (totals[key] || 0);
    const over = KB(actual) > kb;
    if (over) failures++;
    return { budget: key, limit: `${kb} KB`, actual: fmt(actual),
      status: over ? 'OVER' : 'ok', by: over ? fmt(actual - kb * 1024) : '' };
  });

  assets.sort((a, b) => b.bytes - a.bytes);
  reports.push({ url, totals, total, results, assets });
}

if (asJson) {
  console.log(JSON.stringify(reports, null, 2));
} else {
  for (const r of reports) {
    console.log('\n' + C.bold(r.url));
    for (const row of r.results) {
      const label = `  ${row.budget.padEnd(7)} ${row.actual.padStart(10)} / ${row.limit.padStart(8)}`;
      console.log(row.status === 'OVER' ? C.red(`${label}   OVER by ${row.by}`) : C.green(`${label}   ok`));
    }
    console.log(C.dim('\n  largest assets:'));
    for (const a of r.assets.slice(0, 8)) {
      console.log(`    ${fmt(a.bytes).padStart(10)}  ${a.type.padEnd(7)} ${a.encoding.padEnd(9)} ${a.url.slice(0, 60)}`);
    }
    const uncompressed = r.assets.filter((a) =>
      ['js', 'css'].includes(a.type) && a.encoding === 'identity' && a.bytes > 2048);
    if (uncompressed.length) {
      console.log(C.yellow(`\n  ⚠ ${uncompressed.length} compressible asset(s) served uncompressed:`));
      for (const a of uncompressed) console.log(`      ${fmt(a.bytes).padStart(10)}  ${a.url}`);
    }
    const uncached = r.assets.filter((a) => /no-store|no-cache/.test(a.cache) && a.type !== 'html');
    if (uncached.length) {
      console.log(C.yellow(`\n  ⚠ ${uncached.length} asset(s) with no-store/no-cache — repeat visits re-download them`));
    }
  }
  console.log(`\n${failures} budget(s) exceeded.`);
  console.log(C.dim('Note: this does not run JavaScript, so it measures what the HTML costs.'));
  console.log(C.dim('Anything a bundle fetches at runtime needs a real browser — see the README.'));
}

process.exit(failures ? 1 : 0);
