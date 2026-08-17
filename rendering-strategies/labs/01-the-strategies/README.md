# Lab 01 — The seven strategies ⭐⭐⭐⭐⭐

**Goal:** know what each strategy costs, in numbers you measured, on identical markup.

**Primary metric:** TTFB, FCP, LCP, TBT and JS bytes, per strategy.

> Open <http://localhost:8080/rendering-strategies/labs/01-the-strategies/> with Network at
> **Fast 4G** and CPU at **4×**.

---

## The concept

Rendering strategy is a decision about **where you wait**:

```
                  build          server            client
                    │              │                 │
SSG      ───────────●──────────────┼─────────────────┼──►  fast always, stale by definition
ISR      ───────────●───(refresh)──●─────────────────┼──►  fast, bounded staleness
SSR      ────────────────────────  ●─────────────────┼──►  fresh, TTFB = your slowest query
stream   ─────────────────────── ●─┴─►(rest later)───┼──►  fresh, TTFB ≈ 0
CSR      ───────────────────────────────────────────  ●──►  cheap server, expensive device
RSC      ────────────────────────  ●──(payload)──────●──►  server does the data, client renders
```

None of these is "modern" or "outdated". They're different answers, and a real app uses several.

## Fill in the table

Automated (the lab does it): TTFB, first HTML byte, last byte, HTML size, chunk count.
By hand (navigate + hard reload + read the corner box): FCP, LCP, TBT, JS bytes, CLS.

| mode | TTFB | FCP | LCP | TBT | JS bytes | CLS |
|---|---|---|---|---|---|---|
| csr | | | | | | |
| ssr | | | | | | |
| ssr-par | | | | | | |
| ssg | | | | | | |
| isr | | | | | | |
| stream | | | | | | |
| rsc | | | | | | |

## What you should find, and why

**`ssr` ≈ 1700ms TTFB, `ssr-par` ≈ 900ms.** Identical HTML. Three `await`s in a row with no data
dependency between them:

```js
const product    = await getProduct(id);      // 200ms
const recommends = await getRecommends(id);   // 600ms  ← didn't need product
const reviews    = await getReviews(id);      // 900ms  ← didn't need either
```

This is the most common SSR performance bug in existence, it's invisible in code review because
the code reads cleanly, and it's Lab 02.

**`stream` first byte ≈ 1ms, last byte ≈ 900ms.** The same total work as `ssr-par`, but the browser
had markup to parse almost immediately. TTFB has been decoupled from "when is the data ready".
Lab 03.

**`csr` ships ~0.9KB of HTML and paints nothing.** The work didn't disappear — it moved onto the
user's device, behind a JS download. Look at the gap between FCP and LCP: that's the JS + data
chain. A small HTML payload is not a fast page.

**`ssg` / `isr` have a near-zero TTFB after the first request**, because the HTML already existed.
Note the `x-cache` column: `MISS` then `HIT`. Lab 04.

**`rsc` paints nothing until its JS runs** — the flight payload isn't paintable — but the data
fetching, its dependencies and its secrets never reached the client. Lab 05.

## The metrics, and what each one actually tells you

| Metric | Whose problem | Improved by |
|---|---|---|
| **TTFB** | the server (or the CDN) | parallel fetches, caching, streaming, edge |
| **FCP** | is there paintable HTML? | SSR/SSG/streaming; CSR always loses here |
| **LCP** | the user's experience of "loaded" | getting the hero's *bytes* early — HTML, priority, image work |
| **TBT** | how much JS runs before the page is usable | shipping less JS: islands, RSC, code-splitting |
| **CLS** | did content move? | reserving space (skeletons in this sandbox do) |
| **INP** | responsiveness after load | hydration strategy, long tasks |

The failure mode to avoid: optimising the metric your architecture is already good at. An SSR app
with a 2s TTFB doesn't need better hydration; a CSR app with 400KB of JS doesn't need a faster
API.

## Think about

- `csr` has the smallest HTML and the worst LCP. What does that tell you about "payload size" as
  a metric?
- `ssg` is fastest on every metric. Why isn't every page SSG?
- Which of these strategies can produce a *wrong* page, and how?

<details>
<summary>Answers</summary>

**Payload size.** It's a proxy, and a bad one on its own. What matters is the *critical path*:
bytes on the path to the first paint, and how many round trips are chained together. CSR trades a
small first payload for a longer chain (HTML → JS → data → paint), which is a bad trade on mobile
and a fine one on a warm-cached desktop app behind a login.

**Why not always SSG.** Because it's a snapshot: anything per-user, per-request, or fresher than
your build cadence can't be baked. And build time scales with page count — 100k product pages is a
20-minute build and a deploy you can't do casually. ISR exists precisely to keep SSG's delivery
with SSR's freshness, and Lab 04 is about the staleness window that buys.

**Wrongness.** SSG and ISR can serve stale content (by design — the question is the window). SSR
and streaming can serve *personalised* content into a shared cache if you cache carelessly (see
the HTTP caching course, Lab 05 — `Vary`, `private`). CSR and RSC can produce a different result
than the server would have, which is the hydration-mismatch class in the hydration course.
</details>

---

## 🏗️ Build challenge: a strategy benchmark harness

Turn this lab into something you can point at a real app.

```sh
node bench-render.mjs --url https://example.com/product/3 --runs 5 --profile fast4g
```

Requirements:

1. Playwright with explicit CDP throttling (`Network.emulateNetworkConditions`,
   `Emulation.setCPUThrottlingRate`). An unthrottled benchmark is a number about your laptop.
2. Report **median and p90** of TTFB, FCP, LCP, TBT, CLS, JS transfer and JS eval time, over N
   runs, discarding the first (cold cache, cold JIT).
3. Detect the **streaming shape**: record chunk arrival times from the response stream, and report
   "first paintable HTML at Xms, complete at Yms". A single duration hides the whole point.
4. Report the **critical path depth** — how many chained round trips before the LCP element's bytes
   arrive (reuse the resource-hints Lab 01 challenge if you built it).
5. Compare two URLs side by side and emit a markdown table suitable for pasting into a PR.

**Done when:** running it against `/render/ssr/product/3` and `/render/stream/product/3` reproduces
the difference this lab found, and running it against a real site tells you which of the six
strategies that site is using without you looking at its source.

---

## Interview questions

1. Explain the difference between CSR, SSR, SSG, ISR and streaming SSR in terms of *where the
   waiting happens*.
2. Two SSR pages have identical HTML; one has a 1.7s TTFB and one 0.9s. What's the likely cause?
3. CSR has the smallest HTML payload. Why is its LCP worse?
4. Which metric does hydration show up in, and why not in FCP?
5. Why isn't every page statically generated?
6. Your TTFB is 1.5s and your team wants to add islands. What do you say?
