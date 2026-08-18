export const title = 'One index, not three';
export const task = `A previous engineer added three single-column indexes to speed up three
queries. Replace ALL THREE with a SINGLE index that still serves every one of them.`;
export const passIf = 'all three queries avoid a Seq Scan, using exactly ONE index you created';
export const query = `SELECT id FROM orders WHERE user_id = 42 AND status = 'delivered' ORDER BY created_at DESC LIMIT 10`;
export const noSeqScanOn = 'orders';
export const maxBuffers = 200;
export async function custom(sql, _ctx) {
  const others = [
    `SELECT id FROM orders WHERE user_id = 42 ORDER BY created_at DESC LIMIT 10`,
    `SELECT count(*) FROM orders WHERE user_id = 42 AND status = 'delivered'`,
  ];
  const checks = [];
  for (const q of others) {
    const [row] = await sql.unsafe(`EXPLAIN (FORMAT JSON) ${q}`);
    const json = JSON.stringify(row['QUERY PLAN']);
    checks.push({ check: `also serves: ${q.slice(20, 62)}…`, actual: json.includes('Seq Scan') ? 'Seq Scan' : 'index', pass: !json.includes('Seq Scan') });
  }
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM pg_stat_user_indexes
                            WHERE relname = 'orders' AND indexrelname LIKE 'idx_%'`;
  checks.push({ check: 'exactly one new index', actual: n, pass: n === 1 });
  return checks;
}
