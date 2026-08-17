#!/usr/bin/env node
/**
 * seo-audit.mjs — audit a real URL from the command line.
 *
 *   node seo-audit.mjs https://example.com/product/123
 *   node seo-audit.mjs --json https://example.com/ | jq
 *   node seo-audit.mjs --render https://example.com/     (needs a headless browser; see below)
 *
 * It checks the things that are cheap to check and expensive to get wrong: is the content in the
 * HTML, is the metadata complete, is the structured data valid, is anything accidentally
 * noindexed. No dependencies — the HTML "parsing" is regex-based, which is fine for extracting
 * head tags and counting elements, and is called out where it is a limitation.
 *
 * Exit code 1 if there are errors, so it can gate a deploy.
 */

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const urls = args.filter((a) => !a.startsWith('--'));

if (!urls.length) {
  console.error('usage: node seo-audit.mjs [--json] <url> [url...]');
  process.exit(2);
}

const C = process.stdout.isTTY && !asJson
  ? { red: (s) => `\x1b[31m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m`,
      green: (s) => `\x1b[32m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` }
  : { red: (s) => s, yellow: (s) => s, green: (s) => s, dim: (s) => s, bold: (s) => s };

// ---------------------------------------------------------------------------
// Extraction. Regex over HTML is a bad general-purpose tool and an adequate one for head tags.
// ---------------------------------------------------------------------------

const attr = (tag, name) => tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1] ?? null;

function extract(html) {
  const head = html.slice(0, html.search(/<\/head>/i) + 7);
  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
  const links = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);

  const metaBy = (key, value) => metas.find((m) =>
    (attr(m, key) || '').toLowerCase() === value)?.match(/content\s*=\s*["']([^"']*)["']/i)?.[1] ?? null;

  // Strip scripts, styles and tags to approximate the text a crawler indexes.
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const jsonLd = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1]);

  return {
    title: html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null,
    description: metaBy('name', 'description'),
    robots: metaBy('name', 'robots'),
    viewport: metaBy('name', 'viewport'),
    ogTitle: metaBy('property', 'og:title'),
    ogDescription: metaBy('property', 'og:description'),
    ogImage: metaBy('property', 'og:image'),
    ogUrl: metaBy('property', 'og:url'),
    twitterCard: metaBy('name', 'twitter:card'),
    canonical: links.find((l) => (attr(l, 'rel') || '').toLowerCase() === 'canonical')
      ? attr(links.find((l) => (attr(l, 'rel') || '').toLowerCase() === 'canonical'), 'href') : null,
    lang: html.match(/<html[^>]*\blang\s*=\s*["']([^"']*)["']/i)?.[1] ?? null,
    h1s: [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => m[1].replace(/<[^>]+>/g, '').trim()),
    headings: (html.match(/<h[1-3]\b/gi) || []).length,
    links: (html.match(/<a\b[^>]*href=/gi) || []).length,
    images: [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]),
    words: body ? body.split(' ').length : 0,
    jsonLd,
    bytes: Buffer.byteLength(html),
  };
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

