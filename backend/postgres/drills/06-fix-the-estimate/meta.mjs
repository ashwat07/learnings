export const title = 'The planner is lying';
export const task = `This predicate is estimated at ~1,600 rows and actually returns ~11,000 — a 7x
error, because Postgres assumes the two columns are independent and they are perfectly dependent.
Teach it the truth. (Hint: it is not an index.)`;
export const passIf = 'the row estimate is within 1.5x of reality';
export const query = `SELECT id, user_id, created_at FROM orders WHERE status = 'pending' AND shipped_at IS NULL`;
export const maxEstimateError = 1.5;
