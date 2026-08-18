# Lab 03 — Indexing in practice ⭐⭐⭐⭐⭐⭐

**Goal:** choose the right index, in the right column order, and know what it costs.

**Primary metric:** buffers touched, before and after.

```sh
node postgres/labs/03-indexing/lab.mjs
node postgres/labs/03-indexing/lab.mjs --clean     # drop what it created
```

---

## The seven experiments

Fill these in from your own run — they're the numbers you should be able to predict afterwards:

| # | Experiment | Result |
|---|---|---|
| 1 | no index → `(created_at DESC)` | ~168× faster, 6767 → 106 buffers |
| 2 | `(created_at, user_id)` vs `(user_id, created_at)` | ~99× faster, 1538 → 12 buffers |
| 3 | full index vs **partial** `WHERE status='pending'` | ~6× faster, index 264kB vs 4MB |
| 4 | plain vs **covering** `INCLUDE (...)` | **27,465 → 139 buffers** |
| 5 | expression / cast / leading wildcard | all Seq Scan |
| 6 | write cost of 5 indexes | **~6× slower**, 2.5× the disk |
| 7 | `CREATE INDEX CONCURRENTLY` | — |

## 1. An index does two jobs

It **filters**, and it **provides the order** — so an `ORDER BY` matching the index is free and the
Sort node disappears entirely.

`ORDER BY created_at DESC LIMIT 50` is the most common query shape in a web app and the most common
missing index.

## 2. Column order: equality first, then range/sort

```sql
CREATE INDEX ON orders (user_id, created_at DESC);   -- ✅ seek to the user, already ordered
CREATE INDEX ON orders (created_at DESC, user_id);   -- ❌ scan every recent order, filter by user
```

`user_id` in the second index can be used to **filter** but not to **seek**. This is the
**leftmost-prefix rule**, and it's why one well-ordered composite index usually beats three
single-column ones — `(a, b, c)` also serves queries on `(a)` and `(a, b)`.

## 3. Partial indexes

```sql
CREATE INDEX ON orders (created_at) WHERE status = 'pending';
```

Only the matching rows are in the index — here ~6% of the table, so it's a fraction of the size,
fits in cache, and costs nothing to maintain when a non-matching row is written.

**The canonical fits:** job queues (`WHERE state = 'queued'`), soft deletes (`WHERE deleted_at IS
NULL`), unprocessed outbox rows. In all three the hot query touches a tiny minority of a huge table.

## 4. Covering indexes and index-only scans

```sql
CREATE INDEX ON orders (user_id) INCLUDE (created_at, total_cents);
```

**27,465 buffers → 139.** "Index Only Scan" means Postgres answered without touching the table at
all — no heap fetch, no random I/O.

Two things people get wrong:

- **`INCLUDE` columns are not part of the key.** They can't seek or sort. Key = what you filter on;
  `INCLUDE` = what you select.
- **It still consults the visibility map.** If the table hasn't been vacuumed you'll see `Heap
  Fetches: N` and the win evaporates — which is why autovacuum tuning is a *performance* topic. The
  lab runs `VACUUM` before measuring, deliberately.

And the trade: `INCLUDE` everything "just in case" and you've duplicated the table, paid for it on
every write, and lost the cache locality you wanted.

## 5. Indexes that can't be used

| Query | Why |
|---|---|
| `lower(email) = '…'` | a function on the column |
| `email LIKE '%500@…'` | a **leading** wildcard |
| `created_at::date = current_date` | a cast on the column |

**An index is on an expression, and your query must use the same expression.** Two fixes — index the
expression (`CREATE INDEX ON users (lower(email))`) or rewrite so the column is bare:

```sql
WHERE created_at::date = current_date              -- unusable
WHERE created_at >= current_date
  AND created_at <  current_date + 1               -- sargable, and time-zone-correct
```

`LIKE 'foo%'` **can** use a B-tree (with `text_pattern_ops` under a non-C collation); `LIKE '%foo'`
never can — that's what trigram indexes are for (a trigram/GIN lab, planned).

## 6. What an index costs

