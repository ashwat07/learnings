/**
 * SET NX gives you the lock. The PX lease means a crashed holder cannot wedge the key forever.
 * The losers poll briefly rather than each calling the origin.
 */
export async function get(redis, key, fetchFromOrigin) {
  const hit = await redis.get(key);
  if (hit) return JSON.parse(hit);

  const token = crypto.randomUUID();
  const won = await redis.set(`${key}:lock`, token, 'NX', 'PX', 5000);

  if (won) {
    try {
      const value = await fetchFromOrigin();
      await redis.set(key, JSON.stringify(value), 'EX', 30);
      return value;
    } finally {
      // Compare-and-delete, atomically: a plain DEL can delete a lock your lease already lost.
      await redis.eval(
        `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
        1, `${key}:lock`, token);
    }
  }

  // A loser. Wait for the winner — with a BOUND, so a dead holder cannot hang us forever.
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 15));
    const v = await redis.get(key);
    if (v) return JSON.parse(v);
  }
  return fetchFromOrigin();          // last resort; should be vanishingly rare
}
