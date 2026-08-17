/**
 * render.mjs — the same page, rendered six ways.
 *
 * This is the whole rendering-strategies course in one file. Read it: the templates are shared,
 * so the ONLY thing that differs between strategies is *when* the HTML is produced and *what
 * JavaScript has to run afterwards*. Everything else about the comparison is held constant,
 * which is what makes the measurements mean anything.
 *
 * Modes:
 *   csr     — a shell, then the client fetches and renders everything
 *   ssr     — rendered per request, blocking on every data source
 *   ssr-par — rendered per request, data fetched in parallel (the same page, better TTFB)
 *   ssg     — rendered once and cached forever (simulating build time)
 *   isr     — rendered on demand, cached for `revalidate` seconds, then refreshed in the
 *             background while serving stale (the same idea as stale-while-revalidate)
 *   stream  — the shell streams immediately; slow slots are flushed later, out of order
 *   rsc     — the server sends a serialised component tree, the client renders it
 */

import { getProducts, getProduct, getRecommends, getReviews, version, calls } from './data.mjs';
import {
  esc, skeleton, listingHTML as listingTpl, productHTML as productTpl,
  recommendsHTML, reviewsHTML,
} from './templates.js';

// The same template functions the browser uses (templates.js), with the server's current
// content version baked in. Isomorphic by construction, not by convention.
const listingHTML = (products) => listingTpl(products, version.n);
const productHTML = (product) => productTpl(product, version.n);

export { skeleton, recommendsHTML, reviewsHTML, listingHTML, productHTML };

export function shell({ title, mode, body, head = '', bootstrap = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/shared/app/app.css">
${head}
</head>
<body data-mode="${esc(mode)}">
<header class="app-header">
  <strong>Cloudstore</strong>
  <nav>
    <a href="/render/${mode}/">listing</a>
    <a href="/render/${mode}/product/3">product 3</a>
    <a href="/render/${mode}/product/7">product 7</a>
  </nav>
  <span class="badge">mode: ${esc(mode)}</span>
</header>
<main id="root">${body}</main>
<div id="perf" class="perf">measuring…</div>
<script src="/shared/app/measure.js"></script>
${bootstrap}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Streaming plumbing
//
// This is the mechanism React 18's streaming SSR uses, reduced to its essentials: emit a
// placeholder now, and later emit the real content in a <template> plus a one-line script that
// swaps it in. It works with no client framework, it works while the HTML is still streaming,
// and it degrades to "the slow bits never appear" if JS is off — which is why React also
// supports the no-JS case differently.
// ---------------------------------------------------------------------------

export const slot = (id, fallback) => `<div id="slot-${id}" class="slot">${fallback}</div>`;

export const flushSlot = (id, html) =>
  `<template data-slot="${id}">${html}</template>` +
  `<script>window.__swap&&__swap(${JSON.stringify(id)})</script>`;

export const SWAP_RUNTIME = `<script>
window.__swap = function (id) {
  var tpl = document.querySelector('template[data-slot="' + id + '"]');
  var target = document.getElementById('slot-' + id);
  if (!tpl || !target) return;
  target.replaceWith(tpl.content);
  tpl.remove();
  performance.mark('slot:' + id);
};
</script>`;

// ---------------------------------------------------------------------------
// The ISR / full-route cache
//
// A Map from cache key to { html, renderedAt, revalidate, refreshing }. The behaviour is
// exactly stale-while-revalidate, and deliberately so: it is the same idea as the HTTP header,
// implemented on the server instead of in the browser.
// ---------------------------------------------------------------------------

export const routeCache = new Map();
export const cacheStats = { hits: 0, misses: 0, staleServed: 0, revalidations: 0 };

export function invalidate(prefix = '') {
  let n = 0;
  for (const key of [...routeCache.keys()]) {
    if (key.startsWith(prefix)) { routeCache.delete(key); n++; }
  }
  return n;
}

async function cachedRender(key, revalidateSec, produce) {
  const entry = routeCache.get(key);
  const now = Date.now();

  if (entry) {
    const ageSec = (now - entry.renderedAt) / 1000;
    if (revalidateSec === Infinity || ageSec < revalidateSec) {
      cacheStats.hits++;
      return { html: entry.html, state: 'HIT', ageSec };
    }
    // Stale: serve it and refresh in the background, once.
    cacheStats.staleServed++;
    if (!entry.refreshing) {
      entry.refreshing = true;
      cacheStats.revalidations++;
      produce().then((html) => {
        routeCache.set(key, { html, renderedAt: Date.now(), refreshing: false });
      }).catch(() => { entry.refreshing = false; });
    }
    return { html: entry.html, state: 'STALE', ageSec };
  }

  cacheStats.misses++;
  const html = await produce();
  routeCache.set(key, { html, renderedAt: Date.now(), refreshing: false });
  return { html, state: 'MISS', ageSec: 0 };
}

// ---------------------------------------------------------------------------
// The renderers
// ---------------------------------------------------------------------------

/**
 * Per-request timing, emitted as a `Server-Timing` header.
 *
 * This is the right tool for exactly this job: the browser exposes it on the
 * PerformanceResourceTiming entry (`entry.serverTiming`), so a page — or your RUM — can see the
 * server's internal breakdown without you inventing a side channel. It is also the only way to
 * explain a slow TTFB to a frontend engineer without giving them log access.
 */
function tracker() {
  const marks = [];
  return {
    marks,
    async track(name, promise) {
      const t0 = performance.now();
      const value = await promise;
      marks.push({ name, dur: performance.now() - t0, at: t0 });
      return value;
    },
    header(totalMs) {
      const parts = marks.map((m) => `${m.name};dur=${m.dur.toFixed(1)}`);
      parts.push(`total;dur=${totalMs.toFixed(1)}`);
      return parts.join(', ');
    },
  };
}

/**
 * `?repeat=N` renders the listing N times. Island count, and therefore hydration cost, is the
 * variable the hydration course needs to sweep — 12 islands tells you nothing, 240 does.
 */
/**
 * `?meta=full` adds the metadata a crawler and a social scraper actually read. Off by default so
 * the SEO course has a realistic "before" to fix — a page with a title and nothing else is the
 * normal starting point, not a strawman.
 */
export function metaTags({ route, id, query, product }) {
  if (query?.get?.('meta') !== 'full') return '';
  const base = 'http://localhost:8080';
  const url = route === 'product' ? `${base}/render/ssr-par/product/${id}` : `${base}/render/ssr-par/`;
  const title = product ? `${product.name} — Cloudstore` : 'Products — Cloudstore';
  const desc = product
    ? `Buy the ${product.name} for £${product.price}. ${product.rating} stars, ${product.stock} in stock.`
    : 'Every product in the Cloudstore catalogue, with prices and availability.';

  return `<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="${route === 'product' ? 'product' : 'website'}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${base}/api/image.svg?name=og&w=1200&h=630&label=${encodeURIComponent(title)}">
<meta name="twitter:card" content="summary_large_image">
${product ? `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: desc,
    sku: `SKU-${product.id}`,
    offers: {
      '@type': 'Offer',
      price: product.price,
      priceCurrency: 'GBP',
      availability: product.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url,
    },
    aggregateRating: { '@type': 'AggregateRating', ratingValue: product.rating, reviewCount: 6 },
  }).replace(/</g, '\\u003c')}</script>` : ''}`;
}

