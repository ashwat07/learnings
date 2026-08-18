import { sql } from '../../../lib/db.mjs';

export const title = 'Effectively-once delivery';
export const task = `Your broker guarantees AT-LEAST-ONCE delivery: every message arrives, and some
arrive more than once. A payment message is delivered 3 times and 4 workers process the batch
concurrently.

Write a consumer that applies each payment EXACTLY ONCE. You get the message and a transaction.`;
export const passIf = 'the ledger has one row per payment and the balance is correct, with duplicates and concurrency';

export async function check(solution) {
  if (typeof solution.consume !== 'function') return [{ check: 'exports consume(tx, message)', actual: 'missing', pass: false }];

  await sql.unsafe(`DROP TABLE IF EXISTS drill_ledger, drill_processed`);
  await sql.unsafe(`CREATE TABLE drill_ledger (id bigserial PRIMARY KEY, payment_id text NOT NULL, amount int NOT NULL)`);
  await sql.unsafe(`CREATE TABLE drill_processed (message_id text PRIMARY KEY, processed_at timestamptz NOT NULL DEFAULT now())`);

  // 10 distinct payments, each delivered 3 times, shuffled — exactly what at-least-once looks like.
  const payments = Array.from({ length: 10 }, (_, i) => ({ messageId: `m-${i}`, paymentId: `p-${i}`, amount: 100 }));
  const deliveries = [...payments, ...payments, ...payments]
    .map((m) => ({ ...m }))
    .sort(() => Math.random() - 0.5);

  const postgres = (await import('postgres')).default;
  const conns = Array.from({ length: 4 }, () => postgres({ host: 'localhost', port: 5433, user: 'labs',
    password: 'labs', database: 'labs', max: 1, onnotice: () => {} }));

  let errors = 0;
  await Promise.all(deliveries.map((msg, i) =>
    conns[i % conns.length].begin((tx) => solution.consume(tx, msg)).catch(() => { errors++; })));
  for (const c of conns) await c.end();

  const [{ rows }] = await sql`SELECT count(*)::int AS rows FROM drill_ledger`;
  const [{ total }] = await sql`SELECT coalesce(sum(amount), 0)::int AS total FROM drill_ledger`;
  const dupes = await sql`SELECT payment_id, count(*)::int AS n FROM drill_ledger GROUP BY payment_id HAVING count(*) > 1`;

  await sql.unsafe(`DROP TABLE IF EXISTS drill_ledger, drill_processed`);
  return [
    { check: '10 ledger rows (not 30)', actual: rows, pass: rows === 10 },
    { check: 'no payment applied twice', actual: dupes.length ? `${dupes.length} duplicated` : 'none', pass: dupes.length === 0 },
    { check: 'total is 1000', actual: total, pass: total === 1000 },
    { check: 'no unhandled errors', actual: errors, pass: errors === 0 },
  ];
}
