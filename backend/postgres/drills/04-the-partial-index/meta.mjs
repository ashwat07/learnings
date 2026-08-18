export const title = 'The job queue';
export const task = `A worker polls for pending orders every second. 'pending' is ~6% of the table
and 'delivered' is 70%. Build the SMALLEST index that makes the poll instant.`;
export const passIf = 'fewer than 150 buffers AND the index is under 512 kB';
export const query = `
  SELECT id, user_id, created_at
  FROM orders
  WHERE status = 'pending'
  ORDER BY created_at
  LIMIT 25`;
export const maxBuffers = 150;
export const noSeqScanOn = 'orders';
export async function custom(sql, _ctx) {
  const [row] = await sql`
    SELECT coalesce(sum(pg_relation_size(indexrelid)), 0) AS bytes
    FROM pg_stat_user_indexes
    WHERE relname = 'orders' AND indexrelname LIKE 'idx_%'`;
  const kb = Number(row.bytes) / 1024;
  return [{ check: 'your index is under 512 kB', actual: `${kb.toFixed(0)} kB`, pass: kb > 0 && kb < 512 }];
}
