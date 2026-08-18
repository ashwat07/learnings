/**
 * export async function exportRows(sql, sink) -> void
 *
 * Read every row of `orders` (200,000 of them), turn each into a line, and `await sink.write(line)`.
 * The sink is SLOWER than the database. Your job is to not fall over.
 *
 * The version below does all three things wrong: it materialises the whole result set, it maps it
 * in one synchronous pass, and it fires every write at once.
 *
 * postgres.js gives you a cursor:
 *   await sql`SELECT ...`.cursor(1000, async (rows) => { ... })
 * which fetches 1,000 rows at a time and WAITS for your callback before fetching more — that is
 * backpressure, handed to you.
 */
export async function exportRows(sql, sink) {
  const rows = await sql`SELECT id, user_id, status, total_cents, created_at FROM orders`;
  const lines = rows.map((r) => `${r.id},${r.user_id},${r.status},${r.total_cents}`);
  await Promise.all(lines.map((line) => sink.write(line)));
}
