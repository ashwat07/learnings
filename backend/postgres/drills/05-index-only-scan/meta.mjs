export const title = 'Answer it without touching the table';
export const task = `An analytics endpoint sums order totals for a range of users. It is reading
tens of thousands of pages to return one row. Make Postgres answer it from the index alone.`;
export const passIf = 'the plan contains an Index Only Scan, zero Heap Fetches, under 500 buffers';
export const query = `
  SELECT count(*), sum(total_cents)
  FROM orders
  WHERE user_id BETWEEN 1000 AND 8000`;
export const requireNodeType = 'Index Only Scan';
export const maxHeapFetches = 0;
export const maxBuffers = 500;
export async function setup(sql) { await sql.unsafe('VACUUM ANALYZE orders'); }
