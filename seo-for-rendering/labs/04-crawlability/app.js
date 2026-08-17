// Lab 04 — Crawlability.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

// ---------------------------------------------------------------------------
// 1. robots.txt
//
// The matching rules, which are not what most people assume:
//   - the group with the most specific User-agent match applies (and ONLY that group)
//   - within it, every Allow and Disallow is tested; the LONGEST matching path wins
//   - on a tie, Allow wins
//   - `*` matches any sequence, `$` anchors the end
//   - order in the file is irrelevant
// ---------------------------------------------------------------------------

function parseRobots(text) {
  const groups = [];
  let current = null;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) continue;
    const [field, ...rest] = line.split(':');
    const value = rest.join(':').trim();
    const key = field.trim().toLowerCase();

    if (key === 'user-agent') {
      if (!current || current.rules.length) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
    } else if ((key === 'allow' || key === 'disallow') && current) {
      current.rules.push({ type: key, path: value });
    } else if (key === 'sitemap') {
      groups.sitemap = value;
    }
  }
  return groups;
}

/** Turn a robots path pattern into a regex. `*` = any sequence, `$` = end anchor. */
function patternToRegex(pattern) {
  let p = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  if (p.endsWith('\\$')) p = `${p.slice(0, -2)}$`;
  return new RegExp(`^${p}`);
}

function isAllowed(groups, path, agent = '*') {
  const group = groups.find((g) => g.agents.includes(agent.toLowerCase()))
    ?? groups.find((g) => g.agents.includes('*'));
  if (!group) return { allowed: true, rule: 'no matching group — allowed by default' };

  let best = null;
  for (const rule of group.rules) {
    if (rule.path === '') continue;                       // "Disallow:" with no value means allow all
    if (!patternToRegex(rule.path).test(path)) continue;
    const specificity = rule.path.length;
    if (!best || specificity > best.specificity ||
        (specificity === best.specificity && rule.type === 'allow')) {
      best = { ...rule, specificity };
    }
  }
  if (!best) return { allowed: true, rule: 'no rule matched — allowed by default' };
  return { allowed: best.type === 'allow', rule: `${best.type}: ${best.path} (length ${best.specificity})` };
}

on('testRobots', () => {
  const groups = parseRobots($('robots').value);
  const paths = $('paths').value.split('\n').map((s) => s.trim()).filter(Boolean);
  const rows = paths.map((path) => {
    const r = isAllowed(groups, path);
    return {
      path,
      verdict: r.allowed ? 'crawlable' : 'BLOCKED',
      'winning rule': r.rule,
      _verdictClass: r.allowed ? 'ok' : 'no',
    };
  });
  renderTable('#results', rows, { columns: ['path', 'verdict', 'winning rule'] });
  log.head('— robots.txt evaluation —');
  for (const r of rows) log.line(`${r.verdict.padEnd(10)} ${r.path}`, r.verdict === 'crawlable' ? 'good' : 'bad');

  out.textContent =
    'Note /search/help: it is allowed even though "Disallow: /search" appears first, because the\n' +
    'longer matching rule wins. Order in the file is irrelevant — this surprises nearly everyone,\n' +
    'and it is why "I put the Allow first" is not a fix for anything.\n\n' +
    'Note /_next/static/: blocking your own JS and CSS is a real and damaging mistake. A crawler\n' +
    'that cannot fetch your bundle cannot render your page, so a client-rendered site blocked this\n' +
    'way is indexed as an empty shell. Never disallow the paths your app needs to run.';
});

