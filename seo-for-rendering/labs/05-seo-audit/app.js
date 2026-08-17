// Lab 05 — Audit it (in-page version of the CLI's rules).

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
let lastFindings = [];

const TARGETS = [
  ['csr, no metadata', '/render/csr/product/3'],
  ['csr, with metadata', '/render/csr/product/3?meta=full'],
  ['ssr, no metadata', '/render/ssr-par/product/3'],
  ['ssr, with metadata', '/render/ssr-par/product/3?meta=full'],
  ['streaming, with metadata', '/render/stream/product/3?meta=full'],
  ['rsc, with metadata', '/render/rsc/product/3?meta=full'],
  ['listing, with metadata', '/render/ssr-par/?meta=full'],
];

function auditDoc(doc, html) {
  const findings = [];
  const add = (level, check, message) => findings.push({ level, check, message });

  const text = (doc.body?.textContent || '').replace(/\s+/g, ' ').trim();
  const words = text ? text.split(' ').length : 0;
  const title = doc.querySelector('title')?.textContent?.trim();
  const desc = doc.querySelector('meta[name=description]')?.content;
  const canonical = doc.querySelector('link[rel=canonical]')?.getAttribute('href');
  const ogTitle = doc.querySelector('meta[property="og:title"]')?.content;
  const ogImage = doc.querySelector('meta[property="og:image"]')?.content;
  const robots = doc.querySelector('meta[name=robots]')?.content;
  const lang = doc.documentElement.getAttribute('lang');
  const jsonLd = [...doc.querySelectorAll('script[type="application/ld+json"]')];

  if (/noindex/i.test(robots || '')) add('error', 'indexability', `noindex: ${robots}`);
  if (words < 30) add('error', 'content', `${words} words in the raw HTML`);
  else if (words < 100) add('warn', 'content', `${words} words in the raw HTML`);
  if (!doc.querySelector('h1')) add('warn', 'content', 'no h1');
  if (!title) add('error', 'metadata', 'no title');
  else if (title.length > 60) add('warn', 'metadata', `title ${title.length} chars`);
  if (!desc) add('warn', 'metadata', 'no description');
  if (!canonical) add('warn', 'metadata', 'no canonical');
  if (!lang) add('error', 'metadata', 'no html lang');
  if (!ogTitle) add('error', 'social', 'no og:title');
  if (!ogImage) add('error', 'social', 'no og:image');
  else if (!/^https?:\/\//.test(ogImage)) add('error', 'social', 'og:image is relative');

  for (const [i, block] of jsonLd.entries()) {
    try {
      const node = JSON.parse(block.textContent);
      if (!node['@context']) add('error', 'structured-data', `block ${i}: no @context`);
      if (!node['@type']) add('error', 'structured-data', `block ${i}: no @type`);
      const offer = node.offers;
      if (offer?.price != null && /[^\d.]/.test(String(offer.price))) {
        add('error', 'structured-data', `block ${i}: price must be a bare number`);
      }
    } catch (err) {
      add('error', 'structured-data', `block ${i}: invalid JSON`);
    }
  }

  return { findings, words, title, jsonLd: jsonLd.length, bytes: html.length };
}

on('audit', async () => {
  log.clear();
  lastFindings = [];
  const rows = [];
  for (const [label, url] of TARGETS) {
    const html = await (await fetch(url, { cache: 'no-store' })).text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const r = auditDoc(doc, html);
    const errors = r.findings.filter((f) => f.level === 'error').length;
    const warns = r.findings.filter((f) => f.level === 'warn').length;
    lastFindings.push({ label, url, ...r });

    rows.push({
      page: label,
      words: r.words,
      'JSON-LD': r.jsonLd,
      errors,
      warnings: warns,
      verdict: errors === 0 && warns <= 1 ? 'ship it' : errors ? 'not indexable as intended' : 'fix the warnings',
      _errorsClass: errors ? 'no' : 'ok',
      _verdictClass: errors ? 'no' : warns > 1 ? 'meh' : 'ok',
    });
    renderTable('#results', rows, {
      columns: ['page', 'words', 'JSON-LD', 'errors', 'warnings', 'verdict'],
    });
    log.line(`${label.padEnd(28)} ${String(r.words).padStart(4)} words · ${errors} error(s) · ${warns} warning(s)`,
      errors ? 'bad' : 'good');
  }

  out.textContent =
    'The pattern across the rows is the course in one table:\n\n' +
    '  • metadata is independent of rendering strategy. The CSR page WITH metadata passes every\n' +
    '    metadata check and still has no content — those are two different problems and you need\n' +
    '    both fixed.\n' +
    '  • the RSC row has the data in the HTML and no words in the DOM, which is why "we use RSC"\n' +
    '    is not an answer to "is it indexable".\n' +
    '  • streaming is fine for content and needs care in <head> (lab 02).\n\n' +
    'Now run the CLI against a real site. The first run on a site nobody has audited usually finds\n' +
    'a duplicate title, a missing canonical, and at least one og:image that does not load.';
});

on('detail', () => {
  if (!lastFindings.length) return log.bad('run the audit first');
  const rows = lastFindings.flatMap((r) => r.findings.map((f) => ({
    page: r.label, level: f.level.toUpperCase(), check: f.check, finding: f.message,
    _levelClass: f.level === 'error' ? 'no' : 'meh',
  })));
  renderTable('#results', rows.length ? rows : [{ page: '—', level: 'OK', check: '—', finding: 'nothing found' }],
    { columns: ['page', 'level', 'check', 'finding'] });
});

on('clear', () => { log.clear(); $('#results').textContent = ''; });
