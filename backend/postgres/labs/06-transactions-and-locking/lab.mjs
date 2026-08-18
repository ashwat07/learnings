/**
 * Lab 06 — Transactions, isolation & locking.
 *
 *   node postgres/labs/06-transactions-and-locking/lab.mjs
 *
 * Every experiment runs TWO REAL CONCURRENT CONNECTIONS. Nothing here is simulated — the lost
 * update actually loses an update, and the deadlock is a real deadlock that Postgres detects and
 * kills.
 */

import postgres from 'postgres';
import { sql, rule, note, good, bad, table } from '../../../lib/db.mjs';

const conn = () => postgres({ host: 'localhost', port: 5433, user: 'labs', password: 'labs',
  database: 'labs', max: 1, onnotice: () => {} });

await sql.unsafe(`DROP TABLE IF EXISTS accounts`);
await sql.unsafe(`CREATE TABLE accounts (id int PRIMARY KEY, balance int NOT NULL, version int NOT NULL DEFAULT 0)`);
const reset = () => sql.unsafe(`TRUNCATE accounts; INSERT INTO accounts VALUES (1, 1000, 0), (2, 1000, 0)`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const balance = async (id = 1) => (await sql`SELECT balance FROM accounts WHERE id = ${id}`)[0].balance;

// ---------------------------------------------------------------------------
rule('1. the LOST UPDATE — read-modify-write without protection');
await reset();
{
  const a = conn(), b = conn();
  // Both do: read balance, subtract 100 in application code, write it back. Classic.
  const withdraw = async (c, label) => c.begin(async (tx) => {
    const [row] = await tx`SELECT balance FROM accounts WHERE id = 1`;
    await sleep(50);                                    // "business logic"
    await tx`UPDATE accounts SET balance = ${row.balance - 100} WHERE id = 1`;
    return `${label} saw ${row.balance}, wrote ${row.balance - 100}`;
  });
  const out = await Promise.all([withdraw(a, 'A'), withdraw(b, 'B')]);
  out.forEach((o) => note(o));
  bad(`final balance: ${await balance()} — should be 800. ONE WITHDRAWAL VANISHED.`);
  await a.end(); await b.end();
}
console.log(`
  Both transactions read 1000, both computed 900, both wrote 900. The second write silently
  overwrote the first. No error, no conflict, no log line — the money is simply gone.

  READ COMMITTED (the default) does not prevent this. It guarantees you never read UNCOMMITTED
  data; it says nothing about a value changing between your SELECT and your UPDATE.`);

// ---------------------------------------------------------------------------
rule('2. fix A — do the arithmetic IN THE DATABASE');
await reset();
{
  const a = conn(), b = conn();
  const withdraw = (c) => c.begin(async (tx) => {
    await sleep(20);
    // UPDATE ... SET balance = balance - 100 takes a row lock and re-reads the CURRENT value.
    await tx`UPDATE accounts SET balance = balance - 100 WHERE id = 1`;
  });
  await Promise.all([withdraw(a), withdraw(b)]);
  good(`final balance: ${await balance()} — correct`);
  await a.end(); await b.end();
}
console.log(`
  The cheapest fix, and the one people skip because it feels too simple: NEVER READ A VALUE INTO
  YOUR APPLICATION IN ORDER TO WRITE IT BACK. Express the change as a delta and let the database
  apply it.

  Under READ COMMITTED, an UPDATE that finds a row locked by another transaction WAITS, then
  RE-EVALUATES the row against the new committed version. That re-evaluation is what makes this
  correct — and it is also why the same trick does NOT save you under REPEATABLE READ (section 4).

  It only works when the new value is a pure function of the old one. "Set status to shipped if
  it is currently paid" needs section 3.`);

// ---------------------------------------------------------------------------
rule('3. fix B — SELECT ... FOR UPDATE (pessimistic)');
await reset();
{
  const a = conn(), b = conn();
  const order = [];
  const withdraw = (c, label) => c.begin(async (tx) => {
    // FOR UPDATE takes the row lock at SELECT time. The second transaction BLOCKS here.
    const [row] = await tx`SELECT balance FROM accounts WHERE id = 1 FOR UPDATE`;
    order.push(`${label} acquired the lock, saw ${row.balance}`);
    await sleep(50);
    await tx`UPDATE accounts SET balance = ${row.balance - 100} WHERE id = 1`;
  });
  await Promise.all([withdraw(a, 'A'), withdraw(b, 'B')]);
  order.forEach(note);
  good(`final balance: ${await balance()} — correct, and B saw A's committed value`);
  await a.end(); await b.end();
}
console.log(`
  B blocked at its SELECT until A committed, then read the NEW value. Serialised by construction.

  The variants, and when each is right:
    FOR UPDATE            block until you can lock. The default choice.
    FOR NO KEY UPDATE     a weaker lock that still allows foreign-key references. Use it when
                          you are not changing the key.
    FOR SHARE             several readers, no writers. "Nobody may change this while I decide."
    FOR UPDATE NOWAIT     fail immediately instead of blocking — good for a UI action that
                          should say "someone else is editing this".
    FOR UPDATE SKIP LOCKED  skip rows others hold. THE job-queue primitive:

      SELECT id FROM jobs WHERE state = 'queued'
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 10;

    Ten workers running that get ten disjoint batches, with no coordination and no broker.

  The cost of pessimism: you hold a lock for the whole transaction, so a long transaction blocks
  everyone behind it. Keep the transaction short, and never do I/O (an HTTP call!) inside one.`);

// ---------------------------------------------------------------------------
rule('4. fix C — optimistic concurrency (a version column)');
await reset();
{
  const a = conn(), b = conn();
  const withdraw = async (c, label) => {
    const [row] = await c`SELECT balance, version FROM accounts WHERE id = 1`;
    await sleep(30);
    const res = await c`UPDATE accounts SET balance = ${row.balance - 100}, version = version + 1
                        WHERE id = 1 AND version = ${row.version} RETURNING id`;
    return res.length ? `${label}: applied` : `${label}: REJECTED — version moved, retry`;
  };
  (await Promise.all([withdraw(a, 'A'), withdraw(b, 'B')])).forEach(note);
  good(`final balance: ${await balance()} — one applied, one rejected (and would retry)`);
  await a.end(); await b.end();
}
console.log(`
  No locks at all. The UPDATE's WHERE clause carries the version you read; if someone else got
  there first it matches zero rows and you retry.

  This is the same idea as HTTP's If-Match / ETag, and the same idea as the frontend labs on
  conflict handling. It is the right default when conflicts are RARE: no lock is held, nothing
  blocks, and readers never wait. It is the wrong default when conflicts are common, because you
  pay for the work twice.

  The thing to get right: the retry. Bounded attempts, and a decision about what "retry" means for
  the user — re-read and re-apply is safe; re-submitting their stale form is not.`);

// ---------------------------------------------------------------------------
rule('5. isolation levels, demonstrated');
await reset();
{
  const rows = [];
  for (const level of ['READ COMMITTED', 'REPEATABLE READ']) {
    await reset();
    const a = conn(), b = conn();
    let first, second;
    const reader = a.begin(async (tx) => {
      await tx.unsafe(`SET TRANSACTION ISOLATION LEVEL ${level}`);
      first = (await tx`SELECT balance FROM accounts WHERE id = 1`)[0].balance;
      await sleep(80);
      second = (await tx`SELECT balance FROM accounts WHERE id = 1`)[0].balance;
    });
    await sleep(30);
    await b`UPDATE accounts SET balance = 555 WHERE id = 1`;
    await reader;
    rows.push({ level, 'first read': first, 'second read': second, 'stable?': first === second ? 'yes' : 'NO — non-repeatable read' });
    await a.end(); await b.end();
  }
  table(rows, ['level', 'first read', 'second read', 'stable?']);
}
console.log(`
  READ COMMITTED gives each STATEMENT a fresh snapshot, so two identical SELECTs in one
  transaction can disagree. REPEATABLE READ gives the whole TRANSACTION one snapshot.

    READ COMMITTED   (default)  no dirty reads. Non-repeatable reads and phantoms are possible.
    REPEATABLE READ             one snapshot per transaction. In Postgres this also prevents
                                phantoms — it is stronger than the SQL standard requires.
    SERIALIZABLE                as if transactions ran one at a time. Detects true conflicts via
                                predicate locks (SSI).

  What nobody tells you: THE STRONGER LEVELS DO NOT BLOCK — THEY ABORT. Under REPEATABLE READ or
  SERIALIZABLE you WILL get "could not serialize access due to concurrent update" (SQLSTATE 40001),
  and your application MUST retry the whole transaction. Code that does not handle 40001 does not
  actually run at those isolation levels; it just fails in production occasionally.`);

// ---------------------------------------------------------------------------
rule('6. a real DEADLOCK');
await reset();
{
  const a = conn(), b = conn();
  const t1 = a.begin(async (tx) => {
    await tx`UPDATE accounts SET balance = balance - 1 WHERE id = 1`;
    await sleep(80);
    await tx`UPDATE accounts SET balance = balance + 1 WHERE id = 2`;   // wants what B holds
  });
  const t2 = b.begin(async (tx) => {
    await tx`UPDATE accounts SET balance = balance - 1 WHERE id = 2`;
    await sleep(80);
    await tx`UPDATE accounts SET balance = balance + 1 WHERE id = 1`;   // wants what A holds
  });
  const settled = await Promise.allSettled([t1, t2]);
  for (const [i, r] of settled.entries()) {
    if (r.status === 'rejected') bad(`transaction ${i + 1}: ${r.reason.code} ${r.reason.message.split('\n')[0]}`);
    else good(`transaction ${i + 1}: committed`);
  }
  await a.end(); await b.end();
}
console.log(`
  A locked row 1 then wanted row 2; B locked row 2 then wanted row 1. Postgres detected the cycle
  (after deadlock_timeout, 1s by default) and killed one victim with SQLSTATE 40P01.

  THE FIX IS ALWAYS THE SAME: ACQUIRE LOCKS IN A CONSISTENT ORDER. Sort the ids before you touch
  them and this deadlock becomes impossible:

    for (const id of ids.sort((x, y) => x - y)) await tx\`UPDATE ... WHERE id = \${id}\`;

  Deadlocks are not a Postgres problem to tune away — they are an ordering bug in your code. And
  note that ANY transaction can be the victim, so a retry loop for 40P01 belongs next to the one
  for 40001.`);

// ---------------------------------------------------------------------------
rule('7. the rules');
table([
  { rule: 'keep transactions SHORT', why: 'a lock is held until commit; long transactions also block VACUUM' },
  { rule: 'NEVER do I/O inside a transaction', why: 'an HTTP call inside BEGIN holds locks for the length of someone else\'s outage' },
  { rule: 'do arithmetic in SQL, not in the app', why: 'removes the read-modify-write window entirely' },
  { rule: 'lock in a consistent order', why: 'the only real cure for deadlocks' },
  { rule: 'retry 40001 and 40P01', why: 'stronger isolation ABORTS rather than blocks' },
  { rule: 'FOR UPDATE SKIP LOCKED for queues', why: 'N workers, disjoint batches, no broker' },
  { rule: 'watch for idle in transaction', why: 'a connection that BEGINs and then waits on the app is holding everything' },
], ['rule', 'why']);
console.log(`
  Find the last one in production — it is the single most common cause of "the database is locked
  up" and it is always an application bug:

    SELECT pid, state, now() - xact_start AS open_for, left(query, 60)
    FROM pg_stat_activity
    WHERE state = 'idle in transaction' ORDER BY xact_start;

  And set idle_in_transaction_session_timeout so a forgotten BEGIN cannot hold locks forever.`);

await sql.unsafe('DROP TABLE IF EXISTS accounts');
await sql.end();
