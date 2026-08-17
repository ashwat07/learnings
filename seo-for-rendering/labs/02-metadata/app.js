// Lab 02 — Metadata.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

async function parse(url) {
  const html = await (await fetch(url, { cache: 'no-store' })).text();
  return { doc: new DOMParser().parseFromString(html, 'text/html'), html };
}

const get = (doc, sel, attr = 'content') => doc.querySelector(sel)?.[attr] ?? doc.querySelector(sel)?.getAttribute(attr) ?? null;

/**
 * The checks that matter, with the reasons. Lengths are not arbitrary: they are where search
 * results and social cards truncate, and a truncated title loses the part you cared about.
 */
function checkMetadata(doc, url) {
  const title = doc.querySelector('title')?.textContent?.trim() ?? null;
  const desc = get(doc, 'meta[name=description]');
  const canonical = doc.querySelector('link[rel=canonical]')?.getAttribute('href') ?? null;
  const ogTitle = get(doc, 'meta[property="og:title"]');
  const ogDesc = get(doc, 'meta[property="og:description"]');
  const ogImage = get(doc, 'meta[property="og:image"]');
  const ogUrl = get(doc, 'meta[property="og:url"]');
  const twitter = get(doc, 'meta[name="twitter:card"]');
  const robots = get(doc, 'meta[name=robots]');
  const lang = doc.documentElement.getAttribute('lang');
  const viewport = get(doc, 'meta[name=viewport]');
  const h1s = doc.querySelectorAll('h1');

  const rows = [];
  const add = (field, value, verdict, note) => rows.push({
    field, value: value == null ? '(missing)' : String(value).slice(0, 60), verdict, note,
    _verdictClass: verdict === 'ok' ? 'ok' : verdict === 'warn' ? 'meh' : 'no',
  });

  add('<title>', title,
    !title ? 'fail' : title.length > 60 ? 'warn' : title.length < 15 ? 'warn' : 'ok',
    !title ? 'every page needs one, and it is the strongest on-page signal there is'
      : title.length > 60 ? `${title.length} chars — Google truncates around 55–60`
        : title.length < 15 ? 'very short; is it descriptive enough to click?'
          : 'good length');

  add('meta description', desc,
    !desc ? 'warn' : desc.length > 160 ? 'warn' : 'ok',
    !desc ? 'not a ranking factor, but it IS the snippet people decide on. Google will invent one.'
      : desc.length > 160 ? `${desc.length} chars — truncated around 155–160`
        : 'good length');

  add('canonical', canonical, !canonical ? 'warn' : 'ok',
    !canonical ? 'without it, ?utm_source=… and ?page=1 are separate pages competing with each other'
      : 'self-referencing canonicals are correct and recommended');

  add('og:title', ogTitle, !ogTitle ? 'fail' : 'ok',
    !ogTitle ? 'Slack/X/WhatsApp will fall back to <title> or show a bare URL' : '');
  add('og:description', ogDesc, !ogDesc ? 'warn' : 'ok', '');
  add('og:image', ogImage, !ogImage ? 'fail' : 'ok',
    !ogImage ? 'no image = a card nobody clicks. 1200×630, under ~5MB, absolute URL.'
      : ogImage.startsWith('http') ? 'absolute URL — correct' : 'MUST be absolute; relative URLs are ignored by scrapers');
  add('og:url', ogUrl, !ogUrl ? 'warn' : 'ok', 'the canonical URL for sharing');
  add('twitter:card', twitter, !twitter ? 'warn' : 'ok',
    !twitter ? 'without it you get a small card instead of a large image' : '');
  add('<html lang>', lang, !lang ? 'fail' : 'ok',
    !lang ? 'affects search, translation prompts, and screen-reader pronunciation' : '');
  add('viewport', viewport, !viewport ? 'fail' : 'ok', 'mobile-friendliness is a ranking factor');
  add('robots', robots ?? '(none — indexable)', 'ok',
    robots ? 'CHECK THIS — a stray noindex is the single most expensive SEO bug' : 'indexable by default');
  add('<h1> count', h1s.length, h1s.length === 1 ? 'ok' : 'warn',
    h1s.length === 0 ? 'no h1' : h1s.length > 1 ? 'multiple h1s: legal in HTML5, still worth being deliberate about' : '');

  return { rows, title, desc, ogTitle, ogDesc, ogImage, ogUrl };
}

