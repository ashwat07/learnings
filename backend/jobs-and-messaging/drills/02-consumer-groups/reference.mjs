/**
 * Two halves, and skipping either loses messages:
 *
 * 1. ACKNOWLEDGE AFTER PROCESSING, NOT BEFORE. Between delivery and XACK the message sits in the
 *    group's PENDING ENTRIES LIST (PEL) with the name of the consumer holding it. That list is the
 *    entire safety net: if you ack first and then crash, the message is gone forever.
 *
 * 2. RECLAIM WHAT A DEAD CONSUMER HOLDS. Nothing tells Redis that worker-2's process died — the
 *    messages simply sit in the PEL getting older. XAUTOCLAIM takes ownership of anything idle
 *    longer than a threshold. That threshold is the same idea as an SQS VISIBILITY TIMEOUT and a
 *    Kafka session timeout: "if you have not finished by now, I assume you are gone".
 *
 * Pick it carefully. Too short and you double-process slow jobs; too long and a crash stalls the
 * queue. And because a reclaim CAN double-process (the original worker might not be dead, just
 * slow), the consumer must be IDEMPOTENT — which is exactly caching drill 03. At-least-once
 * delivery plus an idempotent consumer is the only "exactly once" that exists.
 *
 * The other properties worth knowing, since they generalise to every broker:
 *   · ORDERING is per stream/partition, not global. One consumer per partition preserves order;
 *     scaling out past the partition count does not increase parallelism.
 *   · A message whose delivery count keeps climbing is poison — check XPENDING's delivery counter
 *     and route it to a dead-letter stream (drill 01).
 */
const CLAIM_AFTER_MS = 400;

export async function consume(redis, stream, group, consumer, handler) {
  let handled = 0;

  // First, take over anything a dead or stalled consumer is still holding.
  const [, claimed] = await redis.xautoclaim(stream, group, consumer, CLAIM_AFTER_MS, '0', 'COUNT', 10);
  handled += await process(claimed);

  // Then read messages nobody in the group has seen.
  const res = await redis.xreadgroup('GROUP', group, consumer, 'COUNT', 10, 'STREAMS', stream, '>');
  if (res) handled += await process(res[0][1]);

  return handled;

  async function process(entries) {
    if (!entries?.length) return 0;
    const ids = [];
    for (const [id, fields] of entries) {
      if (!fields) continue;                         // a tombstone from a trimmed stream
      const msg = { streamId: id };
      for (let i = 0; i < fields.length; i += 2) msg[fields[i]] = fields[i + 1];
      await handler(msg);
      ids.push(id);
    }
    if (ids.length) await redis.xack(stream, group, ...ids);   // ACK only after the work is done
    return ids.length;
  }
}
