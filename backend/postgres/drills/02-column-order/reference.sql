-- Equality column FIRST, then the range/sort column. Postgres seeks straight to this user's slice
-- of the index, which is already in created_at order, reads 20 entries and stops.
CREATE INDEX idx_d2 ON orders (user_id, created_at DESC);
