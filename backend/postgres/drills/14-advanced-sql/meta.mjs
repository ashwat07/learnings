export const title = 'One query, not five';
export const task = `Write ONE statement that answers:

  For the 5 countries with the highest delivered revenue, give me the top 3 customers in each,
  with the country's rank, the customer's rank inside that country, and what share of the
  country's revenue that customer is.

Columns, exactly: country, country_rank, name, spend, pct_of_country, user_rank
Ordered by country_rank, then user_rank. pct is rounded to 2 decimal places.

The application version of this is five round trips and a nested loop in JavaScript. It works,
and it moves 50,000 rows across the network to produce 15. Everything you need is in SQL:

  CTEs             WITH x AS (...) — name a step so the query reads top to bottom
  window functions rank() OVER (...) — a value per ROW, computed over a GROUP, without collapsing
                   the rows the way GROUP BY does
  LATERAL          a subquery in FROM that can REFERENCE the row to its left. This is the one
                   that makes "top 3 per group" a single query.`;
export const passIf = 'the results match exactly, in one statement, using a window function';
export const query = `SELECT 1`;
export const behavioural = true;

const REFERENCE = `
WITH country_revenue AS (
  SELECT u.country, sum(o.total_cents) AS revenue
  FROM orders o JOIN users u ON u.id = o.user_id
  WHERE o.status = 'delivered'
  GROUP BY u.country
), top_countries AS (
  SELECT country, revenue, rank() OVER (ORDER BY revenue DESC) AS country_rank
  FROM country_revenue ORDER BY revenue DESC LIMIT 5
)
SELECT tc.country, tc.country_rank, t.name, t.spend,
       round(100.0 * t.spend / tc.revenue, 2) AS pct_of_country, t.user_rank
FROM top_countries tc
CROSS JOIN LATERAL (
  SELECT u.name, sum(o.total_cents) AS spend,
         rank() OVER (ORDER BY sum(o.total_cents) DESC) AS user_rank
  FROM orders o JOIN users u ON u.id = o.user_id
  WHERE u.country = tc.country AND o.status = 'delivered'
  GROUP BY u.id, u.name
  ORDER BY spend DESC LIMIT 3
) t
ORDER BY tc.country_rank, t.user_rank`;

const norm = (rows) => rows.map((r) => ({
  country: String(r.country),
  country_rank: Number(r.country_rank),
  name: String(r.name),
  spend: Number(r.spend),
  pct_of_country: Number(Number(r.pct_of_country).toFixed(2)),
  user_rank: Number(r.user_rank),
}));

export async function custom(sql, _ctx, { userSql }) {
  const statement = userSql.replace(/;\s*$/, '').trim();
  if (!statement) return [{ check: 'you wrote a query', actual: 'solution.sql is empty', pass: false }];

  const checks = [];
  checks.push({
    check: 'it is ONE statement',
    actual: statement.includes(';') ? 'several statements' : 'one',
    pass: !statement.includes(';'),
  });

  let rows, err = null;
  const t0 = performance.now();
  try { rows = await sql.unsafe(statement); } catch (e) { err = e.message.split('\n')[0]; }
  const ms = performance.now() - t0;
  if (err) return [...checks, { check: 'the query runs', actual: err.slice(0, 60), pass: false }];

  const want = norm(await sql.unsafe(REFERENCE));
  let got;
  try { got = norm(rows); } catch { got = null; }

  checks.push({ check: `returns ${want.length} rows`, actual: rows.length, pass: rows.length === want.length });

  const expectedCols = ['country', 'country_rank', 'name', 'spend', 'pct_of_country', 'user_rank'];
  const cols = rows[0] ? Object.keys(rows[0]) : [];
  const missing = expectedCols.filter((c) => !cols.includes(c));
  checks.push({ check: 'the columns are named as asked', actual: missing.length ? `missing ${missing.join(', ')}` : cols.join(', '), pass: missing.length === 0 });

  const same = got && JSON.stringify(got) === JSON.stringify(want);
  let firstDiff = '';
  if (got && !same) {
    const i = want.findIndex((w, k) => JSON.stringify(w) !== JSON.stringify(got[k]));
    firstDiff = i < 0 ? 'extra rows at the end' : `row ${i + 1}: got ${JSON.stringify(got[i])}`;
  }
  checks.push({ check: 'every value matches, in order', actual: same ? 'exact' : firstDiff.slice(0, 70), pass: !!same });

  // A GROUP BY plus a self-join can produce the right answer; the point of the drill is the
  // window function, so check the plan for one.
  const plan = await sql.unsafe(`EXPLAIN (FORMAT JSON) ${statement}`);
  const planText = JSON.stringify(plan[0]['QUERY PLAN']);
  checks.push({
    check: 'the plan contains a WindowAgg (you used a window function)',
    actual: planText.includes('WindowAgg') ? 'yes' : 'no window function in the plan',
    pass: planText.includes('WindowAgg'),
  });

  checks.push({ check: 'under 2 seconds', actual: `${ms.toFixed(0)}ms`, pass: ms < 2000 });
  return checks;
}
