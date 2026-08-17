# Lab 04 — SSG & ISR ⭐⭐⭐⭐⭐

**Goal:** be able to state your staleness window out loud, say who pays for a regeneration, and
know when a page count makes SSG impossible.

**Primary metric:** cache state (MISS/HIT/STALE) per request, and how many concurrent requests wait
on a stale entry.

> Open <http://localhost:8080/rendering-strategies/labs/04-ssg-and-isr/>

---

## The three states

```
             ┌── fresh (age < revalidate) ──► HIT    ~0ms, possibly stale content
request ─────┤
             ├── stale (age > revalidate) ──► STALE  ~0ms, + ONE background refresh
             └── absent ────────────────────► MISS   full render; this visitor waits
```

The sandbox's ISR is literally stale-while-revalidate implemented on the server — the same idea as
the HTTP header from [the caching course](../../../http-caching/labs/03-stale-while-revalidate/),
in a different place. Read `cachedRender()` in
[`shared/app/render.mjs`](../../../shared/app/render.mjs); it's 25 lines.

## Measure it

Poll for 20 seconds with `revalidate=4`, and bump the content halfway:

| t+s | ms | cache | age | content version |
|---|---|---|---|---|
| | | | | |

Then answer, from your own data: **how many polls after the bump did the new version first
appear?** That gap is your staleness window, and it's the number that belongs in a design document.

## The staleness window, precisely

```
revalidate = N seconds

worst case a user sees stale content = N seconds + one request
```

Because: the entry goes stale at N; the *next* request is served stale and triggers the refresh;
the request *after that* gets the new copy. So with `revalidate: 60` on a low-traffic page, a user
can see hour-old content — the refresh only happens when someone asks.

Say it out loud to whoever owns the data before picking the number: *"our prices can be up to 60
seconds out of date, plus one request."* If that sentence is unacceptable, you need on-demand
invalidation, not a smaller number.

## Who pays for the regeneration?

Run the **who pays** demo. It fires ten concurrent requests at a stale entry:

- **Correct implementation: zero people wait.** All ten get the stale copy; exactly one background
  refresh runs.
- **Naive implementation: ten people wait**, and your origin does ten identical renders.

That second case is a **cache stampede**, and it's how a caching layer converts a traffic spike
into an outage. The defence is the coalescing flag (`refreshing`) — four lines, and the same
pattern as the SWR map in the caching and service-worker courses.

Ask this question of any cache you inherit. It's the difference between a cache and a liability.

## On-demand invalidation

`revalidate` is a guess about how often data changes. A webhook is knowledge.

```
editor publishes → invalidate the tag → next request regenerates
```

This converts "stale for up to N seconds" into "stale until the webhook lands", which is usually a
much better product. Two things to get right:

- **Invalidate by tag, not by path.** One product change shouldn't invalidate the whole catalogue.
  (Next.js's `revalidateTag` vs `revalidatePath` is exactly this distinction — see the
  [nextjs-caching](../../../nextjs-caching/) course.)
- **Regenerate in the background**, not on the next request, if the page is popular. Otherwise
  every invalidation is a small stampede.

## Build time is the real constraint

At ~0.9s of data fetching per page with 8 concurrent workers:

| Pages | Build (8 workers) | Verdict |
|---|---|---|
| 100 | ~11s | SSG is fine |
| 1,000 | ~2 min | SSG is fine |
| 10,000 | ~19 min | SSG with incremental builds and cached data |
| 100,000 | ~3 h | ISR / on-demand |
| 1,000,000 | ~31 h | not a build |

Long before the top of that table you've lost the ability to deploy casually — and **a deploy you
can't do casually is a deploy that doesn't happen**, which is a worse problem than any rendering
metric.

The ladder:

- **hundreds** → SSG, rebuilt every deploy
- **thousands** → SSG + incremental builds (only what changed) + a cached data layer
- **tens of thousands+** → ISR / on-demand: render the first time someone asks, then cache
- **per-user** → not static at all; SSR or streaming

ISR also buys something SSG structurally cannot: **pages that were never built.** A product added
five minutes ago is renderable without a deploy.

## Think about

- A page has `revalidate: 60` and gets one visitor per hour. How stale can it be?
- Your CMS publishes a correction. What's the fastest safe path to every user seeing it?
- Why is "SSG for everything" a deployment problem before it's a performance one?

<details>
<summary>Answers</summary>

**One visitor per hour.** Up to an hour stale, plus one request. Revalidation is *pull*-driven:
nothing refreshes a page nobody asks for. Low-traffic pages are the ones most likely to serve
badly stale content, which is the opposite of most people's intuition. On-demand invalidation is
the fix.

**Fastest safe path.** On-demand invalidation by tag from the CMS webhook, plus a CDN purge for the
same tag (both layers cache — invalidating only one leaves the other serving the old copy, and
that's the bug you'll spend an afternoon on). Then verify by fetching the public URL, not the
origin.

**Deployment problem.** A 40-minute build means: no quick fixes, batched releases, a rollback that
takes 40 minutes, and CI costs that grow with your catalogue. Teams respond by deploying less,
which makes every deploy riskier. The performance win of SSG over ISR at the edge is small; the
operational difference is large.
</details>

---

## 🏗️ Build challenge: a tagged regeneration layer

Build the caching layer you'd want behind a real site.

```js
const page = await renderCached(`/product/${id}`, {
  revalidate: 60,
  tags: [`product:${id}`, 'catalogue'],
  render: () => renderProduct(id),
});

await invalidateTag(`product:${id}`);     // from a webhook
```

Requirements:

1. **Tag-based invalidation**: a tag → keys index, so one product change invalidates that product's
   page and the listings it appears on, and nothing else.
2. **Stampede protection**: one in-flight regeneration per key, everyone else served stale. Prove
   it with 100 concurrent requests at a stale entry — exactly one render.
3. **Background regeneration on invalidate** for hot keys (track a hit counter), on-demand for cold
   ones. Report which strategy each key got and why.
4. **Bounded memory**: LRU by bytes, because rendered HTML is big and a million pages won't fit.
   Report evictions.
5. **A staleness report**: for each cached key, the age, the tags, and the worst-case staleness a
   user could have seen. This is the artefact that lets you answer "how out of date can this be?"
   without guessing.
6. **Two-layer coherence**: emit `Cache-Control` + a surrogate key header so a CDN can be purged by
   the same tag, and write down what happens if the purge succeeds and the origin invalidation
   fails (and vice versa).

**Done when:** 100 concurrent requests to a stale key produce exactly one render, a tag purge
invalidates the right set and nothing more, and your staleness report matches what you observe.

---

## Interview questions

1. What are the three cache states, and what does each cost?
2. Define your staleness window for `revalidate: 30`, precisely.
3. Ten requests arrive at a stale entry. How many should wait, and how do you guarantee it?
4. When is `revalidate` the wrong tool?
5. Why does a low-traffic page serve staler content than a high-traffic one?
6. At what point does page count rule out SSG, and what breaks first?
