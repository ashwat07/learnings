# Lab 04 — Cache API ⭐⭐⭐⭐

**Goal:** know what Cache Storage is good at, where its keys bite, and when to use IndexedDB
instead.

**Primary metric:** correct hits/misses, and MB/s for binary.

> Open <http://localhost:8080/browser-storage/labs/04-cache-api/>

---

## The concept

Cache Storage holds `Request` → `Response` pairs. It's available on the **main thread and in
workers**, not just service workers — `caches.open()` works anywhere.

```js
const cache = await caches.open('v1');
await cache.put(request, response);        // response body is consumed — clone if you need it
const hit = await cache.match(request);
await cache.delete(request);
const requests = await cache.keys();       // Request objects, not strings
```

Three properties that define everything else:

1. **The key is a `Request`.** Method, URL *including query string*, and — via the stored
   response's `Vary` — request headers all participate. This is the source of most "it's clearly
   in the cache but it misses" confusion.
2. **There is no expiry, no LRU, no size cap.** Nothing is ever removed unless you remove it (or
   the browser evicts the whole origin). Every retention policy is code you write.
3. **There's no metadata.** No stored-at time, no hit count. Attach what you need as a header on a
   reconstructed `Response`.

## matchOptions

| Option | Effect | When |
|---|---|---|
| `ignoreSearch` | drop the query string from the key | analytics params that don't change the resource. **Dangerous** when the query *is* the resource |
| `ignoreVary` | ignore the stored response's `Vary` | a stored `Vary: Accept-Encoding` response won't match a differently-encoded request otherwise |
| `ignoreMethod` | treat HEAD as GET | rarely needed |
| `cacheName` (on `caches.match`) | restrict the search | `caches.match()` searches **every** cache in order — easy to get a hit from one you'd forgotten |

## Synthesised responses

Nothing requires a cached response to have come from the network, or the URL to exist:

```js
await cache.put('/virtual/my-data', new Response(JSON.stringify(data), {
  headers: { 'content-type': 'application/json', 'x-cached-at': String(Date.now()) },
}));
```

This is how you attach metadata (a store time, an etag, a staleness flag), how offline fallbacks
are built, and how a service worker mocks an API. Every expiry implementation over Cache Storage
does exactly this.

## Cache API vs IndexedDB

Run demo 5. Speed is roughly comparable for binary; the decision isn't about speed.

| Use Cache Storage when | Use IndexedDB when |
|---|---|
| The thing **is** an HTTP response | The thing is **data** |
| You'll serve it back from a `fetch` handler | You need queries, indexes, ranges |
| Headers matter (content type, caching) | You need transactions across records |
| The URL is the natural key | You need partial updates or invariants |
| You precache assets | You have metadata alongside bytes |

**The common good design**: metadata and queryable fields in IndexedDB, the bytes in Cache
Storage keyed by URL, with the IDB record holding that URL. You get queries *and* a
fetch-handler-friendly binary store. The cost: "consistent across two storage systems" becomes
your problem — decide which one is the source of truth, and write the reconciliation.

## `addAll` and its failure mode

`addAll` is **atomic**: one failure rejects the whole call and nothing is stored. Right for a
precache (a half-populated shell is worse than none), and it means one stale URL in a
hand-written manifest blocks every deploy. Generate the manifest.

Also: `add`/`addAll` fetch with the default cache mode, so they can store a *stale* HTTP-cached
copy. For a precache, `fetch(url, { cache: 'reload' })` and `put()` the result.

## Think about

- Why does `cache.match()` miss a URL you can see in DevTools?
- You cache 200 product images. How do you stop that growing forever?
- Where do you store "when was this cached"?

<details>
<summary>Answers</summary>

**Phantom misses.** Almost always one of: a query-string difference (`ignoreSearch`), the stored
response's `Vary` (`ignoreVary`), a different method, or you're looking in a different cache than
you're matching against. Check with `cache.keys()` and compare the actual `Request` objects.

**200 images forever.** You implement it: keep an index (IndexedDB) of URL → stored-at and
last-used, and on each write evict the least-recently-used beyond N entries or M bytes. There is
no built-in policy. Also cap by *bytes*, not just entries — 200 entries can be 20KB or 2GB.

**Store time.** In a header on the stored response
(`new Response(body, { headers: [...res.headers, ['x-cached-at', Date.now()]] })`), or in a
parallel IndexedDB index. Not in the `Date` header — that's the server's clock and it may have
come from an HTTP cache that already held it for an hour.
</details>

---

## 🏗️ Build challenge: a bounded binary store

Build `blobStore.js` — the hybrid design, done properly.

```js
const store = blobStore({ cacheName: 'media', maxBytes: 200e6, maxEntries: 500 });
await store.put(url, blob, { tags: ['product', 'thumb'], expiresAt });
const blob = await store.get(url);
await store.evictTo(100e6);
const { entries, bytes, oldest } = await store.stats();
```

Requirements:

1. Bytes in Cache Storage, metadata (URL, size, stored-at, last-used, tags, expiry) in IndexedDB.
2. LRU eviction by **bytes and entries**, run lazily on write, never on a timer.
3. **Consistency**: the two stores can diverge if the tab is killed between writes. Pick a write
   order, justify it, and write a `repair()` that reconciles — walk `cache.keys()` against the
   index and fix both directions. Run it at startup and report what it found.
4. Query by tag, by age, by size — the thing Cache Storage can't do at all.
5. Handle `QuotaExceededError` on write: evict, retry once, then fail with a useful error.
6. Works in a service worker *and* on the main thread, with a `BroadcastChannel` so both see the
   same index.

**Done when:** a soak test writing 2,000 blobs with a 200MB cap ends at ≤ 200MB with a consistent
index, and `repair()` reports zero problems after a kill -9 mid-write test.

---

## Interview questions

1. What is the key in Cache Storage, and what three things can make a match unexpectedly fail?
2. Is Cache Storage service-worker-only?
3. How do you store "when was this cached"?
4. Cache API or IndexedDB for 500 product images with metadata? Defend it.
5. What's the eviction policy of Cache Storage?
6. Why is `cache.addAll` atomic, and what does that imply for your precache manifest?
