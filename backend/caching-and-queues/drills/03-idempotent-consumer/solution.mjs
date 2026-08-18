/**
 * export async function consume(tx, message) -> void
 *
 * `tx` is a postgres.js transaction. `message` is { messageId, paymentId, amount }.
 * The SAME messageId arrives 3 times, and 4 workers run concurrently.
 *
 * Tables already created for you:
 *   drill_ledger    (id, payment_id, amount)
 *   drill_processed (message_id PRIMARY KEY, processed_at)
 *
 * The version below applies every delivery — 30 rows instead of 10. Fix it.
 *
 * Careful: "SELECT to check, then INSERT" is the lost-update bug from postgres lab 06 wearing a
 * different hat. Two workers can both see "not processed".
 */
export async function consume(tx, message) {
  await tx`INSERT INTO drill_ledger (payment_id, amount) VALUES (${message.paymentId}, ${message.amount})`;
}
