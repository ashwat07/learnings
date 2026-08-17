# Lab 04 — SWR & navigation preload ⭐⭐⭐⭐

**Goal:** implement stale-while-revalidate properly (expiry, coalescing, bounds) and stop your
service worker from making navigations slower than not having one.

**Primary metric:** response time per SWR read, and `fetchStart - workerStart` on navigation.

> Open <http://localhost:8080/service-workers/labs/04-swr-and-preload/>

---

## Part 1 — SWR you write yourself

```js
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) {
    refresh(request, cache);        // not awaited
    return cached;
  }
  return fetch(request);            // …and cache it
}
```

Four lines get you the basic behaviour. The three things that make it production-grade are what
this lab is about:

**1. Age, and therefore expiry.** The Cache API stores `Response` objects and *no metadata*. There
is no "when was this cached". You have to write it yourself:

```js
const headers = new Headers(res.headers);
headers.set('x-cached-at', String(Date.now()));
cache.put(request, new Response(res.clone().body, { status: res.status, headers }));
```

Without it you cannot implement expiry, cannot show "updated 3 minutes ago", and cannot decide
when something is *too* stale to serve at all.

**2. An upper bound on staleness.** SWR says "serve stale and refresh". If the entry is a month
old, serving it is worse than waiting 400ms. The lab's worker treats anything older than
`10 × maxAge` as a miss.

**3. Coalescing.** Ten components reading the same stale URL in one tick must produce **one**
background refresh:

```js
const inFlight = new Map();
function refresh(request, cache) {
  if (inFlight.has(request.url)) return inFlight.get(request.url);
  const p = fetch(request).then(store).finally(() => inFlight.delete(request.url));
  inFlight.set(request.url, p);
  return p;
}
```

Run the **10 simultaneous fetches** demo and check the log: exactly one refresh.

### Do this

| Action | ms | served by | data version |
|---|---|---|---|
| 1st fetch | | | |
| 2nd fetch | | | |
| fetch after `maxAge` | | | |
| after bumping the server, 1st fetch | | | |
| after bumping the server, 2nd fetch | | | |

## Part 2 — the service worker tax

Here's the part nobody mentions when they recommend a service worker:

> **Every controlled navigation must start the service worker before the request can be made.**

Cold, that's a process start, script parse, and your top-level code. On a mid-range phone: 50–250ms
added to *every* navigation, including ones where your fetch handler does nothing at all. A site
can measurably regress its LCP by adding an empty service worker.

Measure it: click **this page's navigation timing** and look at `fetchStart - workerStart`.
Register the `300ms boot` variant, reload, and measure again.

### Navigation preload

```js
self.addEventListener('activate', (e) =>
  e.waitUntil(self.registration.navigationPreload.enable()));

self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => (await event.preloadResponse) || fetch(event.request))());
  }
});
```

The browser starts the navigation request **in parallel** with booting the worker. The boot cost
overlaps with the network instead of preceding it.

Two rules:

- **If you enable it, you must use `event.preloadResponse`.** Otherwise you've issued a request
  nobody consumes; the browser logs a warning and you've wasted the user's bytes.
- It applies to navigations only. Subresource requests still wait for the worker.

The request carries `Service-Worker-Navigation-Preload: true`, so a server can respond
differently — e.g. send only the content fragment because the shell is already cached.

### The other half of the fix: keep top-level code tiny

```js
// bad: 300ms of work on every worker boot
importScripts('/big-library.js');
const routes = buildComplicatedRouteTable();

// good: do it lazily, inside the handler that needs it
```

Measure your own worker's boot: register it with an empty fetch handler and compare
`fetchStart - workerStart` against no worker at all.

## Think about

- Why can't you use the `Date` response header instead of your own `x-cached-at`?
- A user opens your app after two weeks offline. What should SWR do?
- If a service worker makes navigations slower, when is one worth having at all?

<details>
<summary>Answers</summary>

**`Date` vs `x-cached-at`.** `Date` is when the *server* generated the response, not when you
stored it — and it may have come from an HTTP cache that already held it for an hour, be missing,
or be wrong (client clock skew is real). For expiry you want *your* clock and *your* store time.

**Two weeks stale.** Serve nothing stale: treat it as a miss and await the network, but show the
cached copy behind a clear "showing data from 14 days ago" state if the network fails. The rule of
thumb: staleness the user can't perceive is fine; staleness that would make them act on wrong
information is not.

**When a worker is worth it.** When you need genuine offline support, when repeat-visit latency
matters more than first-visit latency, or when you need per-request logic the HTTP cache can't
express. If all you want is caching of static assets, `Cache-Control: immutable` does it with no
boot cost, no lifecycle, and no way to brick your site. "We added a service worker for
performance" without navigation preload is often a net negative.
</details>

---

## 🏗️ Build challenge: a cache with a real expiry and size policy

The Cache API has no eviction, no LRU, no max entries, no TTL. Build it.

```js
const cache = expiringCache('images', { maxEntries: 60, maxAgeMs: 7 * 864e5, maxBytes: 50e6 });
await cache.put(request, response);
const hit = await cache.match(request);      // null if expired
```

Requirements:

1. Keep an index in **IndexedDB** (URL → storedAt, size, lastUsed). Cache Storage can't hold it,
   and rebuilding it by iterating the cache on every request is too slow.
2. Enforce `maxEntries` (LRU), `maxAgeMs` (TTL) and `maxBytes` (total size). Evict lazily on write,
   not on a timer — a timer in a service worker is a fiction, the worker will be dead.
3. Keep the index and the cache **consistent** even if the worker is killed between the two writes.
   Decide which one you write first and justify it: one order leaks cache entries the index
   doesn't know about, the other reports hits for entries that aren't there. (Hint: prefer the
   failure that's recoverable by a cheap check.)
4. Handle opaque responses: you cannot know their size, so charge a fixed padding and document it
   (Lab 05 covers why).
5. Report `stats()`: entries, bytes, hit rate, evictions — and log evictions during development,
   because an over-eager eviction policy looks exactly like a caching bug.

**Stretch:** add `staleWhileRevalidate(request, {maxAgeMs})` on top, with the coalescing map, and
an `onStale` callback so the UI can show "refreshing…".

**Done when:** a soak test that writes 500 images with a 60-entry cap ends with exactly 60 entries,
a consistent index, and a correct total byte count — after you kill and restart the worker
mid-test.

---

## Interview questions

1. How do you know how old a Cache Storage entry is?
2. Why coalesce background refreshes, and what does the code look like?
3. What does having a service worker cost on every navigation, and how do you measure it?
4. What does navigation preload do, and what's the rule you must follow after enabling it?
5. When would SWR be the wrong strategy in a service worker?
6. Your team wants a service worker "for performance". What do you ask them first?
