export const title = 'A migration nobody notices';
export const task = `drill_accounts.amount_cents is an integer. It has 800,000 rows, it is being
written to right now, and it is going to overflow — you need it to be a bigint.

  ALTER TABLE drill_accounts ALTER COLUMN amount_cents TYPE bigint;

...rewrites the entire table while holding ACCESS EXCLUSIVE. Every read, every write and every
health check queues behind it. On this table that is under a second; on a real one it is however
long it takes to rewrite your largest table, with your service down for all of it.

Do it the other way. When the runner is finished, the table must have:

  · a bigint column  amount_minor
  · amount_minor = amount_cents for EVERY row — including the ones inserted WHILE you migrated
  · an index named  drill_accounts_amount_minor_idx , and it must be VALID

Your statements are run one at a time, outside any transaction, while a writer inserts a row
every few milliseconds.`;
export const passIf = 'the writer never errors, never waits more than 250ms, and every row — including the ones written during the migration — ends up correct';
export const query = `SELECT 1`;
export const behavioural = true;

const ROWS = 800_000;

export async function setup(sql) {
  await sql.unsafe(`DROP TABLE IF EXISTS drill_accounts CASCADE`);
  await sql.unsafe(`CREATE TABLE drill_accounts (
      id bigserial PRIMARY KEY,
      email text NOT NULL,
      amount_cents integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now())`);
  await sql.unsafe(`INSERT INTO drill_accounts (email, amount_cents)
                    SELECT 'u' || g || '@example.com', g FROM generate_series(1, ${ROWS}) g`);
  await sql.unsafe(`ANALYZE drill_accounts`);
}

export async function teardown(sql) {
  await sql.unsafe(`DROP TABLE IF EXISTS drill_accounts CASCADE`);
  await sql.unsafe(`DROP FUNCTION IF EXISTS drill_accounts_sync() CASCADE`);
}

/**
 * Split on semicolons WITHOUT breaking dollar-quoted function bodies. A naive split(';') cuts a
 * trigger function in half, which is a real thing migration tooling gets wrong.
 */
function splitStatements(text) {
  const out = [];
  let current = '';
  let tag = null;
  for (let i = 0; i < text.length; i++) {
    const rest = text.slice(i);
    if (!tag) {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest);
      if (m) { tag = m[0]; current += m[0]; i += m[0].length - 1; continue; }
      if (text[i] === ';') { if (current.trim()) out.push(current.trim()); current = ''; continue; }
    } else if (rest.startsWith(tag)) {
      current += tag; i += tag.length - 1; tag = null; continue;
    }
    current += text[i];
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

export async function custom(sql, _ctx, { userSql }) {
  if (!userSql.trim()) return [{ check: 'you wrote a migration', actual: 'solution.sql is empty', pass: false }];

  const postgres = (await import('postgres')).default;
  const conn = () => postgres({ host: 'localhost', port: 5433, user: 'labs', password: 'labs',
    database: 'labs', max: 1, onnotice: () => {} });

  // The writer: a live application, inserting while you migrate.
  const writer = conn();
  const latencies = [];
  const errors = [];
  const duringMigration = [];
  let writing = true;

  const writeLoop = (async () => {
    let n = 0;
    while (writing) {
      const t0 = performance.now();
      try {
        const [row] = await writer.unsafe(
          `INSERT INTO drill_accounts (email, amount_cents) VALUES ($1, $2) RETURNING id`,
          [`live-${++n}@example.com`, 1_000_000 + n]);
        duringMigration.push(Number(row.id));
      } catch (e) {
        errors.push(e.message.split('\n')[0]);
      }
      latencies.push(performance.now() - t0);
      await new Promise((r) => setTimeout(r, 4));
    }
  })();

  await new Promise((r) => setTimeout(r, 60));       // let the writer get going
  const beforeCount = duringMigration.length;

  const migrator = conn();
  let migrationError = null;
  const t0 = performance.now();
  try {
    for (const stmt of splitStatements(userSql)) {
      // One statement, one round trip, NO transaction wrapper — which is what CREATE INDEX
      // CONCURRENTLY requires and what a migration tool that wraps everything in BEGIN cannot do.
      await migrator.unsafe(stmt);
    }
  } catch (e) {
    migrationError = e.message.split('\n')[0];
  }
  const migrationMs = performance.now() - t0;

  await new Promise((r) => setTimeout(r, 80));       // a few more writes after it lands
  writing = false;
  await writeLoop;
  await writer.end();
  await migrator.end();

  const insertedDuring = duringMigration.slice(beforeCount);
  const maxLatency = Math.max(...latencies, 0);

  const checks = [];
  checks.push({ check: 'the migration ran', actual: migrationError ?? `${migrationMs.toFixed(0)}ms`, pass: !migrationError });

  const [col] = await sql.unsafe(
    `SELECT data_type FROM information_schema.columns
     WHERE table_name = 'drill_accounts' AND column_name = 'amount_minor'`);
  checks.push({ check: 'amount_minor exists and is a bigint', actual: col?.data_type ?? 'missing', pass: col?.data_type === 'bigint' });

  const [{ wrong }] = await sql.unsafe(
    `SELECT count(*)::int AS wrong FROM drill_accounts
     WHERE amount_minor IS DISTINCT FROM amount_cents::bigint`);
  checks.push({ check: 'every row backfilled correctly', actual: `${wrong} rows wrong`, pass: wrong === 0 });

  // THE check. Rows written while the migration was in flight are the ones a backfill misses.
  const [{ missed }] = insertedDuring.length
    ? await sql.unsafe(
        `SELECT count(*)::int AS missed FROM drill_accounts
         WHERE id = ANY($1) AND amount_minor IS DISTINCT FROM amount_cents::bigint`, [insertedDuring])
    : [{ missed: -1 }];
  checks.push({
    check: `rows inserted DURING the migration are correct (${insertedDuring.length} of them)`,
    actual: missed === -1 ? 'the writer never got a row in' : `${missed} missed`,
    pass: missed === 0,
  });

  const [idx] = await sql.unsafe(
    `SELECT indisvalid FROM pg_index WHERE indexrelid = 'drill_accounts_amount_minor_idx'::regclass`)
    .catch(() => [null]);
  checks.push({
    check: 'drill_accounts_amount_minor_idx exists and is VALID',
    actual: idx == null ? 'missing' : (idx.indisvalid ? 'valid' : 'INVALID — a CONCURRENTLY build that failed leaves one behind'),
    pass: idx?.indisvalid === true,
  });

  checks.push({ check: 'the writer saw no errors', actual: errors.length ? `${errors.length}: ${errors[0].slice(0, 40)}` : 'none', pass: errors.length === 0 });
  checks.push({
    check: 'no write waited more than 250ms',
    actual: `worst write ${maxLatency.toFixed(0)}ms`,
    pass: maxLatency < 250,
  });

  return checks;
}
