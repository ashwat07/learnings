-- The index filters AND provides the ordering, so the Sort node disappears too.
-- DESC matters less than you would think (Postgres can scan a B-tree backwards), but matching
-- the query's direction avoids a backward scan and reads better.
CREATE INDEX idx_d1 ON orders (created_at DESC);