```
no indexes  46ms    2968 kB
5 indexes  302ms    7360 kB
```

Every index is paid for on **every write**. An `UPDATE` that changes an indexed column pays too — and
an `UPDATE` that touches **no** indexed column may qualify for a **HOT update** and skip them
entirely, which is a real reason not to index a column you update constantly.

So the question is never "would an index help this query" but **"does this query matter more than
the write cost, and could an existing index cover it instead"**.

```sql
SELECT relname, indexrelname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid))
FROM pg_stat_user_indexes WHERE idx_scan = 0 ORDER BY pg_relation_size(indexrelid) DESC;
```

Check uptime first — `idx_scan` resets on restart, and dropping an index used only by a monthly
report is a memorable mistake.

## 7. Building without an outage

`CREATE INDEX` takes a SHARE lock and blocks every write for the whole build. `CONCURRENTLY` doesn't,
and costs you: ~2× the time, **cannot run inside a transaction** (most migration tools need explicit
handling), and on failure leaves an **invalid** index behind:

```sql
SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
```

`DROP INDEX CONCURRENTLY` exists too and is equally necessary.

## Beyond B-tree

| Type | For |
|---|---|
| **B-tree** | the default — equality, ranges, sorting, ~everything |
| **GIN** | "contains" queries: JSONB, arrays, full-text (a trigram/GIN lab, planned) |
| **GiST** | geometry, ranges, nearest-neighbour |
| **BRIN** | huge tables **physically ordered** by the column (append-only time series) — tiny, and useless if the correlation is low |
| **Hash** | equality only; rarely worth it over B-tree |

## Think about

- You have `(a)`, `(b)` and `(a, b)`. Which can you drop?
- When is a partial index better than a full one on the same column?
- Why can adding an index make an `UPDATE`-heavy table slower overall?

<details>
<summary>Answers</summary>

**Dropping redundant indexes.** `(a)` is redundant — `(a, b)` serves everything `(a)` does via the
leftmost prefix. `(b)` is **not** redundant, because a composite index can't be seeked by its second
column. So drop `(a)`, keep `(b)` and `(a, b)`. Check `idx_scan` before you do; and note the one
exception — a much smaller `(a)` may still win for index-only scans where `(a, b)` doesn't fit in
cache.

**Partial over full.** When the queries you care about always include the same predicate *and* that
predicate selects a small minority. You get a smaller index (better cache locality), cheaper writes
for non-matching rows, and — often overlooked — the ability to enforce a **partial unique
constraint**, e.g. "only one active subscription per user" as `UNIQUE (user_id) WHERE status =
'active'`.

**Index making UPDATEs slower overall.** Beyond the direct maintenance cost, indexing a
frequently-updated column disqualifies **HOT (heap-only tuple) updates**. A HOT update writes a new
row version on the same page and doesn't touch any index; once the column is indexed, every update
must write to every index and can no longer stay on-page, which increases bloat and forces more
vacuum work. Index the columns you *query*, not the ones you *churn*.
</details>

---

## 🏗️ Build challenge

1. Find every unused index in your production database (with uptime checked). Drop them in a
   reviewed migration and measure write latency before and after.
2. Take your three slowest queries and design **one composite index each**, applying equality-first.
   Check whether it makes an existing index redundant.
3. Find one query whose predicate is always the same and convert its index to a **partial** one.
   Record the size change.
4. Find one hot read-only query and make it an **index-only scan** with `INCLUDE`. Verify `Heap
   Fetches: 0`.
5. Audit for non-sargable predicates: grep your codebase for `LOWER(`, `::date`, and `LIKE '%`.
6. Make `CONCURRENTLY` the default in your migration tooling, with an invalid-index check after.

**Done when:** every index in your top table is either used by a named query or gone.

---

## Interview questions

1. What two jobs does an index do for `WHERE x = 1 ORDER BY y`?
2. Why does column order matter in a composite index?
3. When is a partial index the right choice?
4. What makes an index-only scan possible, and what silently defeats it?
5. Name three ways to write a query that can't use an index.
6. What does `CREATE INDEX CONCURRENTLY` cost you?
