# Lab 04 — Closures & caches ⭐⭐⭐⭐⭐

**Goal:** bound every cache you write, keep closures small, and know exactly what `WeakMap`,
`WeakRef` and `FinalizationRegistry` are for.

**Primary metric:** heap growth for the same workload, bounded vs unbounded.

> Open <http://localhost:8080/spa-memory-leaks/labs/04-closures-and-caches/>

---

## The two questions to ask of every cache

1. **What is the maximum number of distinct keys?**
2. **What removes an entry?**

If the answers are "unbounded" and "nothing", it's a leak with a helpful name. The dangerous keys
are always the ones derived from user input or ids — search queries, URLs, user ids, timestamps,
serialised filter objects.

A bounded LRU is eight lines, because `Map` preserves insertion order:

```js
const cache = new Map();
const get = (k) => {
  if (!cache.has(k)) return undefined;
  const v = cache.get(k); cache.delete(k); cache.set(k, v);   // touch: move to the end
  return v;
};
const put = (k, v) => {
  if (cache.has(k)) cache.delete(k);
  cache.set(k, v);
  if (cache.size > LIMIT) cache.delete(cache.keys().next().value);   // evict the oldest
};
```

Bound by **entries** when values are uniform, by **bytes** when they're not (500 entries can be
50KB or 500MB), and add a **TTL** if staleness matters more than memory.

## Map vs WeakMap

| | `Map` | `WeakMap` |
|---|---|---|
| Keys | strong | **weak** — entry vanishes when the key is collected |
| Values | strong | strong |
| Iterable | yes | no |
| `.size` | yes | no |
| Keys can be | anything | objects (and non-registered symbols) only |

`WeakMap` is exactly right for "extra data about an object I don't own": per-node state,
per-component metadata, private fields, memoisation keyed by an object argument.

Its limits are deliberate: you can't iterate or size it because its contents change whenever the
GC runs, and exposing that would make GC timing observable. **If you need to enumerate it, you
need a real cache with an eviction policy** — the missing API is the design telling you so.

**The trap:** `WeakMap<key, value>` where the *value* references the *key* keeps both alive. Weak
keys don't help if the value points back.

## Closures capture scope, not variables

Run demo E: 200 callbacks that each return a number, several megabytes of heap.

Engines *do* optimise away provably-unused captures — but "provably" is load-bearing. A `debugger`
statement, an `eval`, an unusual shape, and the whole scope is retained. Don't build on it.

The habit: **keep callbacks small and defined outside big scopes; pass what they need as
arguments.** If a handler needs one id, close over the id — not the object containing it, and
definitely not the API response it came from.

In a heap snapshot this shows as a `context` object in the retainer chain; expand it to see every
captured variable.

## The event bus

The store/emitter/bus every app grows is a listener leak with none of the tooling: no
`getEventListeners()`, nothing in DevTools, and a retainer chain that leads to a `Set` inside a
module — telling you the bus is the culprit but not which component forgot to unsubscribe.

Design fixes, in order:

1. `subscribe(event, fn, { signal })` — the same `AbortSignal` as everything else (labs 02–03).
2. Return an unsubscribe function *and* make ignoring it a lint error.
3. A dev-mode warning when one event exceeds N subscribers, printing registration stacks.

## WeakRef & FinalizationRegistry

```js
const ref = new WeakRef(obj);        // ref.deref() → obj | undefined
const reg = new FinalizationRegistry(tag => console.log('collected', tag));
reg.register(obj, 'my-tag');
```

Both are **explicitly best-effort**, per spec:

- the callback may never run (the page may close first);
- timing is unspecified and varies by engine and GC pressure;
- an object may stay alive long after you drop it.

**Never use them for correctness** — not for releasing a lock, closing a connection, or freeing a
resource. That's what explicit `dispose()` (and explicit resource management / `using`) is for.

Where they're genuinely good:

- a cache of expensive-to-rebuild objects that may be dropped under memory pressure (`WeakRef`);
- **dev-mode leak detection**: register components on mount; if the callback hasn't fired long
  after unmount, you probably have a leak. That's lab 06.

## Think about

- Your memo cache is keyed by a serialised filter object. Is it bounded?
- When would you use `WeakMap` over `Map`, and when is `WeakMap` the wrong answer?
- Why can't you iterate a `WeakMap`?

<details>
<summary>Answers</summary>

**Serialised filter keys.** Unbounded: the key space is every combination of every filter value,
and a date range or free-text field makes it effectively infinite. Bound it, or key it by
something with a small domain and filter the result.

**WeakMap vs Map.** `WeakMap` when the key is an object you don't own and the entry should die
with it. It's the *wrong* answer when you need to enumerate, count, or expire entries
independently of their keys — those needs mean you want a real cache. It's also wrong when the
value references the key.

**No iteration.** The contents change when the GC runs, at times the spec deliberately leaves
unspecified. Iteration would make GC timing observable from script, which is both a
non-determinism hazard and a side channel.
</details>

---

## 🏗️ Build challenge: a cache you can defend

Build `cache.js` with a policy you can state in one sentence:

```js
const c = createCache({
  maxEntries: 500,
  maxBytes: 20e6,
  ttlMs: 5 * 60_000,
  sizeOf: (v) => roughSize(v),
  onEvict: (k, v, reason) => metrics.count('cache.evict', { reason }),
});
```

Requirements:

1. LRU by entries **and** bytes **and** TTL, evicted lazily on access/write (never on a timer).
2. `sizeOf` with a sensible default: a rough object-size walker. Be explicit in the README about
   its inaccuracy — a wrong-but-consistent size estimate is fine for bounding; pretending it's
   exact is not.
3. Report **hit rate, evictions by reason, and current bytes**. A cache without a hit rate is a
   guess — and a cache with a 3% hit rate is pure overhead that should be deleted.
4. A `WeakMap`-backed variant for object keys, and a written explanation of when each is right.
5. A dev-mode leak check: a `FinalizationRegistry` that warns if a value is still alive long after
   eviction (something else is holding it — the eviction achieved nothing).
6. A test that runs 100,000 operations and asserts the heap returns to baseline afterwards.

**Done when:** you can point at a cache in your own codebase, state its bound and its eviction
rule in one sentence, and show its hit rate.

---

## Interview questions

1. What makes a memo cache a leak, and what two questions detect it?
2. `Map` vs `WeakMap` — keys, values, iteration, and when each is right.
3. Why can't you iterate a `WeakMap`?
4. How can a closure that returns a number retain megabytes?
5. What are `WeakRef` and `FinalizationRegistry` for, and what must you never use them for?
6. Your event bus has 4,000 subscribers for one event. How did that happen and how do you prevent
   it?
