-- Key = what you filter/sort on. INCLUDE = what you only select. The heap is never touched, so
-- there is no random I/O at all: ~27,000 buffers becomes ~140.
CREATE INDEX idx_d5 ON orders (user_id) INCLUDE (total_cents);
