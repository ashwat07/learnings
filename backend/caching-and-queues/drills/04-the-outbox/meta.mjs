import { sql } from '../../../lib/db.mjs';

export const title = 'The dual-write problem';
export const task = `An order is created in Postgres and an event must be published to a broker.
Doing both directly is a DUAL WRITE: if the publish fails you have an order nobody hears about, and
if the transaction rolls back after publishing you have announced an order that does not exist.

Make it impossible to have one without the other. The broker in this drill fails 50% of the time
and the transaction rolls back 25% of the time.`;
export const passIf = 'for every committed order there is exactly one pending/published event, and none for rolled-back ones';

export async function check(solution) {
  if (typeof solution.createOrder !== 'function') return [{ check: 'exports createOrder(tx, order, broker)', actual: 'missing', pass: false }];

  await sql.unsafe(`DROP TABLE IF EXISTS drill_orders, drill_outbox`);
  await sql.unsafe(`CREATE TABLE drill_orders (id text PRIMARY KEY, total int NOT NULL)`);
  await sql.unsafe(`CREATE TABLE drill_outbox (id bigserial PRIMARY KEY, order_id text NOT NULL,
                                               payload jsonb NOT NULL, published_at timestamptz)`);

  const published = [];
  const broker = { publish: async (e) => { if (Math.random() < 0.5) throw new Error('broker unavailable'); published.push(e); } };

  let committed = 0;
  for (let i = 0; i < 40; i++) {
    const order = { id: `o-${i}`, total: 100 };
    const rollback = i % 4 === 0;                    // 25% of callers fail AFTER the write
    try {
      await sql.begin(async (tx) => {
        await solution.createOrder(tx, order, broker);
        if (rollback) throw new Error('validation failed after the write');
      });
      committed++;
    } catch { /* rolled back */ }
  }

  const orders = await sql`SELECT id FROM drill_orders ORDER BY id`;
  const outbox = await sql`SELECT order_id, count(*)::int AS n FROM drill_outbox GROUP BY order_id`;
  const orderIds = new Set(orders.map((o) => o.id));
  const outboxIds = new Set(outbox.map((o) => o.order_id));

  const orphanEvents = [...outboxIds].filter((id) => !orderIds.has(id));
  const missingEvents = [...orderIds].filter((id) => !outboxIds.has(id));
  const duplicated = outbox.filter((o) => o.n > 1);
  // Anything published DIRECTLY from inside the transaction is a dual write, and some of those
  // announcements are for orders that no longer exist.
  const publishedOrphans = published.filter((e) => !orderIds.has(e.orderId ?? e.order_id));

  await sql.unsafe(`DROP TABLE IF EXISTS drill_orders, drill_outbox`);
  return [
    { check: 'every committed order has an event', actual: missingEvents.length ? `${missingEvents.length} missing` : 'all present', pass: missingEvents.length === 0 && orderIds.size === committed },
    { check: 'no event for a rolled-back order', actual: orphanEvents.length ? `${orphanEvents.length} orphaned` : 'none', pass: orphanEvents.length === 0 },
    { check: 'no duplicate events', actual: duplicated.length ? `${duplicated.length} duplicated` : 'none', pass: duplicated.length === 0 },
    { check: 'nothing announced for a non-existent order', actual: publishedOrphans.length ? `${publishedOrphans.length} phantom announcements` : 'none', pass: publishedOrphans.length === 0 },
  ];
}
