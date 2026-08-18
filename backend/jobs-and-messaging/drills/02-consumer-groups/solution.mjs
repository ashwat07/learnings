/**
 * export async function consume(redis, stream, group, consumer, handler) -> number processed
 *
 * Call handler(msg) for each message, where msg is { id, ...fields }. Return how many you handled
 * (0 means "nothing to do"), and DO NOT loop internally — the runner calls you repeatedly.
 *
 * The version below reads new messages and processes them. It has two bugs, and the runner finds
 * both: it never ACKNOWLEDGES, and it never recovers the messages a dead consumer still holds.
 *
 * The commands you need:
 *   redis.xreadgroup('GROUP', group, consumer, 'COUNT', n, 'BLOCK', ms, 'STREAMS', stream, '>')
 *       '>' means "messages never delivered to this group"
 *   redis.xack(stream, group, ...ids)
 *   redis.xautoclaim(stream, group, consumer, minIdleMs, '0', 'COUNT', n)
 *       -> [nextCursor, [[id, fields], ...]]   messages idle longer than minIdleMs, now YOURS
 *
 * Use a SMALL minIdleMs here (a few hundred ms) or the drill will time out.
 */
export async function consume(redis, stream, group, consumer, handler) {
  const res = await redis.xreadgroup('GROUP', group, consumer, 'COUNT', 10, 'STREAMS', stream, '>');
  if (!res) return 0;
  const entries = res[0][1];
  for (const [id, fields] of entries) {
    const msg = { streamId: id };
    for (let i = 0; i < fields.length; i += 2) msg[fields[i]] = fields[i + 1];
    await handler(msg);
  }
  return entries.length;
}
