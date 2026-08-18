# Lab 08 — N+1 and the ORM traps ⭐⭐⭐⭐⭐⭐

**Goal:** find the bug that never appears in a slow-query log.

**Primary metric:** queries per request.

```sh
node postgres/labs/08-n-plus-1-and-orms/lab.mjs
```
> Then solve it yourself: [drill 10](../../drills/10-kill-the-n-plus-1/).

---

## The measurement

| Approach | Queries | Median |
|---|---|---|
| N+1 | **101** | 45.0ms |
| batched (`= ANY($array)`) | 3 | 2.9ms |
| single query (`LATERAL` + `json_agg`) | 1 | 1.5ms |

**30×, and not one of the 101 queries is slow.** That's what makes N+1 so hard to find: your
slow-query log is empty, your APM shows a slow endpoint containing no slow query, and every index is
already correct.

**Where the time goes:** each query is a full round trip — serialise, syscall, network, parse, plan,
execute, serialise back, deserialise. Even on localhost that's ~0.1–0.3ms of pure overhead; against a
database in another AZ it's 1–2ms.

Which is why **N+1 is worse in production than in development**. Your laptop has 0.05ms of latency to
a container; production has 1ms to another host. The bug scales with the network you didn't have
while developing.

## How to see it

1. **Count queries per request.** One counter in your DB wrapper, logged with the request. An
   endpoint doing 300 queries is a bug regardless of how fast each one is. **This single metric finds
   more N+1 than any profiler.**
2. **`pg_stat_statements`, sorted by `calls`** — not by time. A query called 400,000 times at 0.2ms
   is 80 seconds of database time and will never appear in a "slowest queries" list.
3. **In the plan:** a Nested Loop whose inner side shows `loops=50`.
4. **In tests:** assert the query count. A test that fails when an endpoint goes from 3 queries to 53
   catches the regression on the day someone adds a lazy association.

## The ORM traps

| Trap | Looks like | Fix |
|---|---|---|
| lazy loading in a loop | `orders.forEach(o => o.user.name)` | eager load |
| eager loading **everything** | deeply nested `include` | load what the response needs |
| **the JOIN explosion** | one JOIN per collection | batch separately, or `json_agg` in a LATERAL |
| `SELECT *` | `findMany()` with no `select` | select what you serialise — it also enables index-only scans |
| `count()` per page | on every page load | keyset pagination, or an approximate count |
| `OFFSET 10000` | page 200 | keyset |
| a transaction per row | `for (row of rows) await tx(...)` | one transaction, or one statement |
| the ORM inside a migration | `model.update()` over 2M rows | one `UPDATE ... FROM`, batched by id range |

### The JOIN explosion

50 orders joined to their items produce **~124 rows, not 50**. Add a second collection and you get
50 × items × payments, with every order column repeated in every row.

That's why "just use one big JOIN" isn't the universal answer. Two collections on the same parent is
exactly where you want batched queries or a `LATERAL` with `json_agg`, which aggregates **before**
the join and keeps the row count at 50.

## OFFSET vs keyset

**`OFFSET` doesn't skip work — it fetches and discards every row it skips.** Page 5,000 reads 100,000
rows to return 20, and it gets worse the deeper you go.

```sql
WHERE (created_at, id) < ($last_created_at, $last_id)
ORDER BY created_at DESC, id DESC
LIMIT 20
```

Constant time at any depth, **and correct under concurrent inserts** — `OFFSET` silently skips or
repeats rows when data shifts between page loads. The cost is no random access to page N, which
almost no real interface needs and infinite scroll needs least of all. Include the tiebreaker (`id`)
or rows with equal timestamps get skipped.

## Think about

- Your ORM's eager loading fixed the N+1 and the endpoint got slower. What happened?
- When is N+1 acceptable?
- Why does query count matter more than query time?

<details>
<summary>Answers</summary>

**Eager loading made it slower.** Almost certainly the JOIN explosion: eager-loading two
collections multiplies the rows, so the database returns (and the driver deserialises) tens of
thousands of rows with every parent column repeated. The fix is per-collection batching — most ORMs
have a strategy option (`separate: true`, `preload` vs `joins`) that issues one extra query instead
of widening the join.

**When N+1 is acceptable.** When N is genuinely small and bounded (a detail page fetching one
order's three relations), or when the extra queries are all cache hits. The danger is that "N is
small" is a property of today's data — the endpoint that did 3 queries in staging does 3,000 for your
largest customer. Bound it explicitly or batch it.

**Query count over query time.** Because time is dominated by *round trips* at typical scale, and
because query count is a leading indicator you can assert on in a test. A 20% regression in query
time is invisible; a jump from 3 to 53 queries is unambiguous, and it's the change that actually
takes endpoints down.
</details>

---

## 🏗️ Build challenge

1. Add a per-request query counter and log it. Sort your endpoints by it — the list will surprise
   you.
2. Take the worst one and convert it to batched loading. Measure p95 before and after.
3. Add `pg_stat_statements` and find your top 10 by `calls`.
4. Write a test that asserts the query count for your three most important endpoints.
5. Convert one deep-paginated list to keyset pagination.
6. Audit for `SELECT *` in hot paths — replacing it can enable an index-only scan
   ([lab 03](../03-indexing/)).

**Done when:** query count per request is a metric on a dashboard, with an alert.

---

## Interview questions

1. What is N+1 and why doesn't it show up in a slow-query log?
2. Why is it worse in production than locally?
3. What's the JOIN explosion, and when does "one big JOIN" stop working?
4. Why is `OFFSET 100000` slow, and what replaces it?
5. How would you catch an N+1 regression in CI?
