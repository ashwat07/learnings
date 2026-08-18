export const title = 'Column order';
export const task = `"Show me MY last 20 orders." A colleague added an index and it barely helped.
Add ONE index that makes this query touch almost nothing.`;
export const passIf = 'fewer than 100 buffers, and no Sort node in the plan';
export const query = `
  SELECT id, status, total_cents, created_at
  FROM orders
  WHERE user_id = 42
  ORDER BY created_at DESC
  LIMIT 20`;
export const maxBuffers = 100;
export const noSeqScanOn = 'orders';
export async function setup(sql) {
  // The colleague's index. It is not useless — it is just the wrong way round.
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_d2_colleague ON orders (created_at DESC, user_id)`);
}
export async function teardown(sql) { await sql.unsafe('DROP INDEX IF EXISTS idx_d2_colleague'); }
export async function custom(sql, { plan }) {
  const sorted = plan.nodes.some((n) => n['Node Type'] === 'Sort' || n['Node Type'] === 'Incremental Sort');
  return [{ check: 'no Sort node (the index provides the order)', actual: sorted ? 'Sort present' : 'none', pass: !sorted }];
}
