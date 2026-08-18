/**
 * export async function processJob(sql, job, handler) -> void
 *
 * `job` is a row from drill_jobs: { id, kind, payload, state, attempts, run_after, last_error }.
 * `handler(job)` does the work and may throw. Some jobs throw EVERY time.
 *
 * Tables:
 *   drill_jobs (id, kind, payload, state, attempts, run_after, last_error)
 *   drill_dlq  (id, job_id, attempts, last_error, failed_at)
 *
 * The version below retries forever. The runner bounds the loop, so "forever" shows up as a
 * failed check rather than a hang — but in production it is a queue that never drains.
 *
 * Decide: how many attempts, how long between them, and where a job goes when you give up.
 * Keep the backoff SHORT (tens of ms) — the runner only waits 12 seconds.
 */
export async function processJob(sql, job, handler) {
  try {
    await handler(job);
    await sql`UPDATE drill_jobs SET state = 'done' WHERE id = ${job.id}`;
  } catch (err) {
    await sql`UPDATE drill_jobs SET attempts = attempts + 1, last_error = ${err.message}
              WHERE id = ${job.id}`;
  }
}
