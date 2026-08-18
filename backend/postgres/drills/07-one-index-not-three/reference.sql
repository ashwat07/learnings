-- The LEFTMOST PREFIX rule: an index on (a, b, c) also serves queries on (a) and (a, b).
-- Equality columns first (user_id, status), then the sort column (created_at).
--
-- This is why one well-ordered composite index usually beats three single-column ones: one index
-- to maintain on write, one to keep in cache, and it covers strictly more query shapes.
CREATE INDEX idx_d7 ON orders (user_id, status, created_at DESC);
