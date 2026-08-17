# Next.js caching layers ⭐⭐⭐⭐⭐

Next.js has **four** caches. They sit at different layers, have different lifetimes, are invalidated
by different things, and every "why is my data stale?" question is really "which of the four is
answering?"

```sh
# 1. the lab server must be running: it is the data source AND the hit counter
./serve.sh                                  # from the repo root, in one terminal

# 2. the Next app
cd nextjs-caching
npm install
npm run build && npm start                  # http://localhost:3000
```

> **Build with the lab server running.** A build that pre-renders pages has to fetch their data.
> That isn't a quirk of this setup — it's what static generation *means*, and it's why a
> build-time data source has to be available at build time.

---

## The four caches

| # | Cache | Where | Lifetime | Caches | Invalidated by |
|---|---|---|---|---|---|
| 1 | **Request memoization** | server, React | **one render pass** | identical `fetch`es / `cache()` calls | nothing — it expires with the request |
| 2 | **Data cache** | server, persistent | across requests **and deploys** | `fetch` results | `revalidate`, `revalidateTag`, `revalidatePath` |
| 3 | **Full route cache** | server, build/runtime | until revalidated or redeployed | rendered HTML + RSC payload | `revalidate`, `revalidatePath`, a new deploy |
| 4 | **Router cache** | **client**, in memory | seconds to minutes, per session | RSC payloads for visited routes | `router.refresh()`, a server action, a hard navigation |

```
   browser                          server
┌────────────┐              ┌──────────────────────────────┐
│ 4. router  │◄─payload─────│ 3. full route cache          │
│    cache   │              │      ▲                        │
└────────────┘              │      │ renders using          │
                            │ ┌────┴──────────┐             │
                            │ │ 1. request    │  per render │
                            │ │  memoization  │             │
                            │ └────┬──────────┘             │
                            │      │ misses go to           │
                            │ ┌────▼──────────┐             │
                            │ │ 2. data cache │  persistent │
                            │ └────┬──────────┘             │
                            └──────┼──────────────────────┘
                                   ▼  your API
```

Read it bottom-up when debugging: **stale data** is 2 or 3; **a stale whole page** is 3 or 4; **the
same query running four times** is 1 not working.

## Version matters — measure, don't assume

This app prints the Next version it's running on. The defaults have changed materially:

- **Next 13–14**: `fetch()` was cached by default; you opted *out* with `cache: 'no-store'`.
- **Next 15+**: `fetch()` is **not** cached by default; you opt *in* with `next: { revalidate }` or
  `next: { tags }`.
- **Next 16** (what this app installed): the same opt-in model, plus newer explicit caching
  primitives.

Every lab here works by **measuring** — the lab server counts how many times the data source was
actually hit ([`/api/stats`](http://localhost:8080/api/stats)) — rather than asserting what the
framework does. That habit is the transferable part: whatever version you're on, the counter tells
you the truth.

## Curriculum

| # | Lab | Question it answers | ⭐ |
|---|---|---|---|
| 01 | [Request memoization](labs/01-request-memoization/) | Four components need the same data. How many queries? | ⭐⭐⭐⭐ |
| 02 | [Data cache](labs/02-data-cache/) | What survives between requests, and how do I invalidate it? | ⭐⭐⭐⭐⭐ |
| 03 | [Full route cache](labs/03-full-route-cache/) | Why is my page static — or why isn't it? | ⭐⭐⭐⭐⭐ |
| 04 | [Router cache](labs/04-router-cache/) | Why does the back button show old data? | ⭐⭐⭐⭐⭐ |
| 05 | [Debugging staleness](labs/05-debugging-staleness/) | Something is stale. Which layer? | ⭐⭐⭐⭐⭐⭐ |

Prerequisites: [http-caching](../http-caching/) (these are the same ideas — freshness, validators,
stale-while-revalidate — in a framework) and
[rendering-strategies](../rendering-strategies/) labs 04–05 (ISR and RSC, from first principles).

## Two things that will save you a day

**Development lies.** `next dev` re-renders on every request and largely bypasses the route cache.
Caching bugs are *production-only*. Test with `npm run build && npm start`.

**The counter is the truth.** Framework logs and cache-status headers are useful; a counter on the
data source cannot be argued with. Keep one.
