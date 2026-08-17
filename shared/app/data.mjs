/**
 * data.mjs — the "backend" for the rendering labs.
 *
 * Four data functions with deliberately different latencies, because the whole argument about
 * rendering strategies is an argument about *where you wait*:
 *
 *   getProducts      300ms   — needed for the listing shell
 *   getProduct       200ms   — needed above the fold
 *   getRecommends    600ms   — below the fold, nobody is waiting for it
 *   getReviews       900ms   — below the fold, slow, and the reason streaming exists
 *
 * Every function counts its calls, so a lab can prove things like "request memoisation
 * deduplicated these four calls into one".
 */

export const latency = {
  products: 300,
  product: 200,
  recommends: 600,
  reviews: 900,
};

export const calls = { products: 0, product: 0, recommends: 0, reviews: 0 };
export const resetCalls = () => { for (const k of Object.keys(calls)) calls[k] = 0; };

/** A content version, bumped by /api/bump?name=catalogue, so staleness is observable. */
export const version = { n: 1, at: new Date() };
export const bumpVersion = () => { version.n++; version.at = new Date(); return version.n; };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NAMES = ['Nimbus', 'Cirrus', 'Stratus', 'Altocumulus', 'Lenticular', 'Mammatus',
  'Noctilucent', 'Cumulonimbus', 'Fractus', 'Pileus', 'Virga', 'Asperitas'];
const ADJ = ['9', 'Pro', 'Lite', 'Max', 'Air', 'Studio'];

/** Deterministic pseudo-random so every render of version N is byte-identical. */
const hash = (n) => ((n * 2654435761) % 4294967296) / 4294967296;

export async function getProducts({ delay = latency.products } = {}) {
  calls.products++;
  await sleep(delay);
  return Array.from({ length: 12 }, (_, i) => ({
    id: i + 1,
    name: `${NAMES[i % NAMES.length]} ${ADJ[i % ADJ.length]}`,
    price: Math.round(80 + hash(i + version.n) * 400),
    rating: +(3 + hash(i * 7 + version.n) * 2).toFixed(1),
    stock: Math.round(hash(i * 13 + version.n) * 40),
    blurb: `A deliberately ordinary product, generated at version ${version.n}.`,
  }));
}

export async function getProduct(id, { delay = latency.product } = {}) {
  calls.product++;
  await sleep(delay);
  const i = Number(id) - 1;
  return {
    id: Number(id),
    name: `${NAMES[i % NAMES.length]} ${ADJ[i % ADJ.length]}`,
    price: Math.round(80 + hash(i + version.n) * 400),
    rating: +(3 + hash(i * 7 + version.n) * 2).toFixed(1),
    stock: Math.round(hash(i * 13 + version.n) * 40),
    description: `Version ${version.n}. ${'Long-form marketing copy that exists to give the page some weight. '.repeat(4)}`,
    specs: Array.from({ length: 8 }, (_, k) => ({
      key: ['weight', 'height', 'depth', 'colour', 'material', 'warranty', 'origin', 'sku'][k],
      value: `${Math.round(hash(i * 31 + k) * 100)}`,
    })),
  };
}

export async function getRecommends(id, { delay = latency.recommends } = {}) {
  calls.recommends++;
  await sleep(delay);
  return Array.from({ length: 4 }, (_, k) => {
    const j = (Number(id) + k * 3) % NAMES.length;
    return { id: j + 1, name: `${NAMES[j]} ${ADJ[j % ADJ.length]}`, price: Math.round(80 + hash(j) * 400) };
  });
}

export async function getReviews(id, { delay = latency.reviews } = {}) {
  calls.reviews++;
  await sleep(delay);
  return Array.from({ length: 6 }, (_, k) => ({
    id: k + 1,
    author: ['ada', 'grace', 'alan', 'radia', 'barbara', 'edsger'][k],
    stars: 1 + Math.round(hash(Number(id) * 17 + k) * 4),
    body: `Review ${k + 1} of product ${id}. ${'It arrived. '.repeat(3 + k)}`,
  }));
}
