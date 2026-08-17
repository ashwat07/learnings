/**
 * rsc-client.js — a deliberately small model of the React Server Components wire format.
 *
 * What is being modelled: the server does the data fetching and decides the component tree,
 * then sends a *serialised description of the result* rather than HTML. The client walks that
 * description and produces DOM.
 *
 * What that buys, and what it costs, is the whole point:
 *   ✓ the data-fetching code, its dependencies and its secrets never reach the client
 *   ✓ the payload is smaller than HTML for repetitive markup, and diffable on navigation
 *   ✗ nothing paints until this module has downloaded and run — the payload is not paintable
 *   ✗ you are shipping a renderer, so there is always some JS
 *
 * Real RSC differs in ways that matter: the payload streams (so the client can render the parts
 * that have arrived), it references client components by module id so they can be code-split
 * and hydrated individually, and the whole thing is designed to be merged into an existing tree
 * on navigation rather than replacing it. The shape here is the honest minimum.
 */

import { listingHTML, productHTML, recommendsHTML, reviewsHTML } from './templates.js';

globalThis.__noAutoHydrate = true;
const { hydrateIslands } = await import('./islands.js');

performance.mark('rsc:start');

const payload = JSON.parse(document.getElementById('flight').textContent);
const root = document.getElementById('root');

// "Rendering" the payload: in real RSC this is a tree walk over typed nodes, and client
// components are looked up in a module map and lazily imported. Here the node types are the
// four sections, which is enough to see the shape.
if (payload.type === 'listing') {
  root.innerHTML = listingHTML(payload.products, payload.version ?? 1);
} else {
  root.innerHTML =
    productHTML(payload.product, payload.version ?? 1) +
    recommendsHTML(payload.recommends) +
    reviewsHTML(payload.reviews);
}

performance.mark('rsc:rendered');
performance.measure('js:rsc-render', 'rsc:start', 'rsc:rendered');

// Only the islands are interactive, so only the islands cost anything to make interactive.
// That is the part of the RSC model worth internalising: server components have no client
// runtime at all, client components ("use client") do.
hydrateIslands(root, { cost: Number(new URLSearchParams(location.search).get('hydrationCost') || 0) });

// Show the payload size next to the equivalent HTML, since that trade-off is the argument.
const payloadBytes = document.getElementById('flight').textContent.length;
const htmlBytes = root.innerHTML.length;
const note = document.createElement('div');
note.className = 'badge';
note.style.margin = '18px';
note.textContent = `flight payload ${(payloadBytes / 1024).toFixed(1)}KB → rendered HTML ${(htmlBytes / 1024).toFixed(1)}KB`;
document.body.append(note);
