# Rendering strategies: CSR / SSR / SSG / ISR / streaming / RSC ⭐⭐⭐⭐⭐

Every rendering strategy is an answer to one question: **where do you wait?** On the server, on
the client, or at build time. Nothing is free, nothing is universally best, and the interesting
skill is choosing per route and being able to say why in numbers.

```sh
./serve.sh    # then http://localhost:8080/rendering-strategies/labs/01-the-strategies/
```

---

## The sandbox

One app — a product listing and a product page — rendered seven ways from **identical
templates**. Read [`shared/app/render.mjs`](../shared/app/render.mjs): it's ~300 lines and it is
the whole course. Because the markup is shared, the only variable between strategies is *when the
HTML is produced* and *what JavaScript must run afterwards*.

```
/render/csr/product/3        a shell + JS: HTML → JS → data → paint
/render/ssr/product/3        rendered per request, data fetched sequentially
/render/ssr-par/product/3    the same page, data fetched in parallel
/render/ssg/product/3        rendered once, cached forever
/render/isr/product/3?revalidate=10   cached, refreshed in the background when stale
/render/stream/product/3     shell flushed immediately, slow sections streamed later
/render/rsc/product/3        a serialised component tree, rendered by the client
```

The four data sources have deliberately different latencies, because that's what makes the
argument concrete:

| Source | Latency | Where it appears |
|---|---|---|
| `getProduct` | 200ms | above the fold |
| `getRecommends` | 600ms | below the fold |
| `getReviews` | **900ms** | below the fold, and the reason streaming exists |
| `getProducts` | 300ms | the listing |

Every page shows a live scoreboard (TTFB / FCP / LCP / CLS / TBT / JS bytes) in the corner. Knobs:
`?productDelay=`, `?reviewsDelay=`, `?hydrationCost=`, `?revalidate=`, `?hydrate=`. Control and
introspection: `/api/render` (and `?bumpVersion=1`, `?invalidate=1`, `?resetCalls=1`).

## The numbers that make the trade-off, measured on this machine

| | TTFB | Total | HTML bytes |
|---|---|---|---|
| `ssr` (sequential) | 1706ms | 1706ms | 2.9KB |
| `ssr-par` (parallel) | 903ms | 903ms | 2.9KB |
| `stream` | **1ms** | 903ms | 2.9KB |
| `csr` | ~1ms | ~1ms | 0.9KB (then JS, then data) |

Three things fall out of that table, and they're the course in miniature:

1. **Sequential server fetches are the most common SSR bug.** Three awaits with no data
   dependency cost 1.7s instead of 0.9s. Nobody notices because the page is "server-rendered,
   so it's fast".
2. **Streaming decouples TTFB from data.** Same total time, first byte in 1ms.
3. **A small HTML payload is not a fast page.** CSR wins on bytes and loses on everything users
   perceive.

## Curriculum

| # | Lab | Question it answers | ⭐ |
|---|---|---|---|
| 01 | [The seven strategies](labs/01-the-strategies/) | What does each one actually cost? | ⭐⭐⭐⭐⭐ |
| 02 | [Server waterfalls](labs/02-server-waterfalls/) | Why is my SSR slower than my API? | ⭐⭐⭐⭐⭐ |
| 03 | [Streaming](labs/03-streaming/) | How do I ship the shell before the data? | ⭐⭐⭐⭐⭐ |
| 04 | [SSG & ISR](labs/04-ssg-and-isr/) | Static and still fresh — what's the staleness window? | ⭐⭐⭐⭐⭐ |
| 05 | [The RSC model](labs/05-rsc-model/) | What crosses the wire, and what stays on the server? | ⭐⭐⭐⭐ |
| 06 | [Choose per route](labs/06-choose-per-route/) | The interview question, with numbers | ⭐⭐⭐⭐⭐⭐ |

Related: [hydration-strategies](../hydration-strategies/) is the other half of this story (what
the JS does after the HTML arrives), and [nextjs-caching](../nextjs-caching/) is how one framework
implements the caching layers behind SSG/ISR.

## How to measure honestly

- **Throttle**: Network *Fast 4G* + CPU 4×. Every strategy looks the same on a fast desktop, which
  is exactly why the wrong ones ship.
- **Hard-reload** between runs, and take the **median of three**.
- **Read the right metric.** TTFB is a server number; FCP/LCP are what users feel; TBT is what
  hydration costs. A strategy that improves one and wrecks another has not improved anything.
- **`curl -N`** to watch streaming arrive in real time — the browser hides the chunk boundaries.
