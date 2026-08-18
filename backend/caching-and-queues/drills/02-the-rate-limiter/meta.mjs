import { redis, newRedis, concurrently } from '../../../lib/redis.mjs';

export const title = 'A rate limiter that actually limits';
export const task = `Allow at most 100 requests per user per 10-second window. 500 requests arrive
simultaneously from 25 different connections.

The obvious GET-then-INCR implementation lets far more than 100 through, because 500 clients read
the same count before any of them writes.`;
export const passIf = 'EXACTLY 100 allowed out of 500, under full concurrency, in one round trip';

export async function check(solution) {
  if (typeof solution.allow !== 'function') return [{ check: 'exports allow(redis, key, limit, windowMs)', actual: 'missing', pass: false }];

  const clients = Array.from({ length: 25 }, () => newRedis());
  const KEY = 'drill:rl:user:1';

  const { results } = await concurrently(500, (i) =>
    solution.allow(clients[i % clients.length], KEY, 100, 10_000).catch(() => 'error'));
  const allowed = results.filter((r) => r === true).length;
  const errors = results.filter((r) => r === 'error').length;

  // A second user must be unaffected — proves the key is actually per-subject.
  const other = await solution.allow(clients[0], 'drill:rl:user:2', 100, 10_000).catch(() => 'error');

  // The window must expire, or you have built a lifetime quota rather than a rate limit.
  const ttl = await redis.pttl(KEY);
  for (const c of clients) await c.quit();

  return [
    { check: 'exactly 100 allowed', actual: `${allowed} allowed, ${500 - allowed - errors} denied`, pass: allowed === 100 },
    { check: 'no errors', actual: errors, pass: errors === 0 },
    { check: 'a different user is unaffected', actual: String(other), pass: other === true },
    { check: 'the window expires (TTL is set)', actual: ttl > 0 ? `${ttl}ms` : 'NO TTL — this is a lifetime quota', pass: ttl > 0 && ttl <= 10_000 },
  ];
}