function audit(url, res, html) {
  const d = extract(html);
  const findings = [];
  const add = (level, check, message) => findings.push({ level, check, message });

  // --- indexability (the expensive ones) ---------------------------------
  const xRobots = res.headers.get('x-robots-tag');
  if (/noindex/i.test(d.robots || '') || /noindex/i.test(xRobots || '')) {
    add('error', 'indexability',
      `NOINDEX present (${/noindex/i.test(xRobots || '') ? `X-Robots-Tag header: ${xRobots}` : `meta robots: ${d.robots}`})`);
  }
  if (res.status >= 300) add('error', 'status', `HTTP ${res.status}`);

  // --- content in the HTML ------------------------------------------------
  if (d.words < 100) {
    add(d.words < 30 ? 'error' : 'warn', 'content',
      `only ${d.words} words in the raw HTML — is the content client-rendered?`);
  }
  if (!d.h1s.length) add('warn', 'content', 'no <h1>');
  else if (d.h1s.length > 1) add('warn', 'content', `${d.h1s.length} <h1> elements`);
  if (d.links < 3) add('warn', 'content', `${d.links} links — crawlers follow links to find pages`);

  // --- metadata -----------------------------------------------------------
  if (!d.title) add('error', 'metadata', 'no <title>');
  else if (d.title.length > 60) add('warn', 'metadata', `title is ${d.title.length} chars (truncates ~60)`);
  else if (d.title.length < 15) add('warn', 'metadata', `title is only ${d.title.length} chars`);

  if (!d.description) add('warn', 'metadata', 'no meta description');
  else if (d.description.length > 160) add('warn', 'metadata', `description is ${d.description.length} chars (truncates ~160)`);

  if (!d.canonical) add('warn', 'metadata', 'no canonical');
  else if (!/^https?:\/\//.test(d.canonical)) add('error', 'metadata', `canonical is relative: ${d.canonical}`);

  if (!d.lang) add('error', 'metadata', 'no <html lang>');
  if (!d.viewport) add('error', 'metadata', 'no viewport meta');

  // --- social -------------------------------------------------------------
  if (!d.ogTitle) add('error', 'social', 'no og:title — link previews will be bare');
  if (!d.ogImage) add('error', 'social', 'no og:image');
  else if (!/^https?:\/\//.test(d.ogImage)) add('error', 'social', `og:image is relative: ${d.ogImage}`);
  if (!d.twitterCard) add('warn', 'social', 'no twitter:card');

  // --- images -------------------------------------------------------------
  const noAlt = d.images.filter((img) => !/\balt\s*=/.test(img)).length;
  if (noAlt) add('warn', 'images', `${noAlt} of ${d.images.length} <img> without alt`);

  // --- structured data ----------------------------------------------------
  for (const [i, block] of d.jsonLd.entries()) {
    try {
      const parsed = JSON.parse(block);
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        if (!node['@context']) add('error', 'structured-data', `block ${i}: missing @context`);
        if (!node['@type']) add('error', 'structured-data', `block ${i}: missing @type`);
        const offers = node.offers && (Array.isArray(node.offers) ? node.offers : [node.offers]);
        for (const offer of offers || []) {
          if (offer.price != null && /[^\d.]/.test(String(offer.price))) {
            add('error', 'structured-data', `block ${i}: price "${offer.price}" must be a bare number`);
          }
          if (offer.priceCurrency && !/^[A-Z]{3}$/.test(offer.priceCurrency)) {
            add('error', 'structured-data', `block ${i}: priceCurrency "${offer.priceCurrency}" must be ISO 4217`);
          }
          if (offer.availability && !String(offer.availability).startsWith('https://schema.org/')) {
            add('error', 'structured-data', `block ${i}: availability must be a schema.org URL`);
          }
        }
      }
    } catch (err) {
      add('error', 'structured-data', `block ${i}: invalid JSON (${err.message}) — the whole block is ignored`);
    }
  }
  if (!d.jsonLd.length) add('info', 'structured-data', 'no JSON-LD (fine, unless you want rich results)');

  return { url, status: res.status, data: d, findings };
}

// ---------------------------------------------------------------------------

const reports = [];
let errorCount = 0;

for (const url of urls) {
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'seo-audit/1.0' } });
    const html = await res.text();
    const report = audit(url, res, html);
    reports.push(report);
    errorCount += report.findings.filter((f) => f.level === 'error').length;
  } catch (err) {
    reports.push({ url, error: String(err) });
    errorCount++;
  }
}

if (asJson) {
  console.log(JSON.stringify(reports, null, 2));
} else {
  for (const r of reports) {
    console.log('\n' + C.bold(r.url));
    if (r.error) { console.log('  ' + C.red(r.error)); continue; }
    const d = r.data;
    console.log(`  ${C.dim('status')}      ${r.status}   ${C.dim('bytes')} ${d.bytes}   ${C.dim('words')} ${d.words}   ${C.dim('links')} ${d.links}`);
    console.log(`  ${C.dim('title')}       ${d.title ?? C.red('(none)')}`);
    console.log(`  ${C.dim('description')} ${(d.description ?? C.yellow('(none)')).slice(0, 80)}`);
    console.log(`  ${C.dim('canonical')}   ${d.canonical ?? C.yellow('(none)')}`);
    console.log(`  ${C.dim('json-ld')}     ${d.jsonLd.length} block(s)`);
    for (const f of r.findings) {
      const tag = f.level === 'error' ? C.red('  ✗ ') : f.level === 'warn' ? C.yellow('  ⚠ ') : C.dim('  · ');
      console.log(`${tag}[${f.check}] ${f.message}`);
    }
    if (!r.findings.length) console.log(C.green('  ✓ no findings'));
  }
  console.log(`\n${urls.length} URL(s), ${errorCount} error-level finding(s).`);
  console.log(C.dim('Note: this checks the RAW HTML. To see what Googlebot sees after JS, use'));
  console.log(C.dim('Search Console URL Inspection, or add a headless-browser pass (see the README).'));
}

process.exit(errorCount ? 1 : 0);
