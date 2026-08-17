# Lab 05 — CDN & edge ⭐⭐⭐⭐

**Goal:** know what an edge cache does, what its key is, how to change your mind, and — most
usefully — what it cannot fix.

**Primary metric:** hit ratio, origin requests under load, and TTFB per POP.

> <http://localhost:8080/asset-optimization/labs/05-cdn-and-edge/>

---

## The whole subject in one sentence

**A CDN is a cache close to the user.** Everything else follows: what it caches (the key), how long
(TTL), how you change your mind (purge), and what it can't help with (anything uncacheable).

Two independent benefits that people conflate:

1. **Fewer origin requests** — a capacity and cost win. A single reverse-proxy cache gets you this.
2. **Shorter distance** — a latency win. This one needs the geographic distribution.

## Every POP has its own cache

Run demo 2. Four POPs, four independent first misses. Consequences:

- Your hit ratio is **lower than you expect** for long-tail content — each POP discovers each
  object separately. A page viewed twice worldwide can miss twice.
- The first user in each region pays origin latency — and that's the user *furthest* from your
  origin.
- A purge is **eventually consistent** by nature.

Mitigations to look for in your provider's settings: **tiered caching** (POPs pull from a regional
parent, so the origin sees one miss instead of forty) and **origin shielding** (one designated POP
is the only one allowed to talk to your origin). If your hit ratio is poor and your origin load is
high, that's the setting.

## The stampede

Run demo 4: 20 concurrent requests to a cold object. This toy CDN has no request collapsing, so the
origin sees most of them.

> **Request collapsing (coalescing) is the single most important CDN setting nobody checks.**
> Concurrent misses for the same key become *one* origin request; everyone else waits for it.

Without it, the moment you most need the cache — a traffic spike hitting cold content — is the
moment it forwards everything to your origin. Pair it with `stale-while-revalidate` and
`stale-if-error` at the edge ([http-caching lab 03](../../../http-caching/labs/03-stale-while-revalidate/)).

It's the same coalescing pattern as the SWR map in the caching course and the `refreshing` flag in
the ISR lab. Every layer needs it; every layer forgets it.

## The cache key

| Part | In the key by default | Note |
|---|---|---|
| URL (path + query) | yes | **Strip tracking parameters at the edge**, or `?utm_source=x` is a separate copy of every page |
| Host, method | yes | only GET/HEAD are cached |
| Anything in `Vary` | yes | `Accept-Encoding` fine; `User-Agent` shatters it |
| Cookies | usually not in the key — but **most CDNs bypass the cache entirely** when a cookie is present | check this; it's why "our CDN hit ratio is 4%" |
| Geo / device class | no | add deliberately via a *normalised* header |
| `Authorization` | no | shared caches must not store these unless marked `public` |

Two failure modes, in opposite directions:

- **Too narrow** (over-varying): every visitor gets their own copy; hit ratio ≈ 0. Symptom: high
  origin load on a "cached" site.
- **Too wide** (under-varying): personalised content served to the wrong person. Symptom: an
  incident.

The design that avoids both: **cache the shared shell aggressively, fetch or stream the personal
fragment separately** ([rendering-strategies lab 06](../../../rendering-strategies/labs/06-choose-per-route/)).

## Purging

- Purge **by tag** (surrogate keys), not by URL. One product change invalidates that product page
  and the listings it appears on — nothing else. Purging by URL means maintaining the dependency
  list in application code, which rots.
- **Purge-all is a stampede.** Incident tool, not a deploy step.
- The alternative to purging is **not purging**: content-addressed URLs never need it
  ([http-caching lab 04](../../../http-caching/labs/04-immutable-and-fingerprinting/)).

## What the edge cannot fix

| Problem | Fixed by the edge? |
|---|---|
| Slow origin on a MISS | ❌ the first user in every POP still waits |
| Uncacheable (per-user, `no-store`) responses | ❌ nothing to cache |
| Too many bytes | ⚠️ closer, but the same bytes — compress and resize first |
| Render-blocking resources | ❌ page structure |
| Too much JavaScript / hydration | ❌ that CPU is on the device |
| A data waterfall in SSR | ❌ it caches the result, not the process |
| Repeat visits to static assets | ✅ this is what it's for |
| Global latency to cacheable content | ✅ |
| Origin capacity under load | ✅ with collapsing and a decent hit ratio |

A CDN is a purchase order rather than a code change, which is why it's often tried first and is
rarely the biggest win.

## Edge compute ≠ edge caching

Running code at the edge helps when the work is **small and the data is nearby**: routing,
redirects, A/B assignment, auth checks, personalising a cached shell.

It **hurts** when the code needs your database, which is usually in one region — you've added a
network hop to every query and made things slower with a very modern architecture diagram. Check
where your data is before moving your compute.

## Think about

- Your CDN hit ratio is 30%. What are the four most likely causes?
- Why does purge-by-URL rot, and what replaces it?
- You put your API behind a CDN and it got slower. How?

<details>
<summary>Answers</summary>

**30% hit ratio.** (1) Cookies present on requests, causing bypass; (2) tracking query parameters in
the cache key; (3) short TTLs, or `no-store`/`private` on responses that could be shared; (4)
long-tail content spread over many POPs with no tiered caching. Check in that order — the first two
account for most cases and are configuration, not code.

**Purge-by-URL rots.** It requires your application to know every URL affected by a change: the
product page, every listing it appears on, the sitemap, the search index page, the home page
carousel. That list drifts from reality the moment someone adds a template. Surrogate keys invert
it: the *response* declares its tags at render time, so the dependency list is generated by the
thing that knows.

**API slower behind a CDN.** Most likely: responses are uncacheable, so every request now takes an
extra hop through the POP to your origin, plus a new TLS handshake — pure added latency. Fix: make
the cacheable endpoints cacheable, or bypass the CDN for the API. A CDN in front of uncacheable
content is a proxy with extra steps.
</details>

---

## 🏗️ Build challenge: an edge behaviour audit

You cannot fix a CDN you can't observe. Build `edge-audit.mjs`:

1. Request each key URL **twice** and report `Age`, the cache-status header (`x-cache`,
   `cf-cache-status`, `x-vercel-cache` — they all differ), and TTFB for both.
2. Compute the **effective hit ratio** across a sample of URLs, and classify misses: uncacheable
   headers, cookie bypass, query-parameter cardinality, or short TTL.
3. Request from **multiple regions** (a cloud function per region, or a proxy) and report per-POP
   TTFB and cache status. This is where you discover a POP nobody warms.
4. **Test collapsing**: fire 20 concurrent requests at a purged URL and count how many reach your
   origin (add a request-id header at the origin and count distinct ones).
5. **Test purge propagation**: purge, then poll from several regions until the new content appears,
   and report the p95 propagation time. Nobody knows this number for their own CDN and everybody
   should.
6. Report **cache-key cardinality**: for each path, how many distinct cache keys exist (from your
   CDN's logs or by enumerating query parameters). A path with 400 keys is a path with a 0% hit
   ratio.

**Done when:** you can state your real hit ratio, your real purge propagation time, and whether
request collapsing is on — for a CDN you actually use.

---

## Interview questions

1. What are the two independent benefits of a CDN?
2. Why does every POP miss separately, and what fixes it?
3. What is request collapsing and why does it matter most during a traffic spike?
4. What's in a CDN cache key, and what are the two ways to get it wrong?
5. Purge by URL or by tag? Why?
6. Name four problems a CDN cannot fix.
