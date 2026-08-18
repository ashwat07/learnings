-- SKIP LOCKED is the primitive that makes Postgres a perfectly good job queue for most workloads.
-- Each worker takes a row lock on the first 5 unlocked queued rows and SKIPS anything another
-- worker already holds — so four workers get four disjoint batches, with no coordination, no
-- broker, and no waiting.
--
-- FOR UPDATE alone would be CORRECT but serial: worker 2 blocks until worker 1 commits.
-- A plain SELECT would be fast and WRONG: every worker claims the same five jobs.
SELECT id FROM drill_jobs
WHERE state = 'queued'
ORDER BY created_at
FOR UPDATE SKIP LOCKED
LIMIT 5;
