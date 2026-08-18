/**
 * One Lua script = one atomic round trip. INCR is atomic on its own, but "increment AND set the
 * TTL only on the first hit" is two commands, and doing them separately leaves a window where a
 * crash between them creates a key with no expiry — a counter that never resets.
 *
 * Note the check is on the value AFTER incrementing: over-limit requests still increment, which is
 * what makes the limiter's own counter honest and is how you can report "N requests rejected".
 * If you prefer not to count rejects, decrement when over — but then two clients can race back
 * under the limit.
 */
const SCRIPT = `
  local current = redis.call("INCR", KEYS[1])
  if current == 1 then
    redis.call("PEXPIRE", KEYS[1], ARGV[2])
  end
  if current > tonumber(ARGV[1]) then return 0 end
  return 1
`;

export async function allow(redis, key, limit, windowMs) {
  const ok = await redis.eval(SCRIPT, 1, key, limit, windowMs);
  return ok === 1;
}