function repeated(html, query) {
  const n = Math.max(1, Math.min(Number(query?.get?.('repeat') || 1), 40));
  return n === 1 ? html : Array.from({ length: n }, () => html).join('');
}

const bootstrapCSR = (route) =>
  `<script type="module" src="/shared/app/client.js" data-render="${route}"></script>`;

const bootstrapIslands = () =>
  `<script type="module" src="/shared/app/islands.js"></script>`;

/** csr: a shell plus JS. Nothing meaningful in the HTML. */
function renderCSR({ route, id }) {
  return shell({
    title: 'Cloudstore (CSR)',
    mode: 'csr',
    body: skeleton('page', 6),
    bootstrap: bootstrapCSR(route === 'product' ? `product:${id}` : 'listing'),
  });
}

/** ssr: render everything on the server, sequentially. The naive server waterfall. */
async function renderSSRSequential({ route, id, query, t = tracker() }) {
  if (route === 'listing') {
    const products = await t.track('products', getProducts());
    return shell({
      title: 'Products (SSR)', mode: 'ssr',
      body: repeated(listingHTML(products), query),
      bootstrap: bootstrapIslands(),
    });
  }
  // Sequential on purpose: three awaits in a row with no data dependency between them.
  const product = await t.track('product', getProduct(id));
  const recommends = await t.track('recommends', getRecommends(id));
  const reviews = await t.track('reviews', getReviews(id));
  return shell({
    title: `${product.name} (SSR)`,
    mode: 'ssr',
    body: productHTML(product) + recommendsHTML(recommends) + reviewsHTML(reviews),
    bootstrap: bootstrapIslands(),
  });
}

/** ssr-par: identical output, data fetched concurrently. */
async function renderSSRParallel({ route, id, query, t = tracker() }) {
  if (route === 'listing') {
    const products = await t.track('products', getProducts());
    return shell({
      title: query?.get?.('meta') === 'full' ? 'Products — Cloudstore' : 'Products (SSR parallel)',
      mode: 'ssr-par',
      head: metaTags({ route: 'listing', query }),
      body: repeated(listingHTML(products), query),
      bootstrap: bootstrapIslands(),
    });
  }
  const [product, recommends, reviews] = await Promise.all([
    t.track('product', getProduct(id)),
    t.track('recommends', getRecommends(id)),
    t.track('reviews', getReviews(id)),
  ]);
  return shell({
    title: query?.get?.('meta') === 'full' ? `${product.name} — Cloudstore` : `${product.name} (SSR parallel)`,
    mode: 'ssr-par',
    head: metaTags({ route: 'product', id, query, product }),
    body: productHTML(product) + recommendsHTML(recommends) + reviewsHTML(reviews),
    bootstrap: bootstrapIslands(),
  });
}

