/**
 * PUT THE AUTHORIZATION IN THE QUERY, not in an `if` after it.
 *
 * Both forms are "correct", and one is much harder to get wrong later:
 *
 *   fetch-then-check   someone adds a second code path, forgets the check, and the row leaks.
 *                      It also fetches data the caller may not see, which shows up in logs,
 *                      traces and error messages.
 *   filter-in-query    the database cannot return a row you are not entitled to. A missing
 *                      check becomes "not found", which is a safe default.
 *
 * Note the response for someone else's order is the SAME as for a non-existent one. Distinguishing
 * "not yours" from "does not exist" is itself a leak — it confirms which ids are real, which is how
 * enumeration attacks map your customer base.
 *
 * And the last check in the runner is the real lesson: `currentUser` must come from a VERIFIED
 * session or token on the server, never from a request body or header the caller controls. This
 * function trusting its argument is fine; the endpoint constructing that argument from user input
 * is the vulnerability.
 */
export async function getOrder(sql, orderId, currentUser) {
  const id = Number(orderId);
  if (!Number.isInteger(id) || id <= 0) return null;

  const [row] = await sql`
    SELECT id, user_id, status, total_cents FROM orders
    WHERE id = ${id}
      AND (${currentUser.role === 'admin'} OR user_id = ${currentUser.id})`;
  return row ?? null;
}
