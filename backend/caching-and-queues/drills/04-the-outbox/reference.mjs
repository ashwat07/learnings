/**
 * THE TRANSACTIONAL OUTBOX. Do not talk to the broker at all inside the transaction — write the
 * event to a table in the SAME database, in the SAME transaction as the business change.
 *
 * Now the two writes are one atomic write. If the transaction commits, the event exists. If it
 * rolls back, so does the event. There is no window in which one exists without the other, and no
 * dependency on the broker being up at the moment of the write.
 *
 * A SEPARATE PROCESS then reads unpublished rows and publishes them, marking published_at on
 * success — retrying forever until the broker accepts. That relay gives you AT-LEAST-ONCE
 * delivery, which is exactly what drill 03 taught you to consume safely:
 *
 *   SELECT * FROM drill_outbox WHERE published_at IS NULL
 *   ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 100;      -- postgres lab 06
 *
 * (Or let change-data-capture do the reading — Debezium tailing the WAL is the same pattern with
 * no polling.)
 *
 * The rule this encodes: NEVER DO I/O INSIDE A TRANSACTION, and never write to two systems and
 * hope. Write to one, and let something else propagate.
 */
export async function createOrder(tx, order, broker) {
  await tx`INSERT INTO drill_orders (id, total) VALUES (${order.id}, ${order.total})`;
  await tx`INSERT INTO drill_outbox (order_id, payload)
           VALUES (${order.id}, ${tx.json({ orderId: order.id, total: order.total })})`;
  void broker;                      // deliberately unused: the relay publishes, not us
}
