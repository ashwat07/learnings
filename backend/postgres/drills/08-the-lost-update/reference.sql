-- Express the change as a DELTA and let the database apply it to the current value. Under READ
-- COMMITTED the second UPDATE waits for the first to commit, then RE-READS the row and applies
-- the subtraction to the new value. No lock management, no retry, no version column.
--
-- SELECT ... FOR UPDATE would also pass, and so would an optimistic version check — but this is
-- the cheapest correct answer, and the one people skip because it looks too simple.
UPDATE drill_accounts SET balance = balance - 100 WHERE id = :id;
