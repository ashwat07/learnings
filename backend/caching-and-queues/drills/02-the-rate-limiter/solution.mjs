/**
 * export async function allow(redis, key, limit, windowMs) -> boolean
 *
 * The broken version below reads the counter, decides, then writes — and 500 concurrent callers
 * all read the same value first. Fix the race.
 *
 * Two things to get right:
 *   · the decision and the increment must be ATOMIC
 *   · the key must EXPIRE, or you have built a lifetime quota
 *
 * Useful:
 *   redis.incr(k)                    atomic, returns the new value
 *   redis.pexpire(k, ms)
 *   redis.eval(script, 1, key, arg)  Lua runs atomically on the server
 */
export async function allow(redis, key, limit, windowMs) {
  const current = Number(await redis.get(key)) || 0;
  if (current >= limit) return false;
  await redis.set(key, current + 1, 'PX', windowMs);
  return true;
}
