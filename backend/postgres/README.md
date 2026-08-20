# Postgres depth ⭐⭐⭐⭐⭐⭐

Nine labs against **a real Postgres with 1.1M rows and no indexes except the primary keys**. Every
index in this course is one you add yourself, and every lab prints the plan and the buffer counts
before and after.

```sh
cd backend
npm install
npm run up          # docker compose: postgres on :5433, redis on :6380
npm run seed        # ~15s. Add --big for 2M orders if you want harsher numbers
node postgres/labs/02-explain-analyze/lab.mjs
```

`npm run reset` wipes and re-seeds — do that between labs that create indexes, or run each lab's
`--clean`.

## Labs teach; **drills** test

The labs are demonstrations: run one and it prints plans with commentary. That is not the same as
solving something, so this course also has **[drills](drills/)** — seven problems with
machine-checked answers:

```sh
node postgres/drills/run.mjs        # all 7. They all fail — that is the starting state.
node postgres/drills/run.mjs 03     # one
node postgres/drills/run.mjs 03 --solution   # the reference, when you are stuck
```

You edit `solution.sql`. The runner drops every non-constraint index first (so you cannot pass on
a previous lab's work), applies your DDL, and asserts things you cannot fake — *no Seq Scan*,
*buffers ≤ N*, *Heap Fetches = 0*, *row estimate within 1.5×*, *index under 512 kB*, *exactly one
new index*, *and these two other queries must also avoid a Seq Scan*.

### The drills

| | | The starting state |
|---|---|---|
| 01–07 | indexing | missing, unusable, over-wide and over-many indexes |
| 08–10 | concurrency & N+1 | lost updates, a queue that serialises, 101 queries |
| **11** | **Zero-downtime migration** | the one-liner blocks writes for **1,310ms** and loses **249 rows** written during it |
| **12** | **JSONB at speed** | **26,748 buffers** per session lookup → 19 |
| **13** | **Search that scales** | full text **17,740 → 102 buffers**; fuzzy 16,668 → 4,905 |
| **14** | **Advanced SQL** | the report is five round trips and a loop in JavaScript |

**Do the drills before the labs** if you like being thrown in. Do the labs first if you'd rather
see the mechanism named before you're asked to use it.

---

## Why this course exists

Backend performance is not a mystery. It is almost always one of four things, and Postgres will tell
you which if you ask it properly:

| Symptom | Usually |
|---|---|
| one query is slow | a missing or unusable index — [lab 03](labs/03-indexing/) |
| the app is slow but every query is fast | **N+1** — [lab 08](labs/08-n-plus-1-and-orms/) |
| it is fast in dev and slow in prod | different statistics, different data volume, a cold cache |
| it is fast alone and slow under load | locking or pool exhaustion — labs [06](labs/06-transactions-and-locking/) and [09](labs/09-pooling-and-replicas/) |

## Curriculum

| # | Lab | Question it answers | ⭐ |
|---|---|---|---|
| 01 | Schema & migrations — **[drill 11](drills/11-zero-downtime-migration/)** | What shape, and how do I change it with no downtime? | ⭐⭐⭐⭐⭐ |
| 02 | [EXPLAIN ANALYZE](labs/02-explain-analyze/) | How do I *read* a plan? | ⭐⭐⭐⭐⭐⭐ |
| 03 | [Indexing](labs/03-indexing/) | Which index, which column order, and when does one hurt? | ⭐⭐⭐⭐⭐⭐ |
| 04 | Advanced SQL — **[drill 14](drills/14-advanced-sql/)** | CTEs, window functions, lateral joins, upserts | ⭐⭐⭐⭐⭐ |
| 05 | JSONB & search — **[drill 12](drills/12-jsonb-at-speed/)** + **[13](drills/13-search-that-scales/)** | Do I need Elasticsearch? | ⭐⭐⭐⭐ |
| 06 | [Transactions & locking](labs/06-transactions-and-locking/) | Isolation levels, deadlocks, and the lost update | ⭐⭐⭐⭐⭐⭐ |
| 07 | [Partitioning, matviews & NOTIFY](labs/10-partitioning-and-notify/) | Big tables, and push instead of poll | ⭐⭐⭐⭐ |
| 08 | [N+1 & ORM traps](labs/08-n-plus-1-and-orms/) | Why 500 fast queries beat one slow one — and lose | ⭐⭐⭐⭐⭐⭐ |
| 09 | [Pooling & read replicas](labs/09-pooling-and-replicas/) | Why 95 connections is slower than 4 | ⭐⭐⭐⭐⭐ |

## The dataset

| Table | Rows | Shaped so that |
|---|---|---|
| `users` | 50,000 | `prefs` is JSONB with a nested object and an array |
| `products` | 5,000 | `description` is prose, for full-text search |
| `orders` | 200,000 | `status` is 70% `delivered` (partial indexes win); `created_at` is recency-skewed |
| `order_items` | ~500,000 | a composite primary key, and the join that produces N+1 |
| `events` | 400,000 | append-only and time-ordered, for partitioning and window functions |

**2% of users own a disproportionate share of orders.** That skew is deliberate: it's what makes the
planner's row estimates wrong in interesting ways, and it's what real data looks like.

## How to read every lab

Each one prints a table like this, and the second column is the one that matters:

```
  plan              exec ms  scan      buffers read  buffers hit
  no index          19.14    SEQ SCAN  0             6767
  created_at index   0.07    index     6             100
```

**Buffers, not milliseconds.** A millisecond figure on a warm laptop is a fiction — production has a
cold cache, a busy disk and other queries competing. **Buffers touched is the number that survives
the trip to production**, and it's why every helper in [`lib/db.mjs`](../lib/db.mjs) reports it.

`shared hit` = served from Postgres's buffer cache. `shared read` = went to the OS (and possibly the
disk). A query that touches 6,767 buffers to return 50 rows is doing something wrong no matter how
fast it looks on your machine.
