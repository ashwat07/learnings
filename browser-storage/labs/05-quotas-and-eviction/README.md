# Lab 05 — Quotas & eviction ⭐⭐⭐⭐⭐

**Goal:** know how much you can store, what makes it disappear, and how to design so that losing
it is survivable.

**Primary metric:** quota vs usage, and what happens at the limit.

> Open <http://localhost:8080/browser-storage/labs/05-quotas-and-eviction/>
> This lab writes real data to disk. Use the cleanup button when you're done.

---

## The quota

```js
const { usage, quota, usageDetails } = await navigator.storage.estimate();
```

- Shared across **IndexedDB, Cache Storage, localStorage, OPFS and service worker registrations**
  for the origin.
- Derived from **free disk space**, not a fixed number. Chrome allows an origin up to ~60% of a
  pool that is itself a share of free space — so it shrinks as the user's disk fills.
- **Partitioned by top-level site**: your site in an iframe on someone else's page gets a
  different bucket than your own top-level page.
- Both numbers are deliberately imprecise, to avoid leaking disk information cross-origin. Don't
  build logic that needs exact bytes.

## What makes storage disappear

| Browser | Rule |
|---|---|
| Chrome / Edge | Best-effort storage evicted **LRU by origin** under disk pressure. Persistent origins exempt until nothing else is left. |
| Firefox | Similar LRU eviction; `persist()` prompts the user. |
| **Safari** | **All script-writable storage deleted after 7 days without user interaction with the site.** `persist()` does not exempt you. |
| Private / incognito | Small quota, everything destroyed at session end. |
| Everywhere | Eviction is **per origin and total** — data, caches, session, all of it, at once. |

The Safari rule changes product decisions. A user who visits every other week has an empty
database *every single time*: cached data gone, offline drafts gone, client-side session gone.

## `navigator.storage.persist()`

```js
const granted = await navigator.storage.persist();   // boolean, fails silently
```

Granted automatically in Chrome if the site is installed as a PWA, has high engagement, has
notification permission, or is bookmarked. Firefox prompts. Safari doesn't implement it
meaningfully.

What it **doesn't** do: exempt you from Safari's 7-day rule, increase your quota, or survive the
user clearing site data.

> **Never treat browser storage as durable.** Anything the user would be upset to lose must reach
> a server. `persist()` improves the odds; it does not create a guarantee.

## When you hit the limit

Run the **fill** demo. Notice how the failure arrives:

- a rejected promise from a single write, which **aborts the whole transaction** (everything else
  in it rolls back);
- possibly during a background sync or a service-worker cache update, where nobody is catching it;
- possibly *before* the reported quota, because the real limit depends on free disk right now.

Every write path in a storage-heavy app needs a quota strategy: **catch, evict, retry once,
degrade to network-only, tell the user something true.**

## Opaque responses eat quota

Run the **opaque padding** demo: three ~1KB cross-origin `no-cors` responses can cost megabytes,
because opaque entries are padded (Chrome: on the order of 7MB each) to avoid leaking their size.

Precaching 50 third-party assets opaquely can "use" 350MB and get your origin evicted. Fetch
cross-origin assets in CORS mode where you can, and never bulk-precache opaque responses.

## Designing for eviction

1. **Local storage is a cache, never the source of truth.**
2. **Test the empty case.** Application → Clear site data → reload. That's your most important
   test and almost nobody runs it. First-run-after-eviction must be fast and correct.
3. **Make sync state visible.** If a user has unsynced work, they should be able to see it. Silent
   loss is the worst outcome.
4. **Bound every cache you write** — entries, bytes, and age.
5. **Track usage** and warn (or evict) at 80% rather than discovering the limit during a write.
6. **Ask for persistence at a moment that earns it** — after the user does something that implies
   commitment (saves a document, installs the app), not on first page load.

## Think about

- Your PWA stores 2GB of offline maps. What do you have to tell the user, and when?
- A user is offline with unsynced changes and the browser evicts your origin. Whose fault is it,
  and what would have prevented it?
- How would you find out, in the field, how often your users are losing their local data?

<details>
<summary>Answers</summary>

**2GB of maps.** Tell them before downloading (size, and that the browser may reclaim it), request
persistence at that moment, show usage vs quota in the UI, and make re-download incremental so
eviction costs minutes, not a whole day's data allowance.

**Eviction with unsynced changes.** Yours. Eviction is a documented, expected browser behaviour;
"the browser deleted it" is not a defence. Prevention: sync early and often rather than on a
manual save, request persistence, and surface pending state so the user knows something is at
risk. The only real fix is that the data was never only local.

**Measuring it in the field.** Write a sentinel record with an install id and a timestamp on first
run. On every load, if the sentinel is missing but a cookie/localStorage marker or a server-side
record says this user has visited before, that's an eviction — report it with the age of the
install. You'll be surprised how high the number is on Safari and on low-storage Android.
</details>

---

## 🏗️ Build challenge: a storage manager

Build `storage-manager.js` — the thing every offline-capable app ends up needing.

```js
const sm = storageManager({
  budgets: { media: 0.5, data: 0.3 },       // fractions of the quota
  onPressure: (info) => showBanner(info),
});
await sm.reserve('media', 50e6);            // throws/evicts before you write
sm.report();                                // usage by bucket, headroom, eviction history
```

Requirements:

1. Track usage **per logical bucket** (your own accounting — `usageDetails` only splits by API,
   and only in Chrome). Keep the ledger in IndexedDB and reconcile it against `estimate()` on
   startup; report drift.
2. `reserve(bucket, bytes)` evicts within that bucket's budget *before* the write, so
   `QuotaExceededError` becomes rare rather than routine.
3. Pressure callbacks at 70% / 85% / 95%, debounced.
4. A `persist()` strategy: request it at a moment that earns it (a save, an install), record
   whether it was granted, and report it in your telemetry.
5. **Eviction detection**: the sentinel-record scheme above, reporting install age and bytes lost.
6. A `panic()` path: on `QuotaExceededError` anywhere, evict the largest expendable bucket, retry
   once, and if it still fails, switch the app to network-only mode with a visible state.

**Done when:** you can fill the disk (a small VM or a nearly-full external drive helps), watch
your app degrade gracefully instead of throwing, and produce a report showing exactly what was
evicted and why.

---

## Interview questions

1. What shares the origin quota, and how is the quota determined?
2. What does `navigator.storage.persist()` guarantee, and what doesn't it?
3. What is Safari's 7-day rule and what does it mean for your design?
4. What happens when a write exceeds the quota, mid-transaction?
5. Why do opaque responses use so much quota?
6. How would you measure how often real users lose their local data?
