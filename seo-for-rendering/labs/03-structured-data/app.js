// Lab 03 — Structured data.
//
// A validator for the rules that actually cause rich results to be withheld. It is not a full
// schema.org implementation — it is the subset that goes wrong in practice.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

const REQUIRED = {
  Product: ['name'],
  Offer: ['price', 'priceCurrency'],
  Article: ['headline', 'datePublished'],
  NewsArticle: ['headline', 'datePublished'],
  BlogPosting: ['headline', 'datePublished'],
  BreadcrumbList: ['itemListElement'],
  ListItem: ['position', 'name'],
  Organization: ['name'],
  FAQPage: ['mainEntity'],
  Question: ['name', 'acceptedAnswer'],
  Answer: ['text'],
  AggregateRating: ['ratingValue', 'reviewCount'],
  Review: ['author', 'reviewRating'],
  Recipe: ['name', 'recipeIngredient', 'recipeInstructions'],
  Event: ['name', 'startDate', 'location'],
};

const RECOMMENDED = {
  Product: ['image', 'description', 'offers', 'sku', 'brand'],
  Article: ['author', 'image', 'dateModified'],
  Offer: ['availability', 'url'],
  Event: ['endDate', 'offers', 'performer'],
};

const findings = [];
const add = (level, path, message, fix = '') => findings.push({ level, path, message, fix });

function walk(node, path = '$') {
  if (Array.isArray(node)) { node.forEach((n, i) => walk(n, `${path}[${i}]`)); return; }
  if (!node || typeof node !== 'object') return;

  const type = node['@type'];
  if (path === '$' && !node['@context']) {
    add('error', path, 'missing @context', 'add "@context": "https://schema.org"');
  }
  if (node['@context'] && !String(node['@context']).includes('schema.org')) {
    add('error', path, `@context is "${node['@context']}"`, 'must be https://schema.org');
  }
  if (!type) {
    add('error', path, 'missing @type', 'every node needs a @type');
  }

  const types = Array.isArray(type) ? type : [type];
  for (const t of types) {
    for (const field of REQUIRED[t] ?? []) {
      if (node[field] == null || node[field] === '') {
        add('error', `${path}.${field}`, `${t} requires "${field}"`, 'rich results will be withheld');
      }
    }
    for (const field of RECOMMENDED[t] ?? []) {
      if (node[field] == null) {
        add('warn', `${path}.${field}`, `${t} recommends "${field}"`, 'eligible without it, but weaker');
      }
    }
  }

  // --- the mistakes that actually happen ---------------------------------

  if (node.price != null) {
    if (typeof node.price === 'string' && /[^0-9.]/.test(node.price)) {
      add('error', `${path}.price`, `price is "${node.price}"`,
        'must be a bare number: "39.99", never "£39.99" or "39,99"');
    }
    if (typeof node.price === 'number' && !Number.isFinite(node.price)) {
      add('error', `${path}.price`, 'price is not a finite number', '');
    }
  }
  if (node.priceCurrency && !/^[A-Z]{3}$/.test(node.priceCurrency)) {
    add('error', `${path}.priceCurrency`, `priceCurrency is "${node.priceCurrency}"`,
      'must be a 3-letter ISO 4217 code, e.g. "GBP"');
  }
  if (node.availability && !String(node.availability).startsWith('https://schema.org/')) {
    add('error', `${path}.availability`, `availability is "${node.availability}"`,
      'must be a schema.org URL, e.g. https://schema.org/InStock');
  }
  for (const dateField of ['datePublished', 'dateModified', 'startDate', 'endDate']) {
    if (node[dateField] && Number.isNaN(Date.parse(node[dateField]))) {
      add('error', `${path}.${dateField}`, `"${node[dateField]}" is not a valid date`,
        'use ISO 8601: 2026-08-17T09:00:00Z');
    }
  }
  if (node.ratingValue != null) {
    const v = Number(node.ratingValue);
    const best = Number(node.bestRating ?? 5);
    if (Number.isNaN(v) || v > best) {
      add('error', `${path}.ratingValue`, `ratingValue ${node.ratingValue} exceeds bestRating ${best}`, '');
    }
  }
  if (node.reviewCount != null && Number(node.reviewCount) === 0) {
    add('error', `${path}.reviewCount`, 'reviewCount is 0',
      'an aggregateRating with no reviews is invalid — omit the whole node instead');
  }
  if (node.author && typeof node.author === 'string') {
    add('warn', `${path}.author`, 'author is a bare string',
      'prefer { "@type": "Person", "name": "…" } so it can be linked');
  }
  if (node.image && typeof node.image === 'string' && !node.image.startsWith('http')) {
    add('error', `${path}.image`, 'image is a relative URL', 'must be absolute');
  }
  if (node['@type'] === 'BreadcrumbList' && Array.isArray(node.itemListElement)) {
    const positions = node.itemListElement.map((i) => i.position);
    if (positions.some((p, i) => p !== i + 1)) {
      add('error', `${path}.itemListElement`, `positions are ${positions.join(',')}`,
        'must start at 1 and increase by 1');
    }
  }

  for (const [key, value] of Object.entries(node)) {
    if (value && typeof value === 'object') walk(value, `${path}.${key}`);
  }
}

