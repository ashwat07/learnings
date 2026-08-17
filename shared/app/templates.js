/**
 * templates.js — the markup, shared by the server renderer and every client renderer.
 *
 * Deliberately isomorphic and dependency-free: the same functions produce the HTML whether
 * they run in Node during SSR or in the browser during CSR. That is what makes the strategy
 * comparison fair — the output is identical, so the only variable is *where and when* it was
 * produced.
 */

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const skeleton = (label, lines = 3) =>
  `<div class="skeleton" aria-busy="true" aria-label="${esc(label)} loading">` +
  Array.from({ length: lines }, () => '<span></span>').join('') + '</div>';

export function listingHTML(products, version = 1) {
  return `<h1>Products <small>v${version}</small></h1>
<ul class="grid">${products.map((p) => `<li class="card">
  <a href="./product/${p.id}"><h3>${esc(p.name)}</h3></a>
  <div class="price">£${p.price}</div>
  <div class="meta">${p.rating}★ · ${p.stock} in stock</div>
  <p>${esc(p.blurb)}</p>
  <button class="add" data-island="add-to-cart" data-id="${p.id}">add to cart</button>
</li>`).join('')}</ul>`;
}

export function productHTML(product, version = 1) {
  return `<article class="product">
  <h1>${esc(product.name)} <small>v${version}</small></h1>
  <div class="price">£${product.price}</div>
  <div class="meta">${product.rating}★ · ${product.stock} in stock</div>
  <p>${esc(product.description)}</p>
  <table class="specs">${product.specs.map((s) =>
    `<tr><th>${esc(s.key)}</th><td>${esc(s.value)}</td></tr>`).join('')}</table>
  <button class="add" data-island="add-to-cart" data-id="${product.id}">add to cart</button>
</article>`;
}

export const recommendsHTML = (items) => `<section class="recommends"><h2>You may also like</h2>
<ul class="grid small">${items.map((r) =>
    `<li class="card"><h3>${esc(r.name)}</h3><div class="price">£${r.price}</div></li>`).join('')}</ul></section>`;

export const reviewsHTML = (reviews) => `<section class="reviews"><h2>Reviews</h2>
${reviews.map((r) => `<article class="review"><b>${esc(r.author)}</b> ${'★'.repeat(r.stars)}
<p>${esc(r.body)}</p></article>`).join('')}</section>`;