on('robotsTraps', () => {
  renderTable('#results', [
    {
      trap: 'robots.txt to keep a page out of the index',
      what: 'blocks CRAWLING, not INDEXING',
      detail: 'a blocked URL can still be indexed from external links — it appears with no snippet, ' +
        'and Google cannot see your noindex because it is not allowed to fetch the page',
      fix: 'use meta robots noindex and ALLOW crawling',
    },
    {
      trap: 'blocking /_next/static, /assets, /*.js',
      what: 'the crawler cannot render your page',
      detail: 'client-rendered content becomes invisible; layout-dependent signals are lost',
      fix: 'never block resources your page needs',
    },
    {
      trap: 'noindex + Disallow together',
      what: 'the noindex is never seen',
      detail: 'the page stays indexed indefinitely because the crawler cannot read the directive',
      fix: 'pick one: noindex (allow crawling) OR disallow (accept it may be indexed URL-only)',
    },
    {
      trap: 'robots.txt on a staging domain copied to production',
      what: 'Disallow: /',
      detail: 'the classic catastrophic deploy — the entire site drops out of the index over days',
      fix: 'assert on the production robots.txt in CI; alert on indexed-page count',
    },
    {
      trap: 'Crawl-delay',
      what: 'ignored by Google',
      detail: 'respected by some other crawlers; use Search Console for Google',
      fix: 'do not rely on it',
    },
    {
      trap: 'no Sitemap: line',
      what: 'discovery is slower',
      detail: 'not fatal, but it is one line',
      fix: 'add it',
    },
  ], { columns: ['trap', 'what', 'detail', 'fix'] });

  out.textContent =
    'The first row is the one that matters most, and the one people get backwards:\n\n' +
    '  robots.txt controls CRAWLING. meta robots controls INDEXING.\n\n' +
    'If you Disallow a page, a crawler will not fetch it — so it will never see your noindex tag,\n' +
    'and if other sites link to that URL it can still appear in results as a bare URL with no\n' +
    'description. To remove a page from the index you must ALLOW crawling and serve noindex.\n\n' +
    'The third row is the same mistake made twice, and it is very common in "we tried everything"\n' +
    'situations.';
});

// ---------------------------------------------------------------------------
// 2. Sitemaps
// ---------------------------------------------------------------------------

on('genSitemap', async () => {
  const { products } = await (await fetch('/api/data/products?delay=0')).json();
  const base = 'https://example.com';
  const urls = [
    { loc: `${base}/`, changefreq: 'daily', priority: '1.0' },
    ...products.map((p) => ({
      loc: `${base}/products/${p.id}`,
      lastmod: new Date().toISOString().slice(0, 10),
      changefreq: 'weekly',
      priority: '0.8',
    })),
  ];
  $('sitemap').value =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url>\n    <loc>${u.loc}</loc>\n` +
      (u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>\n` : '') +
      `    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`).join('\n') +
    `\n</urlset>`;
  log.ok(`generated a sitemap with ${urls.length} URLs`);
});

