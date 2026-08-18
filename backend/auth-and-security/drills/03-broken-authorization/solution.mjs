/**
 * export async function getOrder(sql, orderId, currentUser) -> the order row, or null/throw
 *
 * currentUser is { id, role }. Admins may read anything; a user may read only their own orders.
 *
 * The version below is a textbook IDOR (Insecure Direct Object Reference): it fetches by id and
 * returns whatever it finds. Change the id in the URL, read anyone's data.
 *
 * The fix is one line — but WHERE you put it matters. Think about which is safer:
 *   (a) fetch the row, then check row.user_id === currentUser.id
 *   (b) never fetch a row you are not allowed to see
 */
export async function getOrder(sql, orderId, currentUser) {
  const [row] = await sql`SELECT id, user_id, status, total_cents FROM orders WHERE id = ${orderId}`;
  return row ?? null;
}
