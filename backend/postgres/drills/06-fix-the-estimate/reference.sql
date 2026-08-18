-- Extended statistics. Note WHICH KIND: `dependencies` only helps EQUALITY predicates, and
-- `shipped_at IS NULL` is not one — so dependencies alone leaves the estimate at ~6.7x wrong.
-- `mcv` stores the actual most-common COMBINATIONS of values, and it is what fixes this.
CREATE STATISTICS stat_d6 (dependencies, ndistinct, mcv) ON status, shipped_at FROM orders;
ANALYZE orders;
