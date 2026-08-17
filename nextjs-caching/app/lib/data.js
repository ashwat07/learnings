import { cache } from 'react';

/**
 * The data source is the repo's lab server on :8080 — an EXTERNAL API, which is the realistic
 * shape (a Next app fetches from an API, it does not usually fetch itself). It also means the
 * counters live outside Next's process, so they cannot be confused with anything Next is doing.
 *
 *   GET /api/asset?name=X&type=json&delay=300&cc=no-store
 *        → { name, version, servedAt, serverHits }
 *   GET /api/stats   → hit counts per asset
 *   GET /api/reset   → zero them
 *
 * `serverHits` is the number that matters: if a page renders and it does not move, something
 * cached.
 *
 * NOTE: ./serve.sh must be running before `next build`, because a build that pre-renders pages
 * has to fetch their data. That is not a quirk of this lab — it is what "static generation"
 * means, and it is why build-time data sources have to be available at build time.
 */
export const API = process.env.LAB_API ?? 'http://localhost:8080';

export const url = (key, delay = 300) =>
  `${API}/api/asset?name=next-${key}&type=json&delay=${delay}&cc=no-store`;

/** A plain fetch: deduplicated within one render pass by React's request memoization. */
export async function getData(key, init = {}) {
  const res = await fetch(url(key), init);
  return res.json();
}

/** React's cache(): the same deduplication for something that is not a fetch. */
export const getComputed = cache(async (key) => {
  const res = await fetch(url(`${key}-computed`, 200), { cache: 'no-store' });
  const data = await res.json();
  return { ...data, computedAt: new Date().toISOString() };
});
