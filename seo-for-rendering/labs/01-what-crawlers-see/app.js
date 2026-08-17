// Lab 01 — What crawlers see.
//
// Fetch the HTML, parse it WITHOUT executing scripts, and report what a non-JS consumer finds.
// DOMParser is exactly the right tool: it builds a document and runs nothing.

import { $, on, Log, renderTable, fmt } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

const MODES = ['csr', 'ssr', 'ssr-par', 'stream', 'rsc'];

/** Everything a crawler could extract from a response body, with no JS execution. */
function analyse(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // Scripts parsed by DOMParser never run — this is genuinely the no-JS view.
  const text = (doc.body?.textContent || '').replace(/\s+/g, ' ').trim();

  return {
    title: doc.querySelector('title')?.textContent ?? '(none)',
    h1: doc.querySelector('h1')?.textContent?.trim() ?? '(none)',
    description: doc.querySelector('meta[name=description]')?.content ?? '(none)',
    canonical: doc.querySelector('link[rel=canonical]')?.href ?? '(none)',
    ogTitle: doc.querySelector('meta[property="og:title"]')?.content ?? '(none)',
    jsonLd: doc.querySelectorAll('script[type="application/ld+json"]').length,
    words: text ? text.split(/\s+/).length : 0,
    links: doc.querySelectorAll('a[href]').length,
    images: doc.querySelectorAll('img').length,
    headings: doc.querySelectorAll('h1,h2,h3').length,
    textSample: text.slice(0, 120),
  };
}

on('compare', async () => {
  log.clear();
  const route = $('route').value;
  log.head(`— fetching /render/*/${route || '(listing)'} and parsing without running scripts —`);
  const rows = [];

  for (const mode of MODES) {
    const html = await (await fetch(`/render/${mode}/${route}?meta=full`, { cache: 'no-store' })).text();
    const a = analyse(html);
    rows.push({
      mode,
      'words of text': a.words,
      links: a.links,
      headings: a.headings,
      title: a.title.slice(0, 34),
      'description?': a.description === '(none)' ? 'NO' : 'yes',
      'JSON-LD': a.jsonLd,
      _wordsClass: a.words > 100 ? 'ok' : a.words > 20 ? 'meh' : 'no',
    });
    log.line(`${mode.padEnd(9)} ${String(a.words).padStart(4)} words · ${a.links} links · ` +
      `h1 "${a.h1.slice(0, 30)}"`, a.words > 100 ? 'good' : 'bad');
    renderTable('#results', rows, {
      columns: ['mode', 'words of text', 'links', 'headings', 'title', 'description?', 'JSON-LD'],
    });
  }

  const csr = rows.find((r) => r.mode === 'csr');
  const ssr = rows.find((r) => r.mode === 'ssr-par');
  const rsc = rows.find((r) => r.mode === 'rsc');

  out.textContent =
    `The numbers, without interpretation:\n\n` +
    `  csr      ${csr['words of text']} words, ${csr.links} links\n` +
    `  ssr-par  ${ssr['words of text']} words, ${ssr.links} links\n` +
    `  rsc      ${rsc['words of text']} words, ${rsc.links} links\n\n` +
    'For a consumer that does not run JavaScript, the CSR page is an empty document with a\n' +
    'skeleton in it. Not "slow to index" — empty.\n\n' +
    'Note the RSC row: the data IS in the HTML (inside the flight payload script tag), but it is\n' +
    'not in the DOM as text or links, so a text extractor finds nothing. Real RSC frameworks solve\n' +
    'this by ALSO server-rendering the payload to HTML — which is worth knowing, because it means\n' +
    '"we use RSC" tells you nothing about SEO on its own. Check the output, not the architecture.\n\n' +
    'Who does not run your JS: every social scraper (Slack, WhatsApp, X, Discord, iMessage), most\n' +
    'LLM crawlers, Bing partially, and every internal tool that fetches a URL. Googlebot does, in a\n' +
    'deferred second pass with a budget you do not control.\n\n' +
    'The rule: if it matters for search or sharing, it is in the response body.';
});

on('raw', async () => {
  const mode = $('mode').value;
  const route = $('route').value;
  const html = await (await fetch(`/render/${mode}/${route}?meta=full`, { cache: 'no-store' })).text();
  $('#raw').textContent = html.slice(0, 4000) + (html.length > 4000 ? '\n\n… truncated' : '');
  const a = analyse(html);
  log.head(`— raw ${mode} —`);
  log.line(`${fmt.bytes(html.length)} · ${a.words} words · title "${a.title}"`, 'macro');
  log.muted(`first 120 chars of extracted text: "${a.textSample}"`);
  out.textContent =
    'This is exactly what a crawler receives. Read it the way one would: is the product name in\n' +
    'there? The price? The description? The links to other pages?\n\n' +
    'The same check on a real site is one command:\n\n' +
    '    curl -s https://example.com/product/123 | less\n\n' +
    'and for the specific question of whether Googlebot sees something different, use the URL\n' +
    'Inspection tool in Search Console (it shows the rendered HTML after JS) and compare it with\n' +
    'the raw response. A large difference between the two is your JS-dependency risk, expressed\n' +
    'concretely.';
});
