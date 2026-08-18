/**
 * export async function get(redis, key, fetchFromOrigin) -> the value
 *
 * `redis` is an ioredis client. `fetchFromOrigin()` is the expensive thing — it takes 200ms and
 * the drill counts how many times you call it.
 *
 * The naive version below is CORRECT and calls the origin 500 times. Fix it.
 *
 * Useful commands:
 *   redis.set(k, v, 'EX', seconds)
 *   redis.set(k, v, 'NX', 'PX', ms)     -> 'OK' if it was set, null if the key already existed
 *   redis.eval(script, numKeys, ...args)
 */
export async function get(redis, key, fetchFromOrigin) {
  const hit = await redis.get(key);
  if (hit) return JSON.parse(hit);

  const value = await fetchFromOrigin();
  await redis.set(key, JSON.stringify(value), 'EX', 30);
  return value;
}
