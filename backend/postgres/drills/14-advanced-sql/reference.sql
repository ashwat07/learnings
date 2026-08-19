-- Drill 14 — reference.

WITH country_revenue AS (
  SELECT u.country, sum(o.total_cents) AS revenue
  FROM orders o JOIN users u ON u.id = o.user_id
  WHERE o.status = 'delivered'
  GROUP BY u.country
), top_countries AS (
  -- rank() OVER (ORDER BY ...) numbers the countries without collapsing them. Note it is
  -- computed BEFORE the LIMIT — window functions run after WHERE and GROUP BY but before
  -- ORDER BY/LIMIT, which is exactly why you can rank the whole set and then take the top 5.
  SELECT country, revenue, rank() OVER (ORDER BY revenue DESC) AS country_rank
  FROM country_revenue
  ORDER BY revenue DESC
  LIMIT 5
)
SELECT tc.country,
       tc.country_rank,
       t.name,
       t.spend,
       round(100.0 * t.spend / tc.revenue, 2) AS pct_of_country,
       t.user_rank
FROM top_countries tc
-- LATERAL: this subquery runs ONCE PER ROW of top_countries and can see tc.country. That
-- reference is what a plain subquery in FROM cannot do, and it is what turns "top 3 per group"
-- from a procedural loop into one statement. CROSS JOIN LATERAL is an inner join; use
-- LEFT JOIN LATERAL ... ON true if a group might have no rows and you still want the group.
CROSS JOIN LATERAL (
  SELECT u.name,
         sum(o.total_cents) AS spend,
         -- A window function OVER an aggregate. The aggregate collapses to one row per user;
         -- the window then ranks those rows. Windows are evaluated after aggregation, which is
         -- why `rank() OVER (ORDER BY sum(...))` is legal and `WHERE rank() < 3` is not — a
         -- window cannot be filtered in WHERE, because WHERE runs first. That is what the LIMIT
         -- is doing here, and in the general case you wrap it in another subquery and filter
         -- outside.
         rank() OVER (ORDER BY sum(o.total_cents) DESC) AS user_rank
  FROM orders o
  JOIN users u ON u.id = o.user_id
  WHERE u.country = tc.country
    AND o.status = 'delivered'
  GROUP BY u.id, u.name
  ORDER BY spend DESC
  LIMIT 3
) t
ORDER BY tc.country_rank, t.user_rank

-- ---------------------------------------------------------------------------
-- THE REST OF THE VOCABULARY, WITH THE CASE FOR EACH
--
-- UPSERT — the only correct way to "insert or update" under concurrency. A SELECT then INSERT is
-- a race with a window between the two, and the failure is a duplicate key error under load:
--
--     INSERT INTO daily_totals (day, country, cents) VALUES ($1, $2, $3)
--     ON CONFLICT (day, country)
--     DO UPDATE SET cents = daily_totals.cents + EXCLUDED.cents
--     RETURNING *;
--
--   EXCLUDED is the row you tried to insert. `DO NOTHING` is the idempotency primitive — see
--   caching-and-queues drill 03. The conflict target must match a UNIQUE constraint or index.
--
-- RUNNING TOTALS AND COMPARISONS TO THE PREVIOUS ROW — the query people export to a spreadsheet:
--
--     SELECT day, revenue,
--            sum(revenue) OVER (ORDER BY day) AS running_total,
--            revenue - lag(revenue) OVER (ORDER BY day) AS change_from_yesterday,
--            avg(revenue) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS ma7
--     FROM daily;
--
--   The frame clause (ROWS BETWEEN ...) is the part almost nobody learns, and it is what turns a
--   window function into a moving average. Default frame is RANGE UNBOUNDED PRECEDING TO CURRENT
--   ROW, which behaves differently from ROWS when there are TIES in the ORDER BY — a classic
--   silent wrong answer.
--
-- DISTINCT ON — Postgres-specific, and the shortest "latest row per group" there is:
--
--     SELECT DISTINCT ON (user_id) user_id, created_at, status
--     FROM orders ORDER BY user_id, created_at DESC;
--
--   The ORDER BY must start with the DISTINCT ON columns. Faster than a window function for this
--   one shape, and unavailable in most other databases.
--
-- FILTER — a conditional aggregate that reads like English:
--
--     count(*) FILTER (WHERE status = 'pending') AS pending,
--     count(*) FILTER (WHERE status = 'delivered') AS delivered
--
--   Cleaner than sum(CASE WHEN ... THEN 1 ELSE 0 END), and it is standard SQL.
--
-- A RECURSIVE CTE, for a tree or a graph — categories, org charts, threaded comments:
--
--     WITH RECURSIVE tree AS (
--       SELECT id, parent_id, name, 1 AS depth FROM categories WHERE parent_id IS NULL
--       UNION ALL
--       SELECT c.id, c.parent_id, c.name, tree.depth + 1
--       FROM categories c JOIN tree ON c.parent_id = tree.id
--     ) SELECT * FROM tree;
--
--   Always bound the depth. A cycle in your data is an infinite loop in your database.
--
-- WHEN NOT TO DO THIS
-- SQL this dense is harder to review, harder to unit test, and invisible to your APM. Push work
-- into the database when it REDUCES data — an aggregate, a top-N, a join that filters. Keep it
-- in the application when the logic is a business rule that will change, or when the query
-- returns roughly what it read. The test is not "can SQL do this", it is "does doing it here
-- move less data and change less often".
