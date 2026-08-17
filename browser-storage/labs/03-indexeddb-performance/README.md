# Lab 03 — IndexedDB performance ⭐⭐⭐⭐⭐

**Goal:** know why an IndexedDB write of 100k records takes either 2 seconds or 90, and which
line of code decides it.

**Primary metric:** records/second, and worst frame.

> Open <http://localhost:8080/browser-storage/labs/03-indexeddb-performance/>

---

## The one that matters

```js
// A — the natural shape with a promise wrapper. Opens ONE TRANSACTION PER RECORD.
for (const row of rows) await store.put(row);

// C — one transaction, requests fired without awaiting, await the COMMIT.
const tx = db.transaction('rows', 'readwrite');
const store = tx.objectStore('rows');
for (const row of rows) store.put(row);
await done(tx);
```

Typically **20–60× apart**. A transaction has a fixed cost — setup, scheduling, and a commit that
may involve an fsync. A pays it per record; C pays it once and lets the requests pipeline.

The trap is that A *looks* more correct: it awaits, it handles each result, it reads like every
other async loop you've written.

## Measure it

| Write strategy | Records | ms | records/s | Worst frame |
|---|---|---|---|---|
| A. await each put (20k) | | | | |
| B. explicit transaction per put (20k) | | | | |
| C. one transaction (100k) | | | | |
| D. chunked, 10k (100k) | | | | |
| E. from a worker (100k) | | | | |

| Read | ms | Notes |
|---|---|---|
| `getAll()` | | |
| cursor over everything | | |
| index seek | | |
| full scan + filter in JS | | |
| `count()` | | |
| `getAllKeys()` | | |

## The rules that fall out

**Writes**

1. **One transaction, many requests.** Never `await` per record.
2. **Chunk large imports** (5k–50k) if you want progress reporting and partial-failure recovery.
   You lose atomicity — decide deliberately.
3. **Every index costs write time.** Run the write test with 0 and 6 indexes and compare. Index
   for the queries you actually make, not the ones you might.
4. **The clone happens on your thread.** IndexedDB is async, but structured-cloning your values
   into it is synchronous on the calling thread. That's the main reason to put a data layer in a
   worker — the serialisation, not the I/O.

**Reads**

1. **`getAll()` beats a cursor** for "everything that fits" — one round trip instead of one per
   record. Use `getAll(query, count)` for a first page.
2. **Cursors** are for: first-N-then-stop, updating while walking, or result sets too big for
   memory.
3. **`getAllKeys()`** never deserialises values — perfect for "which of these 5,000 ids do I
   already have?" (which is the core of any sync algorithm).
4. **Never scan-and-filter.** The most common IndexedDB performance bug: a readable `.filter()`
   that reads and deserialises every record. Fine at 500 records, a multi-second freeze at
   100,000, and the fix is a schema change.

## Think about

- Why is `count()` so much faster than `getAll().length`?
- You need to import 500,000 records on first launch. Design it.
- Your app scans 200k records on every keystroke to filter a list. What's the fix, and what does
  it cost you?

<details>
<summary>Answers</summary>

**`count()`.** It's answered from the store's internal structure without reading or deserialising
any record. `getAll().length` materialises every record in memory just to count them. The same
applies to `index.count(range)` for "how many match?" questions.

**500k import.** Chunk it (10k–25k), do it in a worker, show progress, make it resumable (record
the last committed chunk so a refresh doesn't restart), and consider whether the first screen
needs all of it — usually you can import the first page synchronously and the rest in the
background. Also check the source format: 500k records of JSON is often better delivered as one
compressed payload the worker parses once.

**Scan on every keystroke.** Add an index on the field being filtered, and use a key range
(`IDBKeyRange.bound(prefix, prefix + '￿')` for prefix search). Costs: write time, disk, and a
version bump to add the index. If the search is fuzzy/full-text, IndexedDB can't do it — build an
inverted index yourself in a store, or keep a search index in memory in a worker (lab 04 of the
web-workers course is exactly this shape).
</details>

---

## 🏗️ Build challenge: a benchmark you can defend

Storage performance advice on the web is mostly folklore, and it's browser- and
device-dependent. Build the measurement instead.

`idb-bench.mjs` (or a page — but make it automatable):

1. Sweep: record count (1k → 500k), record size (100B → 100KB), index count (0 → 6), chunk size,
   worker vs main thread. Report records/s and worst-frame for each cell.
2. Run each configuration **N times, report median and p90**, and discard the first run (cold
   caches and JIT warm-up will otherwise dominate).
3. Measure **read paths** too: `get` by key, index seek, `getAll`, cursor, `getAllKeys`, count.
4. Run it in Chrome, Firefox and Safari, and publish a table of the differences. There *are* big
   ones — Safari's IndexedDB has historically had very different performance characteristics, and
   any advice that doesn't say which browser it was measured in is unusable.
5. Automate it with Playwright so it can run in CI against a real browser, and gate on a
   regression threshold.

**Done when:** you can answer "what's the fastest way to write 100k records in Safari?" with your
own numbers, and you've found at least one piece of common internet advice your data contradicts.

---

## Interview questions

1. Why is `await store.put(x)` in a loop so slow?
2. What ends an IndexedDB transaction, and why does that make the fast version look wrong?
3. Where does the CPU cost of an IndexedDB write actually land?
4. `getAll()` vs a cursor — when each?
5. How would you find out whether a query is using an index?
6. What does adding an index cost?