on('checkSitemap', () => {
  const text = $('sitemap').value;
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  const findings = [];
  const add = (level, message, fix) => findings.push({ level, message, fix, _levelClass: level === 'error' ? 'no' : 'meh' });

  if (doc.querySelector('parsererror')) {
    add('error', 'not valid XML', 'a single unescaped & breaks the whole file');
  }
  const urls = [...doc.querySelectorAll('url')];
  const locs = urls.map((u) => u.querySelector('loc')?.textContent?.trim()).filter(Boolean);

  if (!urls.length) add('error', 'no <url> entries', '');
  if (urls.length > 50000) add('error', `${urls.length} URLs`, 'max 50,000 per file — split and use a sitemap index');
  if (new Blob([text]).size > 50 * 1024 * 1024) add('error', 'over 50MB uncompressed', 'split it');

  const relative = locs.filter((l) => !/^https?:\/\//.test(l));
  if (relative.length) add('error', `${relative.length} relative URL(s)`, '<loc> must be absolute');

  const dupes = locs.filter((l, i) => locs.indexOf(l) !== i);
  if (dupes.length) add('warn', `${new Set(dupes).size} duplicate URL(s)`, 'each URL once');

  for (const u of urls) {
    const lastmod = u.querySelector('lastmod')?.textContent?.trim();
    if (lastmod && Number.isNaN(Date.parse(lastmod))) {
      add('error', `invalid lastmod "${lastmod}"`, 'W3C datetime: 2026-08-17 or 2026-08-17T09:00:00Z');
    }
  }
  const withPriority = urls.filter((u) => u.querySelector('priority')).length;
  if (withPriority) {
    add('warn', `${withPriority} entries set <priority>`,
      'Google ignores priority and changefreq entirely — harmless, but they are noise');
  }

  renderTable('#results', findings.length ? findings.map((f) => ({
    level: f.level.toUpperCase(), problem: f.message, fix: f.fix, _levelClass: f._levelClass,
  })) : [{ level: 'OK', problem: `${urls.length} URLs, no problems`, fix: '' }],
  { columns: ['level', 'problem', 'fix'] });

  out.textContent =
    'Sitemap rules worth knowing:\n\n' +
    '  • 50,000 URLs and 50MB uncompressed per file; beyond that use a sitemap index (a sitemap\n' +
    '    of sitemaps), which is also how you split by section so you can see indexing per section\n' +
    '    in Search Console\n' +
    '  • absolute URLs only, and they must be on the same host as the sitemap\n' +
    '  • lastmod is USED (it influences recrawl scheduling) — but only if it is honest. Setting it\n' +
    '    to "now" on every build teaches the crawler to ignore it\n' +
    '  • priority and changefreq are ignored by Google. Harmless noise\n' +
    '  • only include CANONICAL, INDEXABLE URLs. A sitemap containing noindexed or redirected URLs\n' +
    '    is a contradiction, and it is a common source of Search Console warnings\n' +
    '  • reference it from robots.txt AND submit it in Search Console';
});

// ---------------------------------------------------------------------------
// 3. Canonicals & pagination
// ---------------------------------------------------------------------------

on('canonicals', () => {
  renderTable('#results', [
    { situation: '/products?page=2', canonical: 'self (/products?page=2)',
      why: 'each page has different content. Canonicalising them all to page 1 tells Google the ' +
        'products on page 2 do not exist as a page — a classic self-inflicted deindexing' },
    { situation: '/products?utm_source=email', canonical: '/products',
      why: 'tracking parameters do not change content' },
    { situation: '/products?sort=price', canonical: '/products (usually)',
      why: 'same set, different order. If sorted views have genuinely distinct value, self-canonical instead' },
    { situation: '/products?colour=blue (a filter)', canonical: 'self, IF it is a page you want ranked',
      why: 'faceted navigation explodes combinatorially. Decide which facets are landing pages; ' +
        'noindex the rest, or block the parameter' },
    { situation: 'http:// and https://, www and apex', canonical: 'one chosen host, always',
      why: 'redirect the others; do not rely on canonical alone' },
    { situation: 'a syndicated copy on another domain', canonical: 'the original URL',
      why: 'cross-domain canonical is the intended use' },
    { situation: 'AMP / print / m-dot variants', canonical: 'the main version',
      why: '' },
    { situation: 'an infinite scroll listing', canonical: 'paginated URLs that also work',
      why: 'infinite scroll with no crawlable URLs means only the first screen is indexed' },
  ], { columns: ['situation', 'canonical', 'why'] });

  out.textContent =
    'The pagination row is the one that costs the most. Canonicalising /products?page=2 to\n' +
    '/products tells Google that page 2 is a duplicate of page 1 — so the products only on page 2\n' +
    'are never indexed.\n\n' +
    'Correct handling of a paginated set:\n' +
    '  • each page self-canonicalises\n' +
    '  • each page links to the next and previous with real <a href> (rel=next/prev is no longer\n' +
    '    used by Google, but the LINKS still matter — they are how the crawler walks the set)\n' +
    '  • every item is reachable within a few clicks of an indexable page\n' +
    '  • if you use infinite scroll, back it with real paginated URLs that render server-side\n\n' +
    'A canonical is a HINT, not a directive. Google can and does ignore canonicals it disagrees\n' +
    'with — usually when the pages are not actually duplicates, or when your internal links and\n' +
    'sitemap say something different. Make all your signals agree.';
});

on('noindex', () => {
  renderTable('#results', [
    { trap: 'noindex left on after launch', detected: 'traffic never arrives', where: 'a layout, a template default, an env var' },
    { trap: 'noindex on a staging domain copied to prod', detected: 'traffic falls over days', where: 'a shared robots meta' },
    { trap: 'X-Robots-Tag header from a CDN or WAF', detected: 'invisible in the HTML — you must check headers', where: 'edge config' },
    { trap: 'noindex + Disallow', detected: 'page stays indexed forever', where: 'the crawler cannot read the tag' },
    { trap: 'noindex on paginated pages', detected: 'deep items never indexed', where: '"avoid duplicate content" folklore' },
    { trap: 'a JS-injected noindex', detected: 'inconsistent behaviour', where: 'a client-side SEO library' },
  ], { columns: ['trap', 'detected', 'where'] });

  out.textContent =
    'Two things to internalise about noindex:\n\n' +
    '1. It can come from an HTTP HEADER (X-Robots-Tag) as well as a meta tag. A CDN, WAF or\n' +
    '   platform default can add it and it is invisible in the HTML — check with:\n' +
    '     curl -sI https://example.com/page | grep -i x-robots-tag\n\n' +
    '2. Deindexing is not instant, so the symptom appears days or weeks after the deploy that\n' +
    '   caused it. By then nobody connects the two.\n\n' +
    'Therefore: assert on it. A CI check that fetches every public route and fails on any noindex\n' +
    '(meta OR header) takes an hour to write and prevents the single most expensive SEO incident\n' +
    'there is.';
});
