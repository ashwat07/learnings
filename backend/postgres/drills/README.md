# Postgres drills — problems, not demonstrations

The labs *show* you things. These are **problems with machine-checked answers**.

```sh
cd backend
npm run up && npm run seed          # once
node postgres/drills/run.mjs        # all 7 — they all fail, that is the starting state
node postgres/drills/run.mjs 03     # one
node postgres/drills/run.mjs 03 --solution    # the reference answer, when you are stuck
```

You edit **`solution.sql`** in each drill folder. The runner drops every non-constraint index first
(so you can't pass on someone else's work), applies your DDL, runs the drill's query, and asserts
things you cannot fake.

---

## What gets checked

| Assertion | Why it's not fakeable |
|---|---|
| `no Seq Scan on orders` | read from the actual plan |
| `buffers <= N` | from `EXPLAIN (ANALYZE, BUFFERS)` — the number that survives production |
| `plan contains Index Only Scan` | node type, from the plan tree |
| `Heap Fetches <= 0` | proves the visibility map was used |
| `row estimate within 1.5x` | planned vs actual rows |
| `your index is under 512 kB` | `pg_relation_size` |
| `exactly one new index` | counted in `pg_stat_user_indexes` |
| `also serves: <another query>` | a second and third query must *also* avoid a Seq Scan |

The thresholds are set so that **a plausible-but-wrong answer fails**. Drill 04 is the clearest
example: a full index on `(status, created_at)` passes the speed check and fails the size check,
because the point of that drill is the partial index.

## The ten

**Index drills** — you write DDL in `solution.sql`:

| # | Drill | The idea |
|---|---|---|
| 01 | The missing index | an index filters **and** provides the order |
| 02 | Column order | equality first, then range/sort — and a colleague's index that's the wrong way round |
| 03 | The index that can't be used | `lower(email)` is a different expression from `email` |
| 04 | The job queue index | a partial index on 6% of the table |
| 05 | Answer it without touching the table | `INCLUDE` → index-only scan |
| 06 | The planner is lying | it's **not** an index — and `dependencies` alone won't do it |
| 07 | One index, not three | the leftmost-prefix rule |

**Behavioural drills** — the runner executes your statement on **several real connections at
once**, so correctness under concurrency is what's actually measured:

| # | Drill | The idea |
|---|---|---|
| 08 | Stop losing money | two concurrent withdrawals must leave 800, not 900 |
| 09 | A job queue without a broker | four workers, 20 distinct jobs, **nobody blocks** |
| 10 | Kill the N+1 | same output, ≤ 3 queries (solved in `solution.mjs`) |

Drill 09 is the sharpest of the set, because it rejects *two* different wrong answers for two
different reasons:

```
plain SELECT              → 5 distinct jobs claimed by 4 workers   FAIL (duplicates)
FOR UPDATE                → 20 distinct, 137ms max wait            FAIL (blocking)
FOR UPDATE SKIP LOCKED    → 20 distinct, 2ms max wait              PASS
```

`FOR UPDATE` alone is *correct* and still fails — because a queue where workers serialise behind
each other isn't a queue. That distinction is the whole drill.

Drill 06 is the one worth doing slowly. The obvious answer (an index) can't fix an *estimate*, and
the obvious extended-statistics answer (`dependencies`) doesn't work either, because functional
dependencies only apply to equality predicates. Only `mcv` fixes it.

## How to work a drill

1. Run it. Read the **plan line** at the bottom and the failing assertions.
2. Look at the query. Which column does it **filter** on, which does it **sort** by, which does it
   only **read**?
3. Write the DDL. Run again.
4. If a check passes but another fails, you're close — usually column order or index type.
5. Only then look at the reference. It explains *why*, not just *what*.

**Don't read the reference first.** The whole value is in the ten minutes of being wrong.
