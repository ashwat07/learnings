/**
 * export async function createOrder(tx, order, broker) -> void
 *
 * `tx` is a postgres.js transaction. `broker.publish(event)` FAILS 50% OF THE TIME, and 25% of
 * callers throw AFTER you return (so the transaction rolls back).
 *
 * Tables:
 *   drill_orders (id, total)
 *   drill_outbox (id, order_id, payload jsonb, published_at)
 *
 * The version below is the DUAL WRITE. It fails in both directions — a broker error loses the
 * event, and a rollback leaves an announcement for an order that does not exist.
 *
 * Hint: what is the ONE thing in this system that is transactional?
 */
export async function createOrder(tx, order, broker) {
  await tx`INSERT INTO drill_orders (id, total) VALUES (${order.id}, ${order.total})`;
  await broker.publish({ orderId: order.id, total: order.total });
}
