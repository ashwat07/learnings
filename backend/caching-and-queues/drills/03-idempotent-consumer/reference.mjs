/**
 * The dedup key and the side effect are written in the SAME TRANSACTION. That is the whole trick:
 * either both happen or neither does, so a crash between them cannot leave the message marked
 * processed with no ledger row.
 *
 * ON CONFLICT DO NOTHING + RETURNING gives you an ATOMIC claim: exactly one of the concurrent
 * workers gets a row back, the rest get none and return early. No SELECT-then-INSERT race, no
 * advisory lock, no coordination.
 *
 * This is what "effectively-once" means in practice: at-least-once delivery from the broker, plus
 * an idempotent consumer, equals exactly-once EFFECTS — which is the only kind you can actually
 * have. See realtime-ui lab 03 and resilience lab 02 for the same idea from the client side.
 */
export async function consume(tx, message) {
  const claimed = await tx`
    INSERT INTO drill_processed (message_id) VALUES (${message.messageId})
    ON CONFLICT (message_id) DO NOTHING
    RETURNING message_id`;

  if (claimed.length === 0) return;        // already processed by someone (or by us, earlier)

  await tx`INSERT INTO drill_ledger (payment_id, amount) VALUES (${message.paymentId}, ${message.amount})`;
}
