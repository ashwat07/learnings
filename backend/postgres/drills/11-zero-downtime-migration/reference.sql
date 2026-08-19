-- Drill 11 — reference.

-- 1. EXPAND. A catalogue change: no rewrite, no scan, milliseconds whatever the table size.
--    Nullable on purpose — a NOT NULL default would be fine on PG11+, but nullable is what lets
--    the trigger and the backfill do their jobs without fighting a constraint.
ALTER TABLE drill_accounts ADD COLUMN amount_minor bigint;

-- 2. KEEP NEW WRITES IN SYNC — and do this BEFORE the backfill, not after.
--    This ordering is the entire drill. Backfill first and every row inserted between the backfill
--    finishing and the trigger being installed has a NULL amount_minor, forever, silently. The
--    window is small, which is exactly why it survives testing and fails in production.
CREATE OR REPLACE FUNCTION drill_accounts_sync() RETURNS trigger AS $$
BEGIN
  NEW.amount_minor := NEW.amount_cents::bigint;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER drill_accounts_sync_trg
  BEFORE INSERT OR UPDATE ON drill_accounts
  FOR EACH ROW EXECUTE FUNCTION drill_accounts_sync();

-- 3. BACKFILL IN BATCHES. One UPDATE over 800,000 rows locks all of them until it commits, bloats
--    the table with 800,000 dead tuples at once, and generates one enormous WAL record that a
--    replica has to apply in a single gulp — which is how a backfill causes replication lag.
--
--    A loop with a commit per batch keeps each lock short and lets autovacuum keep up. The
--    `PERFORM pg_sleep` is not politeness — it is what stops the backfill saturating I/O and
--    starving the queries you are trying not to disturb.
DO $$
DECLARE
  updated integer;
BEGIN
  LOOP
    UPDATE drill_accounts
       SET amount_minor = amount_cents::bigint
     WHERE id IN (
       SELECT id FROM drill_accounts
        WHERE amount_minor IS NULL
        ORDER BY id
        LIMIT 20000
        FOR UPDATE SKIP LOCKED     -- do not queue behind the live writer
     );
    GET DIAGNOSTICS updated = ROW_COUNT;
    EXIT WHEN updated = 0;
    COMMIT;                        -- a DO block can commit since PG11; each batch is its own txn
    PERFORM pg_sleep(0.005);
  END LOOP;
END $$;

-- 4. THE INDEX, without blocking writes.
--    CONCURRENTLY builds it in two passes plus a wait for existing transactions, so it takes
--    LONGER in wall-clock and never holds a lock that blocks writers. It cannot run inside a
--    transaction block. And if it fails part-way it leaves an INVALID index behind that is not
--    used by queries and is not rebuilt automatically — you have to DROP INDEX CONCURRENTLY and
--    try again. Check pg_index.indisvalid after every concurrent build; nothing else will.
CREATE INDEX CONCURRENTLY drill_accounts_amount_minor_idx ON drill_accounts (amount_minor);

-- 5. CONTRACT — and this is a LATER DEPLOY, not this one.
--
--      ALTER TABLE drill_accounts ALTER COLUMN amount_minor SET NOT NULL;   -- once fully backfilled
--      -- deploy code that reads amount_minor
--      -- wait. verify. leave it a release.
--      DROP TRIGGER drill_accounts_sync_trg ON drill_accounts;
--      ALTER TABLE drill_accounts DROP COLUMN amount_cents;
--
--    Dropping the old column in the same deploy that adds the new one is the mistake that makes
--    expand/contract pointless: your old application version is still running during a rolling
--    deploy, and it SELECTs amount_cents. Every migration has to work with BOTH the version
--    before it and the version after it.

-- ---------------------------------------------------------------------------
-- THE OPERATIONS THAT TAKE ACCESS EXCLUSIVE AND REWRITE THE TABLE
--
--   ALTER COLUMN TYPE (unless binary-coercible, e.g. varchar(50) -> varchar(100) or -> text)
--   ADD COLUMN with a VOLATILE default          -- a constant default is free since PG11
--   SET NOT NULL                                -- scans the table; use a NOT VALID CHECK first,
--                                               -- VALIDATE it (a weak lock), then SET NOT NULL
--   CLUSTER, VACUUM FULL
--
-- SAFE, OR NEARLY SO
--   ADD COLUMN nullable / with a constant default
--   DROP COLUMN                                 -- catalogue only; the space comes back on vacuum
--   RENAME                                      -- instant, and breaks every deployed client at once
--   CREATE INDEX CONCURRENTLY / DROP INDEX CONCURRENTLY
--   ADD CONSTRAINT ... NOT VALID, then VALIDATE CONSTRAINT
--   ADD FOREIGN KEY ... NOT VALID, then VALIDATE
--
-- THE ONE THAT CATCHES EVERYONE
-- A "fast" DDL still needs ACCESS EXCLUSIVE for a moment — and to get it, it QUEUES. Every query
-- that arrives after it queues behind it, including reads. So one long-running SELECT plus one
-- instant ALTER equals a total outage for the duration of the SELECT. Always:
--
--     SET lock_timeout = '3s';
--
-- before DDL, so the migration fails fast and retries instead of freezing the database. This is
-- the single highest-value line in any migration file and almost nobody writes it.
