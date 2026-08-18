/**
 * Return 50 recent orders as:
 *   [{ id: '123', name: 'ada-7', items: '10x2,45x1' }, ...]
 *
 *   id     the order id, as a string
 *   name   the user's name
 *   items  the order's line items as "product_idxquantity", comma-joined, ORDERED BY product_id
 *
 * Ordering: ORDER BY created_at DESC, id DESC LIMIT 50.
 *
 * At most 3 queries. The N+1 version below uses 101 — make it fewer without changing the output.
 */
export async function load(sql) {
  const orders = await sql`SELECT id, user_id, total_cents FROM orders ORDER BY created_at DESC, id DESC LIMIT 50`;
  const out = [];
  for (const o of orders) {
    const [u] = await sql`SELECT name FROM users WHERE id = ${o.user_id}`;
    const items = await sql`SELECT product_id, quantity FROM order_items WHERE order_id = ${o.id} ORDER BY product_id`;
    out.push({ id: String(o.id), name: u.name, items: items.map((i) => `${i.product_id}x${i.quantity}`).join(',') });
  }
  return out;
}
