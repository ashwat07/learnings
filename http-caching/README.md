# HTTP caching ⭐⭐⭐⭐⭐

Caching is the only optimisation that makes a request take **zero** milliseconds. Everything else
makes it faster. This course is about earning that zero safely — and about the second-order skill
that actually gets you hired: designing a header policy for a whole app and defending it.

```sh
./serve.sh    # from the repo root, then http://localhost:8080/http-caching/labs/01-cache-control-basics/
```

---

## The model

There are two questions a cache asks, and they are independent:

```
                    ┌──────────────────────────────────────────┐
request ──────────► │ 1. Do I have a stored response for this  │
                    │    cache key, and is it FRESH?           │
                    └──────────────────────────────────────────┘
                          fresh │                    │ stale / absent
                                ▼                    ▼
                       serve from cache      ┌───────────────────────────┐
                       (0ms, no network)     │ 2. Can I REVALIDATE it?   │
                                             │    (ETag / Last-Modified) │
                                             └───────────────────────────┘
                                                 304 │        │ 200
                                                     ▼        ▼
                                        reuse stored body   store new body
                                        (headers only,      (full download)
                                         ~1 RTT)
```

- **Freshness** is decided by `Cache-Control: max-age` / `s-maxage` / `Expires`, minus `Age`.
- **Revalidation** is decided by validators: `ETag` ↔ `If-None-Match`, `Last-Modified` ↔
  `If-Modified-Since`. A successful revalidation is a **304 with no body** — you still pay a round
  trip, you just don't pay the bytes.
- The **cache key** is the method + URL, *plus* whatever `Vary` names. Get this wrong and you
  serve the German page to English users, or the logged-in page to anonymous ones.

### The directives, and what they actually mean

| Directive | Means | Common misuse |
|---|---|---|
| `max-age=N` | Fresh for N seconds **from when it was generated** | People think it's "from when the browser got it" — that's what `Age` corrects for |
| `s-maxage=N` | Same, but only for shared caches (CDN); overrides `max-age` there | Forgetting it means your CDN uses the browser's number |
| `no-cache` | Store it, but **revalidate before every use** | Read as "don't cache". It caches. `no-store` is the one that doesn't. |
| `no-store` | Never write it to any cache | Sprinkled on everything "for safety", costing 100% of the traffic |
| `must-revalidate` | Once stale, you may **not** serve it without checking | Assumed to be the default. It isn't — caches may serve stale in some conditions |
| `private` | Only the browser may store it, not shared caches | Omitted on authenticated responses → CDN serves user A's data to user B |
| `immutable` | Don't even revalidate on reload — the content can never change | Used on URLs that aren't content-addressed |
| `stale-while-revalidate=N` | Serve stale up to N seconds while refreshing in the background | Confused with `max-age`; it *extends* usability past freshness |
| `stale-if-error=N` | Serve stale for N seconds if the origin errors | Underused; it's free resilience |

And the one that isn't a directive: **no `Cache-Control` at all** does not mean "don't cache". It
means the cache gets to *guess* (heuristic freshness, typically 10% of the time since
`Last-Modified`). Lab 01 makes you watch it guess.

---

## Curriculum

| # | Lab | Question it answers | ⭐ |
|---|---|---|---|
| 01 | [Cache-Control basics](labs/01-cache-control-basics/) | What does each directive actually do to the network? | ⭐⭐⭐⭐⭐ |
| 02 | [Validators: ETag & Last-Modified](labs/02-validators/) | What does a 304 cost, and when do you get one? | ⭐⭐⭐⭐⭐ |
| 03 | [stale-while-revalidate](labs/03-stale-while-revalidate/) | How do I get a 0ms response *and* fresh data? | ⭐⭐⭐⭐ |
| 04 | [Immutable & fingerprinting](labs/04-immutable-and-fingerprinting/) | How do I cache forever and still ship a fix in 60 seconds? | ⭐⭐⭐⭐⭐ |
| 05 | [Vary & cache keys](labs/05-vary-and-cache-keys/) | Who else is going to get this response? | ⭐⭐⭐⭐ |
| 06 | [Design a header policy](labs/06-header-policy/) | The interview question, end to end | ⭐⭐⭐⭐⭐⭐ |

## How to measure caching honestly

Three independent sources of truth. Use at least two, always:

1. **`/api/stats`** — how many times the request actually reached the server. If the counter
   doesn't move, the network genuinely didn't happen. This is the strongest evidence and the labs
   lean on it.
2. **Network panel `Size` column** — `(memory cache)`, `(disk cache)`, `(ServiceWorker)`, or a
   byte count. `304` shows a tiny transfer.
3. **`PerformanceResourceTiming`** — `transferSize === 0 && decodedBodySize > 0` means it came
   from the cache. `transferSize` under ~300 bytes with a real body means a 304.

### Three things that will lie to you

- **DevTools "Disable cache"** is on by default in many people's setups. Every measurement in this
  course is wrong with it enabled. Check it.
- **Reload vs navigation.** A normal navigation uses the cache. `Cmd-R` sends
  `Cache-Control: max-age=0` for the main resource and revalidates subresources. `Cmd-Shift-R`
  bypasses the cache entirely (`no-cache` on everything). Three different behaviours, and the
  bug you're chasing may only exist in one.
- **The memory cache.** Chrome keeps a per-tab in-memory cache that ignores some directives for
  the lifetime of the page. A resource fetched twice in one page load may hit memory cache even
  with `no-cache`. Test across reloads, not just within a page.
