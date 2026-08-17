# Lab 06 — async/await traps ⭐⭐⭐⭐⭐

**Goal:** know exactly what `await` desugars to, where the ticks go, and — the part that costs
real money — when your I/O is accidentally serial.

**Primary metric:** wall time for N requests, and time-to-first-result.

> Open <http://localhost:8080/event-loop/labs/06-async-await-traps/>

---

## The concept

```js
async function f() {
  const a = await g();
  return a + 1;
}
```

desugars to roughly:

```js
function f() {
  return new Promise((resolve, reject) => {
    Promise.resolve(g()).then(a => { resolve(a + 1); }, reject);
  });
}
```

Three facts fall out of that:

1. **The body runs synchronously until the first `await`.** Calling an async function is not
   "starting a background job" — it's a normal call that happens to return a promise.
2. **`await` resumes in a microtask.** The browser cannot render between the code before and
   after an `await` on an already-resolved value. (Lab 02 is what that costs you.)
3. **`await` in a loop serialises.** Each iteration waits for the previous one to *complete*,
   including its network round trip. Ten 200ms requests take 2 seconds instead of 200ms.

The third one is the expensive one, and it is invisible in code review because the code looks
clean.

## The puzzle (do this before running anything)

Write down the exact output order:

```js
async function async1() { console.log('async1 start'); await async2(); console.log('async1 end'); }
async function async2() { console.log('async2'); }
console.log('script start');
setTimeout(() => console.log('setTimeout'), 0);
async1();
new Promise(resolve => { console.log('promise executor'); resolve(); })
  .then(() => console.log('promise then'));
console.log('script end');
```

<details>
<summary>Answer</summary>

```
script start
async1 start
async2
promise executor       ← the executor is SYNCHRONOUS
script end
async1 end             ← queued first, so it resumes first
promise then
setTimeout
```

The two that catch people: the `new Promise` executor body runs immediately (it is not deferred),
and `async1 end` beats `promise then` because `async1` suspended before the promise was created.
</details>

## Tick counting

Run demo 2. You should see something like:

| Construct | Ticks | Why |
|---|---|---|
| `await 1` (non-promise) | 1 | wrapped in a resolved promise |
| `await Promise.resolve(1)` | 1 | V8 fast path since 2018 (it used to be 3) |
| `await {then(r){r(1)}}` (thenable) | 2–3 | the engine must call `.then()` as a separate job |
| `return p` in an async fn | +2 vs below | resolving a promise *with* a promise takes an extra unwrap |
| `return await p` in an async fn | baseline | |

The practical takeaway is not "count your ticks" — it's:

- **`return await p` is not redundant.** It resolves sooner *and* keeps the function in the stack
  trace when `p` rejects. (`no-return-await` was removed from ESLint's recommended set for
  exactly this reason.)
- **Avoid thenables.** A custom thenable costs an extra job and breaks the fast path.

## The one that actually matters

Run **5a. sequential** and **5b. Promise.all** with 10 items × 200ms.

| Strategy | Total | First result | Notes |
|---|---|---|---|
| 5a. sequential `await` in a loop | ~2000ms | ~200ms | N × latency |
| 5b. `Promise.all` | ~250ms | ~250ms (all at once) | 1 × latency, but nothing until the end |
| 5c. pooled (limit 3) | ~800ms | ~200ms | bounded, still fast |
| 5d. as-they-arrive | ~250ms | ~200ms | fastest perceived |

Then set items to 40 and run 5b again. Watch the Network panel: requests queue up anyway (Chrome
allows 6 connections per origin over HTTP/1.1, more over HTTP/2 but the server still has limits),
and your `Promise.all` is now a self-inflicted denial of service on your own API.

### Spotting it in code review

```js
// serial, and it's not obvious
for (const id of ids) results.push(await fetchOne(id));

// serial in disguise — the second await can't start until the first resolves
const user = await getUser(id);
const prefs = await getPrefs(id);          // does not depend on `user`!

// concurrent
const [user, prefs] = await Promise.all([getUser(id), getPrefs(id)]);
```

The rule: **two awaits in a row with no data dependency between them is a bug.** Look for it every
time you see back-to-back `await` lines.

## Fix it yourself

- [ ] **`pooled(n, onEach)`** — keep exactly 3 requests in flight at all times. Not batches of 3
      (a batch waits for its slowest member); a true pool starts a new request the instant one
      finishes.
- [ ] **`stream(n, onEach)`** — start all requests, but process each result the moment it lands
      so the first row renders after ~1× latency.

Constraints: results must be reported in a defined order (document which — arrival order or index
order — and make it deliberate), and an error in one request must not silently drop the others.

<details>
<summary>Hint — a real pool, not a batcher</summary>

```js
async function pooled(items, limit, work) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;                       // claim an index, synchronously
      results[i] = await work(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}
```

`limit` workers each pull from a shared cursor. The cursor increment is synchronous, so no two
workers can claim the same index — this is the one place where "JavaScript is single-threaded"
saves you from needing a mutex.
</details>

<details>
<summary>Hint — as-they-arrive</summary>

```js
async function stream(n, onEach) {
  const promises = Array.from({ length: n }, (_, i) =>
    fetch(url(i)).then(r => r.json()).then(v => onEach(i, v)));
  await Promise.allSettled(promises);        // start them all now, handle each as it lands
}
```

The key is that `fetch()` is called *eagerly* in the map — creating the promise starts the
request. `Promise.all` doesn't start anything; it only waits.

For an ordered stream with backpressure, an async generator with a pool behind it is the grown-up
version — that's the build challenge.
</details>

---

## 🏗️ Build challenge: `async-pool.js`

```js
for await (const { index, value, error } of poolMap(urls, fetchJson, { limit: 6, signal })) {
  render(index, value);          // arrives as soon as it's ready
}
```

Requirements:

1. Constant concurrency (`limit` in flight at all times), constant memory — do not materialise all
   promises up front if the input is an async iterable of unknown length.
2. Yields results **as they arrive**, but also offers `poolMap(..., { ordered: true })` which
   yields in input order while still running out of order underneath.
3. `AbortSignal` support: aborts in-flight work, stops pulling from the source, rejects the
   iterator.
4. Errors: one failure must not kill the run. Yield `{ error }` entries and let the caller decide;
   provide `{ stopOnError: true }` for the other case.
5. Backpressure: if the consumer is slow (`for await` with a slow body), do not keep fetching
   ahead beyond `limit`.
6. Zero unhandled rejections in any path — including abort-during-flight. Verify with a
   `window.addEventListener('unhandledrejection')` assertion in your tests.

Benchmark against the naive versions with 100 URLs at 200ms each:

| | total | first result | peak in-flight |
|---|---|---|---|
| sequential | | | 1 |
| `Promise.all` | | | 100 |
| `poolMap(limit: 6)` | | | 6 |

**Done when:** the pool version's total time is within 10% of `(100/6) × 200ms`, its first result
lands at ~200ms, and aborting mid-run produces exactly zero unhandled rejections.

---

## Interview questions

1. Does calling an `async` function start any work before the first `await`? Prove it.
2. Why is `return await p` not redundant inside a `try` block — and is it redundant outside one?
3. `items.forEach(async item => await save(item))` — describe precisely what happens, in order.
4. You see `const a = await getA(); const b = await getB();`. What's your first question?
5. `Promise.all` rejects on the first failure. What happens to the other seven requests?
6. How would you implement `Promise.all` yourself, including the "reject on first failure but
   don't leak" behaviour?
