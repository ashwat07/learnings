-- A PARTIAL index contains only the rows matching its WHERE clause — here ~6% of the table. It is
-- a fraction of the size, it stays in cache, and writing a 'delivered' row does not touch it at all.
--
-- status does not need to be in the key: every row in the index already has status = 'pending'.
CREATE INDEX idx_d4 ON orders (created_at) WHERE status = 'pending';
