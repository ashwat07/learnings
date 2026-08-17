# Lab 03 — Network first & offline ⭐⭐⭐⭐⭐

**Goal:** keep data fresh when the network works, stay useful when it doesn't, and never make a
user wait 30 seconds for something you already have.

**Primary metric:** time to a rendered answer on a slow/dead network.

> Open <http://localhost:8080/service-workers/labs/03-network-first/>

---

## The concept

```
network-first:   try network ──ok──► use it, and update the cache
                      │
                      ├──too slow (timeout)──► serve cache, let the network finish anyway
                      └──failed──────────────► serve cache, or a synthesised error
```

The timeout is the whole lab. Without it, network-first behaves fine offline (the fetch rejects
immediately) and terribly on a *bad* connection — a captive portal, a train tunnel, hotel wifi —
where the request neither succeeds nor fails for 30+ seconds. That state is far more common than
true offline, and it's the one users describe as "the app is broken".

```js
const res = await Promise.race([
  fetch(request).then(r => { cache.put(request, r.clone()); return r; }),
  new Promise(r => setTimeout(() => r(null), TIMEOUT)),
]);
if (!res) return (await cache.match(request)) ?? await network;
```

Note it doesn't `abort()` the slow request. It's already paid for; let it finish and warm the
cache for next time.

**Choosing the timeout:** longer than your p75 response time, shorter than the point where users
disengage. 1–3 seconds in practice. Too short and everyone on a normal connection gets stale data;
too long and it never fires.

## The navigation fallback

The single most important handler in an offline-capable app:

```js
if (request.mode === 'navigate') {
  event.respondWith(
    fetch(request).catch(async () =>
      (await caches.match(request, { ignoreSearch: true })) ??
      (await caches.match('./offline.html')))
  );
}
```

Without it, an offline user who deep-links to `/products/42` gets the browser's error page, no
matter how much you precached — because *that URL* was never cached. For an SPA, the fallback is
usually the app shell (`index.html`), which then renders the route client-side; for a content site
it's a dedicated offline page.

Your offline page must be **fully self-contained**: no network images, no font CDN, no analytics.
A fallback page that needs the network is not a fallback page.

## Do this

1. Register, reload once.
2. **fetch /api/data** — served by `network`.
3. **fetch it slowly (3000ms)** — served by `timeout-fallback-cache` at ~1.2s.
4. Re-register with a **500ms timeout** and try again. More stale answers, faster.
5. **fetch a dead endpoint** — a synthesised 503 rather than an exception.
6. Now do the whole offline checklist on the page: offline fetch, offline reload, offline deep
   link to a page that was never cached.

| Scenario | Time | Served by |
|---|---|---|
| fast network | | |
| 3000ms server, 1200ms timeout | | |
| 3000ms server, 500ms timeout | | |
| dead endpoint, cache present | | |
| dead endpoint, no cache | | |
| offline navigation to an uncached URL | | |

## Designing for offline honestly

`navigator.onLine` is nearly useless: it means "a network interface is up", not "the internet
works". A captive portal reads as online. Treat it as a hint for UI copy, never as a branch in
your data layer — **the only reliable offline detector is a failed request.**

What "offline support" actually requires, in order of effort:

1. **Shell renders offline** (Lab 02) — a day of work.
2. **Last-known-good data renders offline** (this lab) — a day, plus a UI decision: how do you tell
   the user this is stale? A timestamp beats a spinner.
3. **Writes work offline** — a queue, conflict resolution, retry, and a UI that shows pending
   state. Weeks, and it's a product decision, not a technical one. (Background Sync helps with the
   retry, but not with the conflicts.)

Most teams need 1 and 2 and think they need 3.

## Think about

- Why not `AbortController` the slow request when the timeout fires?
- The user is offline and you serve a cached API response. How do they know it's stale? What
  should the UI do?
- Which is right for HTML: network-first or cache-first? Does your answer change for a content
  site vs an app shell SPA?

<details>
<summary>Answers</summary>

**Don't abort.** The request is already in flight and mostly paid for. Letting it complete updates
the cache, so the next read is fresh. Aborting throws away work and guarantees the *next* request
is also slow.

**Telling the user.** Put the age in the response: tag the cached copy with the time it was
stored (a header you add on `cache.put`) and render "updated 6 minutes ago" plus an explicit
offline indicator. Silent staleness is the thing that destroys trust in an offline app — users
forgive old data, they don't forgive being misled about it.

**HTML strategy.** For an SPA whose shell is fingerprinted and rarely changes: cache-first for the
shell + a navigation fallback. For a content site where the HTML *is* the content: network-first,
so users get today's article, with the cache as the offline safety net. The deciding question is
"is the HTML content, or a container for content?"
</details>

---

## 🏗️ Build challenge: an offline write queue

Reads offline are easy. Writes are where it gets real.

Build an offline-capable "add a comment" flow:

```js
await api.post('/comments', { body }, { offline: 'queue' });
// resolves immediately with an optimistic result; syncs when possible
```

Requirements:

1. **Queue in IndexedDB** (not memory — the page will be closed). Each entry: request, body,
   created-at, attempt count, and a client-generated ID.
2. **Optimistic UI**: the comment appears immediately, visibly marked pending. The mark must
   survive a reload.
3. **Idempotency**: the client-generated ID goes to the server so a retry can't create duplicates.
   This is not optional — retries *will* happen, and "the user posted it twice" is the classic
   bug of every offline queue.
4. **Background Sync** (`self.registration.sync.register('flush')`) where supported, with a
   fallback to flushing on `online` + on SW startup. Say clearly in your README what Background
   Sync guarantees and where it isn't supported.
5. **Ordered flush with a poison-message escape**: if entry 3 fails permanently (a 400), it must
   not block entries 4–20. Distinguish retryable (5xx, network) from terminal (4xx) and surface
   terminal failures to the user.
6. **Conflict handling**: what happens when the server rejects because the thread was deleted?
   Design the UX, not just the code path.

**Done when:** you can go offline, post three comments, close the tab, come back online, reopen
the app, and see exactly three comments appear on the server — and when you can force a duplicate
attempt and show that idempotency prevents it.

---

## Interview questions

1. What's wrong with network-first and no timeout?
2. Why not abort the network request when the timeout fires?
3. A user offline navigates to a URL you never cached. What do they see, and what handler changes
   that?
4. Is `navigator.onLine` reliable? What is?
5. Network-first or cache-first for HTML? Defend your answer for two different kinds of site.
6. What are the three levels of "offline support", and which does your app actually need?
