/**
 * The Redis handle and the helpers the caching/queue labs share.
 *
 * Everything here is deliberately small enough to read. The interesting parts of this course are
 * the ATOMICITY arguments, and you cannot follow those unless you can see exactly which commands
 * are issued and in what order.
 */

import Redis from 'ioredis';

const opts = {
  host: process.env.REDISHOST ?? 'localhost',
  port: Number(process.env.REDISPORT ?? 6380),
  maxRetriesPerRequest: 2,
};

export const redis = new Redis(opts);

/** A fresh connection — needed whenever a lab wants genuinely concurrent clients. */
export const newRedis = () => new Redis(opts);

/**
 * A counter for "how many times did the expensive thing actually run".
 * Every drill in this course is scored on this number.
 */
export function makeOrigin({ latencyMs = 120 } = {}) {
  let calls = 0;
  return {
    get calls() { return calls; },
    reset() { calls = 0; },
    async fetch(key) {
      calls++;
      await new Promise((r) => setTimeout(r, latencyMs));
      return { key, value: `value-for-${key}`, generatedAt: Date.now() };
    },
  };
}

/** Run n copies of fn at the same time and report how long the slowest took. */
export async function concurrently(n, fn) {
  const t0 = performance.now();
  const results = await Promise.all(Array.from({ length: n }, (_, i) => fn(i)));
  return { results, ms: performance.now() - t0 };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
