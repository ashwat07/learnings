import { redis, newRedis, makeOrigin, concurrently, sleep } from '../../../lib/redis.mjs';

export const title = 'Stop the stampede';
export const task = `500 requests arrive at once for a key that just expired. A naive cache-aside
sends 500 queries to the database. Get it to 1 — without any request waiting longer than the
origin takes.`;
export const passIf = 'origin called at most 2 times, all 500 get the right value, slowest < 900ms';

export async function check(solution) {
  if (typeof solution.get !== 'function') return [{ check: 'exports get(redis, key, origin)', actual: 'missing', pass: false }];

  const origin = makeOrigin({ latencyMs: 200 });
  const clients = Array.from({ length: 25 }, () => newRedis());
  const KEY = 'drill:cache:hot';

  const { results, ms } = await concurrently(500, (i) =>
    solution.get(clients[i % clients.length], KEY, () => origin.fetch(KEY)).catch((e) => ({ error: e.message })));
  await sleep(300);
  for (const c of clients) await c.quit();

  const errors = results.filter((r) => r?.error).length;
  const correct = results.filter((r) => r?.value === `value-for-${KEY}`).length;
  return [
    { check: 'origin called at most twice', actual: origin.calls, pass: origin.calls <= 2 && origin.calls >= 1 },
    { check: 'all 500 got the value', actual: `${correct}/500${errors ? ` (${errors} errored)` : ''}`, pass: correct === 500 },
    { check: 'slowest request under 900ms', actual: `${ms.toFixed(0)}ms`, pass: ms < 900 },
  ];
}
