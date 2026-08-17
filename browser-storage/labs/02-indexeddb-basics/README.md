# Lab 02 — IndexedDB basics ⭐⭐⭐⭐⭐

**Goal:** know the model — stores, keys, indexes, transactions, versions — well enough that any
wrapper (idb, Dexie, RxDB) is obviously just a wrapper.

**Primary metric:** you can write the query for any of the six shapes below without looking it up.

> Open <http://localhost:8080/browser-storage/labs/02-indexeddb-basics/> with Application →
> IndexedDB open beside it.

---

## The model

```
database (name + version)
  └── object store          ← like a table; keyPath or explicit keys; auto-increment optional
        ├── records         ← structured-clone values: objects, Dates, Blobs, ArrayBuffers, Maps
        └── indexes         ← a second sorted structure: indexed value → primary key
              ├── unique?
              └── multiEntry?   (one entry per array element)

transaction (scope = list of stores, mode = readonly | readwrite | versionchange)
```

Four things that are unlike SQL and catch people:

1. **Schema changes only happen in `onupgradeneeded`**, inside a `versionchange` transaction.
   There is no "create an index when I first need it". Bump the version, migrate forward.
2. **No query planner, no joins.** One index per query. "Tagged `ml` *and* on `team-7`" means
   querying one index and filtering the rest in JavaScript.
3. **Keys have a defined type order**: number < date < string < binary < array. That's why a
   compound key `[team, score]` supports "team = X, score between A and B" but not "score
   between A and B, any team" — the same left-prefix rule as a SQL composite index.
4. **Transactions auto-commit.** See below; this is *the* IndexedDB bug.

## Do this

Create → seed → then run every query button and read the explanation:

| Query | API |
|---|---|
| by primary key | `store.get(key)` |
| all in an index | `store.index('by_team').getAll('team-7')` |
| a range | `IDBKeyRange.bound(800, 900, false, true)` |
| first N, descending | `openCursor(null, 'prev')` and stop |
| array membership | a `multiEntry` index |
| uniqueness constraint | `{ unique: true }`, and note it aborts the whole transaction |

## The auto-commit trap

A transaction lives only while it has **pending requests**. The moment control returns to the
event loop with nothing outstanding, it commits.

```js
// BROKEN — the transaction commits during the first await
const tx = db.transaction('people', 'readwrite');
const store = tx.objectStore('people');
for (const item of items) {
  await fetchSomething();      // ← not an IDB request: transaction goes inactive and commits
  store.put(item);             // ← TransactionInactiveError
}

// CORRECT — and ~10× faster (lab 03)
const tx = db.transaction('people', 'readwrite');
const store = tx.objectStore('people');
for (const item of items) store.put(item);    // fire every request
await done(tx);                               // await the COMMIT, not each request
```

Rule: **inside a transaction, only ever await IndexedDB requests.** Anything else — a fetch, a
timer, a `structuredClone` of something huge — ends it.

Run the **transaction scope** demo and watch the second `put` throw.

## Migrations

```js
openDB('app', 3, (db, oldVersion, newVersion, tx) => {
  if (oldVersion < 1) { /* create stores */ }
  if (oldVersion < 2) { /* add an index */ }
  if (oldVersion < 3) { /* backfill a field */ }
});
```

Forward-only steps, keyed on `oldVersion`. Two warnings:

- **Data migrations run inside the versionchange transaction**, so backfilling a million records
  blocks the database from opening — the app appears to hang on startup. For large migrations,
  write a new store alongside the old and migrate lazily in the background.
- **Multi-tab**: a `versionchange` open is *blocked* while another tab holds an older version
  open. Handle `blocked` (tell the user), and set `db.onversionchange = () => db.close()` on
  every connection so other tabs step aside. Without it a user with two tabs never receives your
  migration — silently, forever. Run the **blocked** demo with two tabs.

## Think about

- Why does IndexedDB use structured clone rather than JSON?
- You need "all people on team-7 with score > 800". How do you do it, and what's the cost?
- When would you use an auto-incrementing key instead of a `keyPath`?

<details>
<summary>Answers</summary>

**Structured clone.** It stores `Date`s as dates, `Blob`s as blobs, `ArrayBuffer`s as binary,
`Map`/`Set` as themselves. JSON would force stringification (main-thread cost, lossy for dates,
impossible for binary without base64). It also means the same caveat as `postMessage`: class
instances lose their prototype, functions throw.

**Compound query.** Either (a) a compound index on `[team, score]` and range over
`[['team-7', 800], ['team-7', Infinity]]` — one seek, best; or (b) query `by_team` and filter in
JS — fine for tens of results, wasteful for thousands. There's no planner, so the index design
*is* the query plan.

**Auto-increment.** When records have no natural key: a log, an outbox queue, an event stream.
For anything with a server-side id, use that as the `keyPath` — it makes sync idempotent, which is
the whole game in lab 06.
</details>

---

## 🏗️ Build challenge: a typed store layer

Wrappers hide IndexedDB's sharp edges — and its capabilities. Build one that hides only the
former.

```js
const people = defineStore('people', {
  keyPath: 'id',
  indexes: { by_team: 'team', by_score: 'score', by_team_score: ['team', 'score'] },
  migrations: [
    (db) => db.createObjectStore('people', { keyPath: 'id' }),
    (db, tx) => tx.objectStore('people').createIndex('by_team_score', ['team', 'score']),
  ],
});

await people.put(record);
await people.where('by_team_score').between(['team-7', 800], ['team-7', Infinity]).toArray();
```

Requirements:

1. Declarative schema → generated `onupgradeneeded` steps, keyed on `oldVersion`.
2. A query builder over `IDBKeyRange` (`equals`, `above`, `below`, `between`, `startsWith` for
   string keys) that **fails loudly** when a query can't be served by an index rather than
   silently falling back to a full scan. Silent scans are how IndexedDB apps get slow.
3. `blocked` and `versionchange` handled correctly, with a callback so the app can prompt the user.
4. A `batch()` that runs many operations in one transaction, and throws a clear error if you try
   to await a non-IDB promise inside it (wrap the callback and detect it).
5. Works in a worker as well as on the main thread — no DOM assumptions.

**Done when:** your layer can express every query in this lab, refuses an unindexed one with a
message naming the index you'd need, and survives the two-tab migration test.

---

## Interview questions

1. When can you create an object store or index?
2. What ends an IndexedDB transaction?
3. What's a `multiEntry` index for, and what does it cost?
4. How do you query "team X, score between A and B" efficiently?
5. Two tabs are open and you ship a schema migration. What happens, and what do you have to code?
6. Why is a unique-constraint violation more disruptive than a single failed write?
