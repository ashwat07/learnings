/**
 * client.js — the CSR renderer.
 *
 * The HTML this runs in contains a skeleton and nothing else. Everything visible is produced
 * here, which means: nothing paints until this module is fetched, parsed and executed, and the
 * data requests do not even *start* until then.
 *
 * That is the whole cost of client-side rendering, and it is a chain, not a constant:
 *   HTML → JS → data → paint
 */

import { listingHTML, productHTML, recommendsHTML, reviewsHTML } from './templates.js';

// This renderer creates the DOM itself, so islands must not auto-hydrate on import — there is
// nothing to hydrate yet.
globalThis.__noAutoHydrate = true;
const { hydrateIslands } = await import('./islands.js');

const script = document.querySelector('script[data-render]');
const spec = script?.dataset.render ?? 'listing';
const root = document.getElementById('root');

performance.mark('csr:start');

async function json(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

async function main() {
  if (spec === 'listing') {
    const { products, version } = await json('/api/data/products');
    root.innerHTML = listingHTML(products, version);
  } else {
    const id = spec.split(':')[1];
    // Three requests, started together. Note what CSR cannot avoid: they could not start until
    // this file had downloaded and run.
    const [product, recommends, reviews] = await Promise.all([
      json(`/api/data/product/${id}`),
      json(`/api/data/recommends/${id}`),
      json(`/api/data/reviews/${id}`),
    ]);
    root.innerHTML =
      productHTML(product.product, product.version) +
      recommendsHTML(recommends.recommends) +
      reviewsHTML(reviews.reviews);
  }

  performance.mark('csr:rendered');
  performance.measure('js:csr-render', 'csr:start', 'csr:rendered');
  hydrateIslands(root);
}

main().catch((err) => {
  root.innerHTML = `<p style="color:#ff6b6b">CSR failed: ${err.message}</p>`;
});
