# Lab 06 — Transactions, isolation & locking ⭐⭐⭐⭐⭐⭐

**Goal:** know which of the three fixes to reach for, and why stronger isolation doesn't save you
for free.

**Every experiment runs two real concurrent connections.** The lost update actually loses an update;
the deadlock is a real `40P01`.

```sh
node postgres/labs/06-transactions-and-locking/lab.mjs
```
> Then solve them: [drill 08](../../drills/08-the-lost-update/) and
> [drill 09](../../drills/09-the-job-queue/).

---

## The lost update

```
A saw 1000, wrote 900
B saw 1000, wrote 900
final balance: 900 — should be 800. ONE WITHDRAWAL VANISHED.
```

No error, no conflict, no log line. **READ COMMITTED does not prevent this** — it guarantees you
never read *uncommitted* data; it says nothing about a value changing between your `SELECT` and your
`UPDATE`.

## Three fixes, and when each is right

### A. Do the arithmetic in the database

```sql
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
```

The cheapest fix, and the one people skip because it looks too simple. Under READ COMMITTED an
`UPDATE` that finds a row locked **waits, then re-evaluates against the new committed version** —
that re-evaluation is what makes it correct.

Only works when the new value is a pure function of the old one. "Set status to shipped *if* it's
currently paid" needs B.

### B. `SELECT ... FOR UPDATE` (pessimistic)

Takes the row lock at `SELECT` time, so the second transaction blocks and then reads the new value.

| Variant | For |
|---|---|
| `FOR UPDATE` | the default choice |
| `FOR NO KEY UPDATE` | weaker; still allows FK references |
| `FOR SHARE` | many readers, no writers |
| `FOR UPDATE NOWAIT` | fail fast — "someone else is editing this" |
| **`FOR UPDATE SKIP LOCKED`** | **the job-queue primitive** |

```sql
SELECT id FROM jobs WHERE state = 'queued'
ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 10;
```

Ten workers running that get ten **disjoint** batches, with no coordination and no broker. The cost
of pessimism: the lock is held for the whole transaction, so a long transaction blocks everyone
behind it.

### C. Optimistic concurrency (a version column)

```sql
UPDATE accounts SET balance = $new, version = version + 1
WHERE id = $id AND version = $seen;   -- 0 rows affected → someone beat you, retry
```

No locks at all. Same idea as HTTP `If-Match`/ETag. **Right when conflicts are rare** — nothing
blocks, readers never wait. Wrong when they're common, because you pay for the work twice.

## Isolation levels

```
level            first read  second read  stable?
READ COMMITTED   1000        555          NO — non-repeatable read
REPEATABLE READ  1000        1000         yes
```

| Level | Gives you |
|---|---|
| **READ COMMITTED** (default) | a fresh snapshot **per statement** |
| **REPEATABLE READ** | one snapshot **per transaction** — and in Postgres this also prevents phantoms, stronger than the standard requires |
| **SERIALIZABLE** | as if transactions ran one at a time (SSI predicate locks) |

**What nobody tells you: the stronger levels don't block — they abort.** Under REPEATABLE READ or
SERIALIZABLE you *will* get `could not serialize access` (SQLSTATE **40001**) and your application
**must retry the whole transaction**. Code that doesn't handle 40001 isn't really running at that
isolation level; it just fails in production occasionally.

## Deadlocks are an ordering bug in your code

A locked row 1 then wanted row 2; B locked row 2 then wanted row 1. Postgres detected the cycle after
`deadlock_timeout` and killed a victim with **40P01**.

```js
for (const id of ids.sort((a, b) => a - b)) await tx`UPDATE ... WHERE id = ${id}`;
```

**Acquire locks in a consistent order.** That's the whole cure — deadlocks aren't something you tune
away. And *any* transaction can be the victim, so a retry for 40P01 belongs next to the one for
40001.

## The rules

| Rule | Why |
|---|---|
| keep transactions **short** | locks are held until commit; long transactions also block VACUUM |
| **never do I/O inside a transaction** | an HTTP call inside `BEGIN` holds locks for the length of someone else's outage |
| do arithmetic in SQL | removes the read-modify-write window entirely |
| lock in a consistent order | the only real cure for deadlocks |
| **retry 40001 and 40P01** | stronger isolation aborts rather than blocks |
| `FOR UPDATE SKIP LOCKED` for queues | N workers, disjoint batches, no broker |
| watch `idle in transaction` | a connection that BEGINs then waits on the app is holding everything |

```sql
SELECT pid, state, now() - xact_start AS open_for, left(query, 60)
FROM pg_stat_activity WHERE state = 'idle in transaction' ORDER BY xact_start;
```

That last one is the most common cause of "the database is locked up", and it's always an
application bug. Set `idle_in_transaction_session_timeout` so a forgotten `BEGIN` can't hold locks
forever.

## Think about

- Why doesn't READ COMMITTED prevent the lost update?
- When would you choose optimistic over pessimistic locking?
- You switched to SERIALIZABLE and now get random errors in production. What did you forget?

<details>
<summary>Answers</summary>

**READ COMMITTED and lost updates.** It only guarantees you never see uncommitted data. Both
transactions legitimately read the committed value 1000; nothing in the level says the row can't
change before your `UPDATE`, and a blind `SET balance = 900` doesn't re-check anything. The level
prevents *dirty* reads, not *stale* ones.

**Optimistic over pessimistic.** When conflicts are rare and transactions are long or involve user
think-time — an edit form, a multi-step wizard, anything where holding a lock would mean holding it
across a human. Also when reads must never block. Switch to pessimistic when you measure a high
retry rate, because at that point optimistic means doing the work twice.

**SERIALIZABLE errors.** You forgot the retry loop. SERIALIZABLE detects conflicts and **aborts one
transaction with 40001** rather than blocking — that's how it achieves serialisability without
locks. The errors aren't a bug, they're the mechanism; your code must catch 40001, back off briefly,
and re-run the whole transaction from the top (not just the failed statement, since the snapshot is
gone).
</details>

---

## 🏗️ Build challenge

1. Grep for read-modify-write: a `SELECT` followed by an `UPDATE` of the same row. Each one is a
   potential lost update.
2. Add a retry wrapper for 40001 and 40P01 with bounded attempts and jitter, and route every
   transaction through it.
3. Replace a broker-backed job queue (or a polling loop) with `FOR UPDATE SKIP LOCKED` and compare
   the operational surface.
4. Sort ids before locking in any multi-row transaction.
5. Set `idle_in_transaction_session_timeout` and alert on `idle in transaction` over 5s.
6. Find every HTTP call made inside a transaction. Move them out.

**Done when:** no transaction in your codebase spans an I/O call, and 40001/40P01 are retried
centrally.

---

## Interview questions

1. What's a lost update, and why doesn't the default isolation level stop it?
2. Name three fixes and when each is appropriate.
3. What does `SKIP LOCKED` enable?
4. What changes when you move to REPEATABLE READ or SERIALIZABLE?
5. How do you prevent deadlocks?
