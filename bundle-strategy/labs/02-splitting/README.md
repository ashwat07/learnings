# Lab 02 — Splitting ⭐⭐⭐⭐⭐

**Goal:** put chunk boundaries where they pay, and know the two costs you're accepting.

**Primary metric:** initial download, plus duplicated bytes across chunks.

> ```sh
> node build.mjs --all
> node analyse.mjs split
> node analyse.mjs no-split
> ```

---

## What splitting is

A chunk boundary is created by a **dynamic import**. Everything reachable only through `import()`
can live in its own file, fetched when that code path runs.

```js
// static: admin (and its 90KB chart library) is in the main bundle
import { render } from './routes/admin.js';

// dynamic: admin becomes its own chunk, fetched on demand
const { render } = await import('./routes/admin.js');
```

| variant | initial | total | files |
|---|---|---|---|
| `no-split` | 82.1 KB | 82.1 KB | 1 |
| `split` | **1.5 KB** | 82.3 KB | 3 |

Same bytes overall. The 80KB chart chunk is now only downloaded by people who visit admin — which
in this app is almost nobody.

## The three chunk types you'll end up with

| Chunk | Contains | Cached until |
|---|---|---|
| **entry** | your app shell and router | any of it changes |
| **route/lazy chunks** | one route's code | that route changes |
| **shared/common chunk** | modules used by 2+ chunks | any of those change |

The shared chunk exists so a module used by two routes isn't downloaded twice. Which brings us to
the first cost.

## Cost 1: duplication

Run `node analyse.mjs split` and look for the duplication warning. When a module is used by two
lazy chunks, a bundler either:

- **hoists it into a shared chunk** — an extra request, but downloaded once, and it can be
  preloaded alongside the entry; or
- **duplicates it into both** — no extra request, but the bytes are paid twice by anyone who
  visits both routes.

Bundlers use heuristics (webpack's `splitChunks.minSize`/`minChunks`, rollup's
`manualChunks`, esbuild's automatic chunking) and the defaults are usually reasonable. **Check
anyway** — a duplication report is a two-line addition to your analysis script, and finding 40KB
duplicated across four route chunks is a common outcome.

## Cost 2: the request waterfall

```
single bundle:   HTML → bundle.js ────────────────────────► run
split:           HTML → main.js → route chunk → shared chunk ──► run
```

Each level of chunk dependency is a round trip the browser can only start **after** parsing the
previous one. On a 150ms-RTT connection a three-deep chunk graph adds 450ms before any of your code
runs, and no amount of byte-shaving removes it.

Fixes:

- **`<link rel="modulepreload">`** for the chunks you know a route needs — it flattens the
  waterfall by starting them all at once ([resource-hints lab 03](../../../resource-hints/labs/03-preload/)).
- **Fewer, larger chunks** for routes that are always used together.
- Preload the *next* route's chunk on hover/intent (lab 04).

## Where to put the boundaries

| Boundary | Usually right? |
|---|---|
| Per route | ✅ the default that works |
| Per heavy, rarely-used component (editor, chart, map, video player) | ✅ the biggest single wins |
| Per third-party library used in one place | ✅ |
| Below the fold / behind an interaction | ✅ |
| Per component, automatically | ❌ hundreds of tiny chunks; the waterfall and the per-request overhead dominate |
| "vendor" vs "app" | ⚠️ a 2018 pattern. It made sense when vendor code changed rarely and caches were shared; with content-hashed filenames it mostly means one dependency bump invalidates one huge chunk |

**The failure mode of over-splitting is real**: 200 chunks means 200 requests, 200 cache entries, a
deep waterfall, and a build that's slower than the app it produces.

## Splitting does not reduce total work

Look at the `total` column: splitting moved bytes, it didn't remove them. If a user visits every
route, they download slightly *more* than the single bundle (the chunking overhead). Splitting is
a bet that most users don't visit most routes — which is nearly always true, and worth checking
with your own analytics.

And it does **nothing** for hydration cost: the same components still hydrate when they render
([hydration-strategies lab 01](../../../hydration-strategies/labs/01-hydration-cost/)). People
conflate these constantly.

## Think about

- Your app has 40 routes. Do you make 40 chunks?
- Splitting made your app slower. How?
- Which is better for caching: one bundle or twenty chunks?

<details>
<summary>Answers</summary>

**40 routes.** Split the ones that are big or rarely visited; group the small common ones. A 3KB
route chunk is not worth a round trip — the request overhead exceeds the download. Use your
analytics: the routes with 1% of traffic and 30% of the bytes are the list.

**Splitting made it slower.** Most likely a waterfall: main → route → shared, three sequential
round trips before anything runs. Or too many tiny chunks, where per-request overhead dominates. Or
duplication meaning a two-route visit downloads more than the single bundle would have. All three
are visible in the analysis; none are visible in "total bundle size".

**Caching.** Twenty chunks *if* they're content-hashed and change independently — then a one-line
fix invalidates 4KB instead of 400KB. One bundle if everything changes together anyway. The
practical answer is a middle ground: separate the parts with genuinely different change rates
(your code vs a dependency you bump twice a year), and don't split further than that.
</details>

---

## 🏗️ Build challenge: chunk boundaries from data

Guessing boundaries is how you get 200 chunks. Derive them.

1. Instrument your app to record, per session, **which route chunks were actually loaded** and in
   what order. Send it with your RUM.
2. Compute, per route: visit share, chunk bytes, and *co-occurrence* (which routes are visited in
   the same session).
3. Recommend boundaries: routes that always co-occur → one chunk; routes with < 5% traffic and
   > 20KB → their own lazy chunk; modules shared by 2+ high-traffic chunks → the shared chunk.
4. Simulate: for the recorded session distribution, compute average bytes downloaded per session
   under the current boundaries and under your proposal. **That average is the metric**, not the
   size of any single chunk.
5. Add a duplication check that fails CI if any module appears in more than N output files.

**Done when:** you can show that a proposed re-chunking reduces average bytes per session, using
your own traffic distribution rather than an assumption about it.

---

## Interview questions

1. What creates a chunk boundary?
2. What are the two costs of splitting?
3. When does a shared chunk help, and when does duplication beat it?
4. Why can splitting make a page slower?
5. Does splitting reduce total bytes? Does it reduce hydration cost?
6. How would you decide chunk boundaries for a 40-route app?