on('check', async () => {
  const url = $('url').value;
  log.head(`— ${url} —`);
  const { doc } = await parse(url);
  const { rows } = checkMetadata(doc, url);
  renderTable('#results', rows, { columns: ['field', 'value', 'verdict', 'note'] });

  const fails = rows.filter((r) => r.verdict === 'fail').length;
  const warns = rows.filter((r) => r.verdict === 'warn').length;
  log.line(`${fails} failures, ${warns} warnings`, fails ? 'bad' : warns ? 'macro' : 'good');

  out.textContent = url.includes('csr')
    ? 'Look carefully: the CSR page has the metadata in its HTML because the sandbox puts it in the\n' +
      'shell. That is the CORRECT pattern — metadata is server-rendered even when content is not.\n\n' +
      'The failure mode in real SPAs is the opposite: metadata is set by the client router (via\n' +
      'react-helmet, next/head on a client route, or document.title = …) so it exists only after\n' +
      'JavaScript runs. Googlebot may see it. No social scraper will.\n\n' +
      'Test: curl the URL. If the title in the response is "My App" for every route, every share\n' +
      'preview on your site says "My App".'
    : 'Fix the failures first: a missing og:image is a card nobody clicks, and a missing lang is a\n' +
      'one-attribute fix.\n\n' +
      'Note the two length checks. They are not arbitrary — they are where results truncate, and a\n' +
      'truncated title loses exactly the part you cared about (the end). Write the important words\n' +
      'first.';
});

on('preview', async () => {
  const url = $('url').value;
  const { doc } = await parse(url);
  const m = checkMetadata(doc, url);
  const card = $('#card');
  const ok = m.ogTitle && m.ogImage;

  $('#card-title').textContent = m.ogTitle || m.title || url;
  $('#card-desc').textContent = m.ogDesc || m.desc || '(no description — the scraper shows nothing here)';
  $('#card-host').textContent = new URL(m.ogUrl || location.href).host;
  $('#card-img').src = m.ogImage || '';
  $('#card-img').style.display = m.ogImage ? 'block' : 'none';
  card.classList.toggle('broken', !ok);

  log.line(ok ? 'this page would produce a proper card' : 'this page would produce a bare/degraded link',
    ok ? 'good' : 'bad');
  out.textContent =
    'This is roughly what Slack, X, WhatsApp, Discord and iMessage render — from the HTML alone,\n' +
    'with no JavaScript.\n\n' +
    'The og:image rules that catch people:\n' +
    '  • must be an ABSOLUTE URL (relative ones are ignored)\n' +
    '  • 1200×630 is the safe size for a large card; under about 5MB\n' +
    '  • must be publicly fetchable — behind auth, behind a bot-blocking WAF, or requiring cookies\n' +
    '    all produce a blank card, and this is the most common cause of "our preview is broken"\n' +
    '  • scrapers cache aggressively: after fixing tags you usually have to re-scrape (Facebook\n' +
    '    sharing debugger, X card validator, or appending a cache-busting query once)\n\n' +
    'Ten-second test for any real site: paste the URL into a Slack DM to yourself.';
});

on('traps', () => {
  renderTable('#results', [
    {
      trap: 'metadata set by the client router',
      symptom: 'every share preview shows the same generic title',
      why: 'react-helmet / document.title run after JS. Scrapers do not run JS.',
      fix: 'render metadata on the server, per route. In Next.js: the metadata API, not a client component.',
    },
    {
      trap: 'metadata that depends on slow data, on a streamed page',
      symptom: 'title is a placeholder, or the stream stalls',
      why: '<head> is flushed first, so anything in it must be known BEFORE the first byte.',
      fix: 'fetch what the head needs before flushing; stream only the body. If the title needs the slow query, that route cannot stream its head.',
    },
    {
      trap: 'a stray noindex',
      symptom: 'traffic falls off a cliff a week after a deploy',
      why: 'a staging default, a CMS toggle, a robots meta on a shared layout',
      fix: 'assert on it in CI for every public route; monitor indexed page count.',
    },
    {
      trap: 'canonical pointing at the wrong URL',
      symptom: 'pages deindexed, or the wrong variant ranks',
      why: 'copy-pasted canonicals, or one built from a request URL including query parameters',
      fix: 'self-referencing canonical, built from a canonical URL function, tested per route.',
    },
    {
      trap: 'og:image relative or unreachable',
      symptom: 'blank card',
      why: 'relative URL, or the image needs auth/cookies/a WAF exemption',
      fix: 'absolute URL, publicly fetchable, verified by an automated check.',
    },
  ], { columns: ['trap', 'symptom', 'why', 'fix'] });

  out.textContent =
    'The second one is the interesting interaction with the rendering course: streaming flushes\n' +
    '<head> first, so anything in the head must be known before the first byte. If your <title>\n' +
    'depends on the 900ms query, you must either wait for it (losing the streaming benefit for that\n' +
    'route) or accept a placeholder title.\n\n' +
    'Frameworks paper over this by injecting a late <title> via script, which works for browsers\n' +
    'and is a gamble for crawlers. The honest options: derive the title from something you already\n' +
    'have (the URL slug), fetch just that one field before flushing, or do not stream that route.\n\n' +
    'The third one — a stray noindex — is the most expensive SEO bug there is, it is a one-line\n' +
    'change, and it is invisible until traffic drops. Assert on it in CI.';
});
