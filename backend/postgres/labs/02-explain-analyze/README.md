# Lab 02 — EXPLAIN ANALYZE ⭐⭐⭐⭐⭐⭐

**Goal:** read a plan and find the problem in under a minute.

```sh
node postgres/labs/02-explain-analyze/lab.mjs
```

---

## A plan is a tree that executes from the leaves upward

Indented lines are children; they run first and feed their parent. Every node reports four numbers,
and you compare them **in this order**:

| # | Look at | Because |
|---|---|---|
| 1 | **actual rows vs planned rows** | if the estimate is off by 100×, every decision *above* this node was made on bad information |
| 2 | actual time | it is **cumulative** — a parent's time includes its children's |
| 3 | buffers hit / read | how much data was touched; the number that survives production |
| 4 | **loops** | a node with `loops=5000` ran 5,000 times, and its time is **per loop** |

**Always `EXPLAIN (ANALYZE, BUFFERS)`, never bare `EXPLAIN`.** Bare EXPLAIN shows what the planner
*guessed*. You want to know what happened.

## The scan types, and what each tells you

| Node | Means | Not automatically bad because |
|---|---|---|
| **Seq Scan** | read every row | for a predicate matching a large fraction, sequential I/O beats random |
| **Index Scan** | walk the index, fetch each row from the heap | but every match is a **random page read** |
| **Bitmap Heap Scan** | build a bitmap of matching *pages*, read them in **physical order** | the middle ground — converts random I/O into sequential |

Run section 2 of the lab: the same query, once as the planner chose it and once with
`SET enable_bitmapscan = off`. **Forcing the alternative is the single most useful debugging
technique in Postgres** — you can't argue with the planner, but you can ask what the other plan
would have cost. (It doesn't belong in production.)

## Join strategies

| Strategy | Good when | Watch for |
|---|---|---|
| Nested Loop | the left side is **tiny** | a big left side with no index on the right is O(n·m) |
| Hash Join | big unsorted joins | `Batches: 4` — it **spilled to disk**, `work_mem` too small |
| Merge Join | both inputs already sorted | an explicit Sort underneath means it paid for the ordering |

If a join is slow the question is almost never "which strategy" — it's **"why is the row estimate
wrong"**, because the estimate is what chose the strategy.

## The most important section: when the planner is wrong

```
statistics                             planned  actual  off by
default (columns assumed independent)     1639   11129   6.8x
+ dependencies, ndistinct                 1651   11129   6.7x
+ mcv                                    10933   11129   1.0x
```

Postgres estimates a multi-column predicate by **multiplying the selectivities**, which assumes the
columns are independent. In real data they rarely are.

**Look at the middle row.** Adding `dependencies` changed almost nothing, because functional
dependency statistics only apply to **equality** predicates and `shipped_at IS NULL` isn't one. Only
`mcv` — which stores actual most-common *combinations* — fixes it.

```sql
CREATE STATISTICS orders_stats (dependencies, ndistinct, mcv)
  ON status, shipped_at FROM orders;
ANALYZE orders;
```

Ask for all three kinds unless you have a reason not to. Almost nobody uses any of this, and it's
the highest-leverage fix for a whole class of "why did it pick a nested loop" problems.

## The checklist for any slow query

1. **actual vs planned rows at every node** — find the first divergence
2. `Seq Scan` on a big table with a selective predicate → missing index ([lab 03](../03-indexing/))
3. `loops = N` on the inner side of a Nested Loop → an N+1 **in the plan** ([lab 08](../08-n-plus-1-and-orms/))
4. `Sort Method: external merge Disk: 12MB` → `work_mem` too small; it spilled
5. `Batches: 8` on a Hash Join → the same, for hashing
6. `buffers read >> buffers hit` → cold cache, or the working set doesn't fit in `shared_buffers`
7. `Rows Removed by Filter: 4000000` → the index found rows the predicate then threw away

Two things not in the plan that catch people out: **planning time can exceed execution time** on
simple queries with many partitions or indexes; and **`EXPLAIN ANALYZE` actually runs the query**,
including the `UPDATE` — wrap it in a transaction and `ROLLBACK` if you don't mean it.

## Think about

- A node says `actual rows=1` and `loops=50000`. How much time did it take?
- Why might a Seq Scan be the *right* plan?
- Your query is fast in `psql` and slow from the app. Name three causes.

<details>
<summary>Answers</summary>

**`rows=1, loops=50000`.** The reported time is **per loop**, so multiply: a node showing 0.01ms
with 50,000 loops spent 500ms. This is exactly how an N+1 hides in a plan — each individual lookup
is instant and the total is catastrophic. Always check `loops` before concluding a node is cheap.

**When Seq Scan is right.** When the predicate matches a large fraction of the table (roughly >5–10%
depending on row width), because sequential reads are far cheaper per page than random ones, and
because an index scan on many rows means one random heap fetch per row. Also when the table is small
enough to sit in a few pages — the index lookup would cost more than reading the whole thing.

**Fast in psql, slow from the app.** (1) **Prepared statements and generic plans** — after five
executions the driver may switch to a plan built without your parameter values, which can be much
worse for skewed data (`plan_cache_mode` controls this). (2) **Different parameters** — you tested
with a value that happens to be selective. (3) **Connection-level settings**: `work_mem`,
`search_path`, or a different role with different `SET` defaults. Also check whether the app is
running it inside a transaction that holds locks, and whether it's actually the same query — ORMs
add columns and joins you didn't write.
</details>

---

## 🏗️ Build challenge

1. Turn on `auto_explain` in a staging database with `auto_explain.log_min_duration = '200ms'` and
   `log_analyze = on`. You now get plans for real slow queries without reproducing them.
2. Install `pg_stat_statements` and find your top 5 queries by **total** time — not mean time. The
   query called 200,000 times at 8ms usually matters more than the one taking 4s once a day.
3. For each, run `EXPLAIN (ANALYZE, BUFFERS)` and find the first node where estimate and actual
   diverge.
4. Add extended statistics for one correlated pair. Measure the estimate before and after.
5. Set up a plan-regression check: store the plan hash for your top queries and alert when it
   changes.

**Done when:** you can name the dominant node and the worst estimate for your five slowest queries.

---

## Interview questions

1. What does `EXPLAIN (ANALYZE, BUFFERS)` give you that `EXPLAIN` doesn't?
2. In what order do you read a plan's numbers, and why is rows-vs-planned first?
3. Bitmap Heap Scan — what problem does it solve?
4. Why does the planner underestimate correlated predicates, and what fixes it?
5. A node shows 0.02ms and `loops=100000`. What's the real cost?
