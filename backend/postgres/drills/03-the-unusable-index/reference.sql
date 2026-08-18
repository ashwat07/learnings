-- An index is on an EXPRESSION, and the query must use the same expression. lower(email) is a
-- different expression from email, so the plain index is unusable. Index the expression instead.
--
-- In real life you would go further: store email already normalised (citext, or lower() on write)
-- so the question never arises, and so the UNIQUE constraint is case-insensitive too.
CREATE INDEX idx_d3 ON users (lower(email));
