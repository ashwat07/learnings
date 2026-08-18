export const title = 'A job queue without a broker';
export const task = `Four workers poll for jobs at the same time. Write the SELECT that claims a
batch of 5 queued jobs such that NO JOB IS EVER CLAIMED TWICE and no worker blocks behind another.

Your statement runs inside a transaction. Return the job ids; the runner marks them claimed.`;
export const passIf = 'four concurrent workers claim 20 DISTINCT jobs, and none of them blocks';
export const query = `SELECT 1`;

export async function setup(sql) {
  await sql.unsafe(`DROP TABLE IF EXISTS drill_jobs`);
  await sql.unsafe(`CREATE TABLE drill_jobs (id bigserial PRIMARY KEY, state text NOT NULL DEFAULT 'queued',
                                             claimed_by text, created_at timestamptz NOT NULL DEFAULT now())`);
  await sql.unsafe(`INSERT INTO drill_jobs (state) SELECT 'queued' FROM generate_series(1, 100)`);
}
export async function teardown(sql) { await sql.unsafe('DROP TABLE IF EXISTS drill_jobs'); }

export async function custom(sql, _ctx, { userSql }) {
  if (!userSql.trim()) return [{ check: 'you wrote a statement', actual: 'solution.sql is empty', pass: false }];

  const postgres = (await import('postgres')).default;
  const conn = () => postgres({ host: 'localhost', port: 5433, user: 'labs', password: 'labs',
    database: 'labs', max: 1, onnotice: () => {} });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const workers = ['w1', 'w2', 'w3', 'w4'].map((name) => {
    const c = conn();
    return { name, c, run: () => c.begin(async (tx) => {
      const t0 = performance.now();
      const rows = await tx.unsafe(userSql);
      const waited = performance.now() - t0;
      await sleep(40);                                 // "doing the work" while holding the lock
      const ids = rows.map((r) => r.id);
      if (ids.length) await tx`UPDATE drill_jobs SET state = 'running', claimed_by = ${name} WHERE id = ANY(${ids})`;
      return { ids, waited };
    }) };
  });

  let results;
  try { results = await Promise.all(workers.map((w) => w.run())); }
  catch (e) { for (const w of workers) await w.c.end(); return [{ check: 'the statement ran', actual: e.message.split('\n')[0].slice(0, 50), pass: false }]; }
  for (const w of workers) await w.c.end();

  const all = results.flatMap((r) => r.ids.map(String));
  const distinct = new Set(all);
  const maxWait = Math.max(...results.map((r) => r.waited));
  return [
    { check: '20 jobs claimed in total', actual: all.length, pass: all.length === 20 },
    { check: 'every job claimed EXACTLY once', actual: `${distinct.size} distinct`, pass: distinct.size === all.length && all.length > 0 },
    { check: 'no worker blocked (< 35ms wait)', actual: `${maxWait.toFixed(0)}ms max wait`, pass: maxWait < 35 },
  ];
}

export const behavioural = true;
