import { sql } from '../../../lib/db.mjs';

export const title = 'Retries, backoff and the dead-letter queue';
export const task = `Process a batch of 12 jobs. Three of them are POISON — they will fail every
single time, forever. Two fail once then succeed.

A naive worker retries the poison jobs until the end of the universe, blocking the queue and
filling your logs. Make it give up, put them somewhere a human can find them, and keep going.`;
export const passIf = '9 jobs done, 3 in the DLQ with their error, and the poison is attempted no more than 4 times each';

export async function check(s) {
  if (typeof s.processJob !== 'function') return [{ check: 'exports processJob(sql, job, handler)', actual: 'missing', pass: false }];

  await sql.unsafe(`DROP TABLE IF EXISTS drill_jobs, drill_dlq`);
  await sql.unsafe(`CREATE TABLE drill_jobs (
      id bigserial PRIMARY KEY, kind text NOT NULL, payload jsonb NOT NULL,
      state text NOT NULL DEFAULT 'queued', attempts int NOT NULL DEFAULT 0,
      run_after timestamptz NOT NULL DEFAULT now(), last_error text)`);
  await sql.unsafe(`CREATE TABLE drill_dlq (
      id bigserial PRIMARY KEY, job_id bigint NOT NULL, attempts int NOT NULL,
      last_error text NOT NULL, failed_at timestamptz NOT NULL DEFAULT now())`);

  for (let i = 1; i <= 12; i++) {
    const kind = i <= 3 ? 'poison' : i <= 5 ? 'flaky' : 'good';
    await sql`INSERT INTO drill_jobs (kind, payload) VALUES (${kind}, ${sql.json({ i })})`;
  }

  const attempts = new Map();
  const flakySeen = new Map();
  const handler = async (job) => {
    attempts.set(String(job.id), (attempts.get(String(job.id)) ?? 0) + 1);
    if (job.kind === 'poison') throw new Error(`cannot parse payload for job ${job.id}`);
    if (job.kind === 'flaky') {
      const n = (flakySeen.get(String(job.id)) ?? 0) + 1;
      flakySeen.set(String(job.id), n);
      if (n === 1) throw new Error('transient upstream failure');
    }
    return 'ok';
  };

  // Drive the worker loop until nothing is runnable, with a hard bound so an infinite retry
  // loop fails the drill instead of hanging it.
  const t0 = Date.now();
  let iterations = 0;
  while (Date.now() - t0 < 12_000 && iterations < 400) {
    iterations++;
    const [job] = await sql`SELECT * FROM drill_jobs
                            WHERE state = 'queued' AND run_after <= now()
                            ORDER BY id LIMIT 1`;
    if (!job) {
      const [{ pending }] = await sql`SELECT count(*)::int AS pending FROM drill_jobs WHERE state = 'queued'`;
      if (pending === 0) break;
      await new Promise((r) => setTimeout(r, 60));      // everything is backing off
      continue;
    }
    try { await s.processJob(sql, job, handler); } catch { /* the worker must not die */ }
  }

  const [{ done }] = await sql`SELECT count(*)::int AS done FROM drill_jobs WHERE state = 'done'`;
  const [{ stuck }] = await sql`SELECT count(*)::int AS stuck FROM drill_jobs WHERE state = 'queued'`;
  const dlq = await sql`SELECT job_id, attempts, last_error FROM drill_dlq ORDER BY job_id`;
  const poisonAttempts = [...attempts.entries()].filter(([id]) => Number(id) <= 3).map(([, n]) => n);
  const maxPoison = poisonAttempts.length ? Math.max(...poisonAttempts) : 0;
  const hasError = dlq.every((r) => r.last_error && r.last_error.length > 5);

  await sql.unsafe(`DROP TABLE IF EXISTS drill_jobs, drill_dlq`);
  return [
    { check: '9 jobs completed', actual: done, pass: done === 9 },
    { check: '3 jobs in the DLQ', actual: dlq.length, pass: dlq.length === 3 },
    { check: 'the DLQ records the error', actual: hasError ? 'yes' : 'missing or empty', pass: hasError && dlq.length === 3 },
    { check: 'poison attempted <= 4 times each', actual: `max ${maxPoison}`, pass: maxPoison > 0 && maxPoison <= 4 },
    { check: 'nothing left stuck in the queue', actual: stuck, pass: stuck === 0 },
    { check: 'the flaky jobs eventually succeeded', actual: `${[...flakySeen.values()].filter((n) => n >= 2).length}/2 retried`, pass: [...flakySeen.values()].filter((n) => n >= 2).length === 2 },
  ];
}
