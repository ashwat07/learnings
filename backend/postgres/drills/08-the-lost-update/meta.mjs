export const title = 'Stop losing money';
export const task = `Two concurrent withdrawals of 100 from a balance of 1000 leave 900 instead of
800 — one silently overwrote the other. Fix it by writing the UPDATE statement in solution.sql.

Your statement runs inside a transaction that has ALREADY read the row, and it may use the
placeholder :id. It must be correct even when two of them run at the same time.`;
export const passIf = 'the final balance is 800 after two concurrent withdrawals';
export const query = `SELECT 1`;                    // the real check is behavioural, below

export async function setup(sql) {
  await sql.unsafe(`DROP TABLE IF EXISTS drill_accounts`);
  await sql.unsafe(`CREATE TABLE drill_accounts (id int PRIMARY KEY, balance int NOT NULL, version int NOT NULL DEFAULT 0)`);
  await sql.unsafe(`INSERT INTO drill_accounts VALUES (1, 1000, 0)`);
}
export async function teardown(sql) { await sql.unsafe('DROP TABLE IF EXISTS drill_accounts'); }

export async function custom(sql, _ctx, { userSql }) {
  if (!userSql.trim()) return [{ check: 'you wrote a statement', actual: 'solution.sql is empty', pass: false }];

  const postgres = (await import('postgres')).default;
  const conn = () => postgres({ host: 'localhost', port: 5433, user: 'labs', password: 'labs',
    database: 'labs', max: 1, onnotice: () => {} });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const a = conn(), b = conn();
  const withdraw = (c) => c.begin(async (tx) => {
    await tx.unsafe(`SELECT balance, version FROM drill_accounts WHERE id = 1`);
    await sleep(60);                                  // the window where the bug lives
    await tx.unsafe(userSql.replaceAll(':id', '1'));
  });
  const settled = await Promise.allSettled([withdraw(a), withdraw(b)]);
  await a.end(); await b.end();

  const [{ balance }] = await sql`SELECT balance FROM drill_accounts WHERE id = 1`;
  const rejected = settled.filter((s) => s.status === 'rejected').length;
  return [
    { check: 'final balance is 800', actual: balance, pass: Number(balance) === 800 },
    { check: 'neither transaction errored', actual: rejected ? `${rejected} rejected` : 'both ok', pass: rejected === 0 },
  ];
}

export const behavioural = true;
