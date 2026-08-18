/**
 * Four decisions, and every real queue makes all four:
 *
 *   1. A MAXIMUM ATTEMPT COUNT. Without it a poison message is an infinite loop that also blocks
 *      everything behind it and floods your logs with the same stack trace.
 *   2. EXPONENTIAL BACKOFF WITH JITTER. A transient failure is usually a dependency under load;
 *      retrying immediately is the worst possible moment. Jitter stops every worker in the fleet
 *      retrying in lockstep (see realtime-ui lab 02 — the same argument, different layer).
 *   3. A DEAD-LETTER QUEUE, with the ERROR and the ATTEMPT COUNT. A DLQ without the error is a
 *      pile of jobs nobody can triage.
 *   4. THE WORKER MUST NOT DIE. One bad job may not take down the consumer.
 *
 * What a production queue adds on top: a visibility timeout so a crashed worker's job is re-queued,
 * a "retryable vs terminal" distinction (a 400 from an upstream should go STRAIGHT to the DLQ — do
 * not retry what cannot succeed), and an alert on DLQ depth. A DLQ nobody watches is a delete.
 */
const MAX_ATTEMPTS = 4;

export async function processJob(sql, job, handler) {
  try {
    await handler(job);
    await sql`UPDATE drill_jobs SET state = 'done' WHERE id = ${job.id}`;
    return;
  } catch (err) {
    const attempts = job.attempts + 1;

    if (attempts >= MAX_ATTEMPTS) {
      // Give up: move it somewhere a human can find it, WITH the reason.
      await sql.begin(async (tx) => {
        await tx`INSERT INTO drill_dlq (job_id, attempts, last_error)
                 VALUES (${job.id}, ${attempts}, ${err.message})`;
        await tx`UPDATE drill_jobs SET state = 'dead', attempts = ${attempts},
                                       last_error = ${err.message} WHERE id = ${job.id}`;
      });
      return;
    }

    // Exponential backoff with full jitter, capped. Short here so the drill finishes.
    const capped = Math.min(20 * 2 ** attempts, 400);
    const delayMs = Math.round(Math.random() * capped);
    await sql`UPDATE drill_jobs
              SET attempts = ${attempts}, last_error = ${err.message},
                  run_after = now() + (${delayMs} || ' milliseconds')::interval
              WHERE id = ${job.id}`;
  }
}
