export const title = 'The missing index';
export const task = `The orders list page runs this query on every page load and it is the slowest
query in the app. Make it fast.`;
export const passIf = 'no Seq Scan on orders, and fewer than 300 buffers touched';
export const query = `
  SELECT id, user_id, status, total_cents, created_at
  FROM orders
  WHERE created_at >= now() - interval '7 days'
  ORDER BY created_at DESC
  LIMIT 50`;
export const noSeqScanOn = 'orders';
export const maxBuffers = 300;
export const expectRows = 50;