function validate(text) {
  findings.length = 0;
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    add('error', '$', `not valid JSON: ${err.message}`, 'a JSON syntax error means the whole block is ignored');
    return render();
  }
  walk(data);
  return render(data);
}

function render(data) {
  const errors = findings.filter((f) => f.level === 'error');
  const warns = findings.filter((f) => f.level === 'warn');

  renderTable('#results', findings.length ? findings.map((f) => ({
    level: f.level.toUpperCase(), path: f.path, problem: f.message, fix: f.fix,
    _levelClass: f.level === 'error' ? 'no' : 'meh',
  })) : [{ level: 'OK', path: '$', problem: 'no problems found', fix: '' }],
  { columns: ['level', 'path', 'problem', 'fix'] });

  log.line(`${errors.length} error(s), ${warns.length} warning(s)`,
    errors.length ? 'bad' : warns.length ? 'macro' : 'good');
  return { errors, warns, data };
}

// ---------------------------------------------------------------------------

on('fromPage', async () => {
  const html = await (await fetch('/render/ssr-par/product/3?meta=full', { cache: 'no-store' })).text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks = [...doc.querySelectorAll('script[type="application/ld+json"]')];
  log.head(`— found ${blocks.length} JSON-LD block(s) on the product page —`);
  if (!blocks.length) return log.bad('none found');
  $('json').value = JSON.stringify(JSON.parse(blocks[0].textContent), null, 2);
  validate($('json').value);
  out.textContent =
    'That is the sandbox\'s Product markup. Note what it does NOT do: it does not claim a rating\n' +
    'that is not on the page, and it does not invent reviews.\n\n' +
    'The rule that gets sites penalised: structured data must describe content that is VISIBLE on\n' +
    'the page. Marking up a 5-star rating that no user can see is a manual-action offence, not a\n' +
    'clever trick — and "we have reviews on a different page" does not count.';
});

on('validate', () => validate($('json').value));

const EXAMPLES = {
  'ex-product': {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Nimbus 9',
    image: ['https://example.com/nimbus-9.jpg'],
    description: 'A deliberately ordinary product.',
    sku: 'SKU-9',
    brand: { '@type': 'Brand', name: 'Cloudstore' },
    offers: {
      '@type': 'Offer',
      url: 'https://example.com/products/9',
      price: '249.00',
      priceCurrency: 'GBP',
      availability: 'https://schema.org/InStock',
      priceValidUntil: '2026-12-31',
    },
    aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.4', reviewCount: '128' },
  },
  'ex-article': {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: 'How rendering strategies actually differ',
    image: ['https://example.com/cover.jpg'],
    datePublished: '2026-08-17T09:00:00Z',
    dateModified: '2026-08-17T11:30:00Z',
    author: [{ '@type': 'Person', name: 'Ada Lovelace', url: 'https://example.com/authors/ada' }],
  },
  'ex-breadcrumb': {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://example.com/' },
      { '@type': 'ListItem', position: 2, name: 'Products', item: 'https://example.com/products' },
      { '@type': 'ListItem', position: 3, name: 'Nimbus 9' },
    ],
  },
  'ex-broken': {
    '@type': 'Product',
    name: 'Nimbus 9',
    image: '/nimbus-9.jpg',
    offers: {
      '@type': 'Offer',
      price: '£249.00',
      priceCurrency: 'Pounds',
      availability: 'InStock',
    },
    aggregateRating: { '@type': 'AggregateRating', ratingValue: 6, bestRating: 5, reviewCount: 0 },
    author: 'Ada',
  },
};

for (const [id, obj] of Object.entries(EXAMPLES)) {
  on(id, () => {
    $('json').value = JSON.stringify(obj, null, 2);
    const { errors } = validate($('json').value);
    if (id === 'ex-broken') {
      out.textContent =
        `Seven problems in twenty lines, and every one is something a real site ships:\n\n` +
        '  • no @context — the block is meaningless without it, and this is the most common\n' +
        '    single mistake\n' +
        '  • a relative image URL\n' +
        '  • "£249.00" as the price — must be a bare number; the currency goes in priceCurrency\n' +
        '  • "Pounds" instead of the ISO code "GBP"\n' +
        '  • "InStock" instead of the full schema.org URL\n' +
        '  • ratingValue 6 out of bestRating 5\n' +
        '  • reviewCount 0 — an aggregate rating with no reviews is invalid; omit the node\n\n' +
        'None of these throw. Nothing in your build fails. You simply do not get rich results, and\n' +
        'nobody tells you why unless you look — which is what the Rich Results Test and Search\n' +
        'Console\'s enhancement reports are for.';
    } else {
      out.textContent =
        'A clean example. Two things worth copying from it:\n\n' +
        '  • prices as bare strings ("249.00"), currency as an ISO code\n' +
        '  • author as an object with a @type, not a bare string, so it can be linked to an entity\n\n' +
        'And one thing to check that no validator can: does the page actually SHOW this? Structured\n' +
        'data must describe visible content.';
    }
  });
}