/** stream: flush the shell immediately, then each slow section as it resolves. */
function renderStream({ route, id }, res) {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    // Without this, a proxy (or Nginx's default buffering) will hold your chunks and you will
    // wonder why streaming does nothing in production.
    'x-accel-buffering': 'no',
    'transfer-encoding': 'chunked',
  });

  const isListing = route === 'listing';
  const head = SWAP_RUNTIME;

  // 1. The shell goes out NOW — before any data call has finished.
  const openHtml = shell({
    title: 'Streaming',
    mode: 'stream',
    head,
    body: '@@BODY@@',
    bootstrap: bootstrapIslands(),
  });
  const [beforeBody, afterBody] = openHtml.split('@@BODY@@');

  res.write(beforeBody);
  res.write(isListing ? slot('products', skeleton('products', 6))
    : slot('product', skeleton('product', 4)) +
      slot('recommends', skeleton('recommendations', 2)) +
      slot('reviews', skeleton('reviews', 4)));

  const pending = [];
  const fill = (name, promise, toHtml) => pending.push(
    promise.then((data) => res.write(flushSlot(name, toHtml(data)))),
  );

  if (isListing) {
    fill('products', getProducts(), listingHTML);
  } else {
    // All three start together; each flushes the moment it is ready, in completion order.
    fill('product', getProduct(id), productHTML);
    fill('recommends', getRecommends(id), recommendsHTML);
    fill('reviews', getReviews(id), reviewsHTML);
  }

  Promise.allSettled(pending).then(() => {
    res.write(afterBody);
    res.end();
  });
}

/** rsc: the server sends a serialised tree; the client renders it. No HTML for the content. */
async function renderRSC({ route, id }) {
  const payload = route === 'listing'
    ? { type: 'listing', products: await getProducts() }
    : {
      type: 'product',
      ...Object.fromEntries(await Promise.all([
        getProduct(id).then((v) => ['product', v]),
        getRecommends(id).then((v) => ['recommends', v]),
        getReviews(id).then((v) => ['reviews', v]),
      ])),
    };
  return shell({
    title: 'RSC-ish',
    mode: 'rsc',
    body: skeleton('page', 4),
    head: `<script id="flight" type="application/json">${JSON.stringify(payload).replace(/</g, '\\u003c')}</script>`,
    bootstrap: `<script type="module" src="/shared/app/rsc-client.js"></script>`,
  });
}

// ---------------------------------------------------------------------------
// Entry point used by server.mjs
// ---------------------------------------------------------------------------

export async function renderRoute({ mode, route, id, query }, res) {
  const t0 = performance.now();
  const t = tracker();

  const send = (html, extraHeaders = {}) => {
    const totalMs = performance.now() - t0;
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': query.get('cc') || 'no-store',
      'x-render-ms': totalMs.toFixed(1),
      'x-data-calls': JSON.stringify(calls),
      // Readable from the page via PerformanceResourceTiming.serverTiming.
      'server-timing': t.header(totalMs),
      'timing-allow-origin': '*',
      ...extraHeaders,
    });
    res.end(html);
  };

  switch (mode) {
    case 'csr':
      return send(renderCSR({ route, id }));

    case 'ssr':
      return send(await renderSSRSequential({ route, id, query, t }));

    case 'ssr-par':
      return send(await renderSSRParallel({ route, id, query, t }));

    case 'ssg': {
      // "Build time" = the first request. Cached forever after that.
      const { html, state, ageSec } = await cachedRender(
        `ssg:${route}:${id ?? ''}`, Infinity,
        () => renderSSRParallel({ route, id, query }),
      );
      return send(html, { 'x-cache': state, 'x-age': Math.round(ageSec) });
    }

    case 'isr': {
      const revalidate = Number(query.get('revalidate') || 10);
      const { html, state, ageSec } = await cachedRender(
        `isr:${route}:${id ?? ''}`, revalidate,
        () => renderSSRParallel({ route, id, query }),
      );
      return send(html, {
        'x-cache': state,
        'x-age': Math.round(ageSec),
        'x-revalidate': String(revalidate),
      });
    }

    case 'stream':
      return renderStream({ route, id }, res);

    case 'rsc':
      return send(await renderRSC({ route, id }));

    default:
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end(`unknown render mode "${mode}"\n`);
  }
}

export const MODES = ['csr', 'ssr', 'ssr-par', 'ssg', 'isr', 'stream', 'rsc'];
