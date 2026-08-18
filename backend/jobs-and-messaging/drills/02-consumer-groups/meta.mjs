import { redis, newRedis, sleep } from '../../../lib/redis.mjs';

export const title = 'A broker, and the worker that dies holding a message';
export const task = `A stream has 60 messages and a consumer group with 3 workers. Worker 2 CRASHES
after reading 5 messages without acknowledging them.

Write consume(redis, stream, group, consumer) that reads a batch, processes it, and acknowledges —
and RECOVERS the messages a dead worker is still holding. This is the mechanism behind Kafka
consumer groups, SQS visibility timeouts and RabbitMQ acks; Redis Streams is the smallest thing
that has all of it.`;
export const passIf = 'all 60 messages processed exactly once, including the 5 the dead worker was holding';

const STREAM = 'drill:stream:orders';
const GROUP = 'workers';

export async function check(s) {
  if (typeof s.consume !== 'function') return [{ check: 'exports consume(redis, stream, group, consumer)', actual: 'missing', pass: false }];

  await redis.del(STREAM);
  try { await redis.xgroup('CREATE', STREAM, GROUP, '0', 'MKSTREAM'); } catch { /* exists */ }
  for (let i = 1; i <= 60; i++) await redis.xadd(STREAM, '*', 'id', String(i));

  const processed = [];
  const handler = async (msg) => { processed.push(msg.id); };

  // Worker 2 reads a batch and then "crashes": it never acknowledges.
  const dead = newRedis();
  const stolen = await dead.xreadgroup('GROUP', GROUP, 'worker-2', 'COUNT', 5, 'STREAMS', STREAM, '>');
  const heldByDead = (stolen?.[0]?.[1] ?? []).map(([, f]) => f[1]);
  await dead.quit();                                   // the process is gone; the messages are not

  const clients = [newRedis(), newRedis()];
  const t0 = Date.now();
  // Two healthy workers drain the stream, and must eventually reclaim what worker 2 held.
  while (Date.now() - t0 < 10_000 && processed.length < 60) {
    let moved = 0;
    for (const [i, c] of clients.entries()) {
      moved += (await s.consume(c, STREAM, GROUP, `worker-${i + 3}`, handler)) ?? 0;
    }
    if (moved === 0) await sleep(120);
  }
  for (const c of clients) await c.quit();

  const unique = new Set(processed);
  const pending = await redis.xpending(STREAM, GROUP);
  const recovered = heldByDead.filter((id) => unique.has(id));
  await redis.del(STREAM);

  return [
    { check: 'all 60 messages processed', actual: unique.size, pass: unique.size === 60 },
    { check: "the dead worker's 5 were recovered", actual: `${recovered.length}/5`, pass: recovered.length === 5 },
    { check: 'nothing processed twice', actual: processed.length === unique.size ? 'no duplicates' : `${processed.length - unique.size} duplicates`, pass: processed.length === unique.size },
    { check: 'nothing left pending (all acknowledged)', actual: pending?.[0] ?? 0, pass: Number(pending?.[0] ?? 0) === 0 },
  ];
}
