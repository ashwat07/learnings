# Lab 03 — stale-while-revalidate ⭐⭐⭐⭐

**Goal:** get a 0ms response and fresh-enough data at the same time, and know exactly what you
traded for it.

**Primary metric:** average latency per poll, and how many polls until new content is visible.

> Open <http://localhost:8080/http-caching/labs/03-stale-while-revalidate/>

---

## The concept

```
Cache-Control: max-age=3, stale-while-revalidate=30
               └─ fresh ─┘  └── serve stale, refresh behind the user's back ──┘

 t=0    ────────── fresh ──────────►  served from cache, 0ms
 t=3    ─── stale, within SWR ─────►  served from cache, 0ms  + background revalidation
 t=33   ─── stale, beyond SWR ─────►  blocking revalidation, user waits
```

Three windows, not two. Between `max-age` and `max-age + stale-while-revalidate`, the cache
answers instantly *and* fixes itself for next time.

`stale-if-error=N` is the sibling: if revalidation fails, keep serving the stale copy for N more
seconds rather than surfacing an error. It's free resilience — a 30-second origin outage becomes
invisible.

**The cost, stated precisely:** exactly one request per staleness window receives old data. Not
"data can be up to 30s old for everyone" — the first request after expiry gets the stale copy and
triggers the refresh, and everyone after that gets fresh data. That distinction is what makes SWR
acceptable for far more things than people assume.

## Break it / measure it

Run A, B, C in order with a 600ms server delay.

| Config | Avg ms | Slow polls | Instant polls | Server hits | Polls until v2 seen |
|---|---|---|---|---|---|
| A. `no-store` | | | | | |
| B. `max-age=3` | | | | | |
| C. `max-age=3, swr=30` | | | | | |

What to notice:

- **A** is a flat wall of 600ms bars. Every request pays.
- **B** is a sawtooth. Most polls are free; one in four costs 600ms. Unpredictable latency feels
  worse to users than uniform latency — this is a real perceptual effect, not a metaphor.
- **C** is flat and instant, and the server hit count is *the same as B*. The work didn't
  disappear; it moved off the critical path.

Then run **D** (`stale-if-error`). Read the output note: Chrome does **not** implement
`stale-if-error` in its HTTP cache, though it does implement `stale-while-revalidate`. CDNs do
implement it. This is a good example of a header whose value depends entirely on *which* cache is
reading it.

## Where SWR is right, and where it isn't

| Resource | SWR? | Why |
|---|---|---|
| Navigation/menu config | ✅ `max-age=60, swr=86400` | One user seeing yesterday's menu once is harmless |
| Feature flags | ✅ with a short window | You already accept propagation delay |
| Avatars, thumbnails | ✅ long window | Nobody is harmed by an old avatar for one page view |
| Product listings | ✅ | The listing was already a snapshot |
| Search suggestions | ✅ | |
| Shopping cart contents | ❌ | The user just changed it; showing the old one is a bug report |
| Bank balance, stock price | ❌ | Staleness is the product defect |
| Auth/session state | ❌ | Stale = a logged-out user seeing logged-in UI |
| Anything the user just wrote | ❌ | Read-your-own-writes is a hard requirement |

The rule: **SWR is safe when staleness is invisible or irrelevant, and unsafe when the user
themselves caused the change.** The second half of that sentence is the one people forget — a
cache that's fine for other people's data is a bug for your own.

## Fix it yourself

Implement `swrFetch()` in `app.js` (demo E), backed by the Cache API so it survives reloads.

- [ ] Fresh → return from cache, no network.
- [ ] Stale within the SWR window → return immediately, refresh in the background.
- [ ] Stale beyond → await the network.
- [ ] Network error within the `staleIfError` window → serve stale, and mark the response so
      callers can show an "offline" indicator.
- [ ] **Coalesce**: only one background refresh per URL in flight at a time.
- [ ] Persist the stored-at timestamp (the Cache API stores Responses, not metadata — you'll need
      to write a header into the cached copy or keep a side index).

<details>
<summary>Hint 1 — where to keep the timestamp</summary>

The Cache API stores `Response` objects and gives you nothing else. Two options:

```js
// A. rewrite the response with an extra header before storing
const stamped = new Response(await res.clone().blob(), {
  status: res.status,
  headers: new Headers([...res.headers, ['x-cached-at', String(Date.now())]]),
});
await cache.put(url, stamped);
```

```js
// B. trust the stored Date header
const age = (Date.now() - new Date(res.headers.get('date')).getTime()) / 1000;
```

A is exact and costs you a body copy. B is free and depends on the server's clock and on `Date`
being present. Use A; note in a comment that you deliberately chose the copy.
</details>

<details>
<summary>Hint 2 — coalescing</summary>

```js
const inFlight = new Map();

function refresh(url) {
  if (inFlight.has(url)) return inFlight.get(url);
  const p = fetch(url, { cache: 'reload' })
    .then(res => { if (res.ok) cache.put(url, stamp(res.clone())); return res; })
    .finally(() => inFlight.delete(url));
  inFlight.set(url, p);
  return p;
}
```

Without the map, ten components reading the same stale entry in one tick fire ten identical
requests. With it, one. This pattern — a promise cache keyed by URL — is the single most useful
20 lines in any data layer.
</details>

---

## 🏗️ Build challenge: a cache policy simulator

Header design arguments go in circles because nobody can quantify the trade. Build the thing that
ends the argument: `simulate.mjs`.

```sh
node simulate.mjs --trace access.log --policy 'max-age=60, stale-while-revalidate=600'
```

Input: an access trace (real, or generated — request times per URL, plus content-change events).
Output:

```
policy: max-age=60, stale-while-revalidate=600
  requests            10,000
  served from cache    9,412  (94.1%)
  blocking revalidations   88  (0.9%)   p95 latency contribution: 12ms
  background refreshes    500
  origin requests         588  (5.9%)
  stale responses served  500  (5.0%)   max staleness observed: 61s
  bytes from origin      4.2 MB  (vs 71 MB with no-store)
```

Requirements:

1. Model the three windows correctly, including `Age` from an upstream shared cache.
2. Model **content changes** independently of requests, so you can report *how many users saw
   stale content and for how long* — that's the number a product owner actually cares about.
3. Compare several policies side by side on the same trace and rank them by a weighted score you
   define and can defend (origin cost vs p95 latency vs staleness exposure).
4. Model a cold cache fraction (new visitors) — a policy that's great for repeat visitors and
   irrelevant for a site where 80% of traffic is first-time is a bad policy.
5. Add `--outage 30s` to model an origin outage and show what `stale-if-error` buys.

**Done when:** you can hand someone a table that answers "should we add `stale-while-revalidate`
to this endpoint?" with numbers for both the benefit and the exposure, and you've run it against a
real access log.

---

## Interview questions

1. Explain `stale-while-revalidate` to a backend engineer in two sentences, including the cost.
2. `max-age=0, stale-while-revalidate=60` — what does that do? Is it useful?
3. Which of these would you put SWR on, and why: user profile, product price, CSS bundle, search
   results, notification count?
4. Does SWR reduce the load on your origin? (Careful.)
5. Chrome doesn't implement `stale-if-error`. Where would you put it anyway, and how would you get
   the behaviour in the browser?
6. Your team wants "always fresh data" on an endpoint hit 50 times per page. What do you propose
   instead, and how do you make the case?
