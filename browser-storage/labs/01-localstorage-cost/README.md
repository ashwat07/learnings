# Lab 01 — The cost of localStorage ⭐⭐⭐⭐

**Goal:** be able to say exactly what `localStorage` costs, and know the one shape of code that
turns it from harmless into a 400ms freeze.

**Primary metric:** worst frame during a write, and MB/s.

> Open <http://localhost:8080/browser-storage/labs/01-localstorage-cost/> at 4× CPU throttle.

---

## The concept

`localStorage` is the only storage API in the platform that is **synchronous**. Every `getItem`
and `setItem`:

1. blocks the main thread,
2. touches the disk (not just memory — the write must be durable),
3. serialises to a string, so you pay `JSON.stringify`/`parse` on top,
4. stores UTF-16, so a 1MB JSON string costs ~2MB of a ~5MB quota.

None of that matters for a theme preference. All of it matters for application state.

## Measure it

| Operation | ms | MB | MB/s | Worst frame |
|---|---|---|---|---|
| localStorage write (2000 × 2KB) | | | | |
| localStorage read + parse | | | | |
| IndexedDB write (one transaction) | | | | |
| IndexedDB read (getAll) | | | | |

Note that IndexedDB isn't necessarily *faster* in wall time. The column that matters is **worst
frame**: localStorage freezes the page, IndexedDB doesn't.

Then run **JSON round-trip cost** and **find the quota**.

## The pattern that kills pages

```js
const state = JSON.parse(localStorage.getItem('app'));   // parse everything
state.items.push(item);
localStorage.setItem('app', JSON.stringify(state));      // stringify everything
```

The entire application state, serialised twice, synchronously, on every interaction. It's what
every "persist my store to localStorage" middleware does by default. It works beautifully at 50KB
and becomes a 400ms freeze at 5MB — gradually, so nobody can point to the change that caused it.

If you must persist a store to localStorage: debounce it, persist a *slice*, and move the
serialisation into `requestIdleCallback`. Better: use IndexedDB and write only what changed.

## What localStorage is actually for

| Use | Verdict |
|---|---|
| Theme, locale, "dismissed the banner" | ✅ perfect |
| A feature flag or two | ✅ |
| An auth token | ⚠️ readable by any XSS; prefer an `HttpOnly` cookie |
| Application state, caches, lists | ❌ IndexedDB |
| Anything over ~100KB | ❌ IndexedDB |
| Binary data | ❌ it can't — base64 costs 33% and another main-thread encode |
| Anything written on a hot path | ❌ |

## The three other traps

**Quota is per origin and shared.** ~5MB (sometimes 10), counted in UTF-16 units, shared with
every script on the origin — including third-party ones you didn't write. A vendor script that
fills it breaks *your* writes. There's no way to request more, no eviction, and no way to know
how much room is left except by catching `QuotaExceededError` — synchronously, mid-loop, with your
data half-written.

**No transactions, no locking.** Two tabs doing read-modify-write on the same key silently lose an
update. IndexedDB gives you transactions; the Web Locks API gives you explicit mutual exclusion.

**The `storage` event fires in *other* tabs only** — never in the one that wrote. It's usable as a
cross-tab signal, but `BroadcastChannel` is the right tool for messaging.

## Think about

- Why is `localStorage` synchronous at all? What would break if it weren't?
- Your app stores an auth token in `localStorage`. What's the threat, and what's the alternative?
- A colleague says "localStorage is fine, it's only 2MB". What do you measure to answer them?

<details>
<summary>Answers</summary>

**Why synchronous.** It shipped in 2009 as a deliberately dead-simple replacement for cookies,
before promises existed and before anyone had internalised the cost of blocking the main thread.
It cannot be changed now: every site that does `if (localStorage.getItem('x'))` inline would
break. It's a permanent lesson in how a convenient API becomes an unremovable performance floor.

**Auth token.** Any XSS — including in a third-party script — can read it and exfiltrate it, and
it persists indefinitely. `HttpOnly; Secure; SameSite` cookies can't be read by JavaScript at all.
If you must use a token, keep it in memory and refresh it from an `HttpOnly` cookie; see the CORS
course, Lab 04.

**"It's only 2MB."** Measure the worst frame during a save at 4× CPU throttle on a real phone
profile, and the INP of the interaction that triggers it. 2MB of UTF-16 through
`JSON.parse` + `stringify` + a disk write is comfortably over 100ms on mid-range hardware — and
it happens on the main thread, during an interaction, which is exactly the definition of bad INP.
</details>

---

## 🏗️ Build challenge: a drop-in replacement

Build `storage.js`: the same ergonomics as `localStorage`, none of the blocking.

```js
import { store } from './storage.js';
await store.set('user', { id: 1, name: 'Ada' });   // IndexedDB underneath
const user = await store.get('user');
store.getSync('theme');                             // a small, in-memory hot cache
```

Requirements:

1. IndexedDB underneath, with an in-memory cache hydrated once at startup so hot reads are
   synchronous — the ergonomic thing people actually want from localStorage.
2. **Write batching**: coalesce writes within a microtask/animation frame into one transaction.
   Measure the difference for 1,000 sets.
3. **Cross-tab consistency** via `BroadcastChannel`: when another tab writes, invalidate/refresh
   the local cache. Handle the ordering problem — two tabs writing the same key.
4. A **migration path**: on first run, copy existing `localStorage` keys in and delete them, so
   adoption is one line.
5. **Quota handling**: catch `QuotaExceededError`, report usage vs quota, and provide an eviction
   hook so the app decides what to drop rather than failing.
6. Measure and publish, at 4× CPU throttle:

| | 1,000 writes | worst frame | 1,000 reads |
|---|---|---|---|
| localStorage | | | |
| `store.js` | | | |

**Done when:** the worst frame during 1,000 writes is under 16ms, hot reads are synchronous, and
two tabs writing concurrently converge on the same value with a rule you can explain.

---

## Interview questions

1. What's wrong with `localStorage` for application state?
2. What does `JSON.parse(localStorage.getItem('state'))` cost, and where?
3. How big is the localStorage quota, in what units, and what happens when you exceed it?
4. Which tab receives the `storage` event?
5. Two tabs increment a counter in `localStorage` at the same time. What happens?
6. When is `localStorage` the right choice?
