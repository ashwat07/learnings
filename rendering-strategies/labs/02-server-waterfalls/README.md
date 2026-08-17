# Lab 02 — Server waterfalls ⭐⭐⭐⭐⭐

**Goal:** find and fix the reason an SSR page is slower than any of its queries, and start emitting
`Server-Timing` so anyone can see it.

**Primary metric:** server total vs the sum of its queries vs its slowest query.

> Open <http://localhost:8080/rendering-strategies/labs/02-server-waterfalls/>

---

## The arithmetic

```
sequential  total ≈ SUM of every query      200 + 600 + 900 = 1700ms
parallel    total ≈ MAX of every query      max(200, 600, 900) = 900ms
```

Same data, same HTML, same server:

```js
// 1700ms
const product    = await getProduct(id);
const recommends = await getRecommends(id);   // didn't need product
const reviews    = await getReviews(id);      // didn't need either

// 900ms
const [product, recommends, reviews] = await Promise.all([
  getProduct(id), getRecommends(id), getReviews(id),
]);
```

**Two `await`s in a row with no data dependency between them is a bug.** On the client it costs a
slow interaction; on the server it costs TTFB, and no amount of frontend work can hide it — the
browser has nothing to do but wait for the first byte.

It also degrades quietly: every data source someone adds extends the chain, so a page that was
fine last quarter is 3 seconds now and no single commit is to blame.

## Measure it

| mode | server total | sum of queries | slowest query | verdict |
|---|---|---|---|---|
| ssr | | | | |
| ssr-par | | | | |
| stream | | | | |

Then change the delays and re-run. Note that `stream`'s *total* matches parallel — but its TTFB
doesn't, which is Lab 03.

## `Server-Timing` — emit this in production

```
Server-Timing: db;dur=42, cache;dur=3, render;dur=18, total;dur=71
```

- DevTools shows it in the Network panel → Timing → *Server Timing*.
- `PerformanceResourceTiming.serverTiming` exposes it to your own RUM.
- It's the only way a frontend engineer can attribute a slow TTFB **without log access**, which is
  usually the actual blocker in diagnosing this class of bug.
- Requires `Timing-Allow-Origin` cross-origin.
- Never put anything secret in it — it's visible to anyone. Names and durations only.

The lab renders it as a waterfall chart so you can see the two shapes side by side. Build that for
your own app; it pays for itself the first time someone claims "the API is slow".

## The N+1, server-side

A listing that fetches each row's detail separately. Run the demo:

| Shape | ms |
|---|---|
| list query only | |
| list + 6 sequential detail queries | |
| list + 6 parallel detail queries | |

**Parallelising an N+1 makes it faster and doesn't make it right.** You've traded N round trips for
N times the concurrent database load — so it now falls over under *traffic* rather than under
*latency*, which is a harder failure to diagnose.

Fix order, always:

1. **Don't make the query.** Does the listing need per-row detail?
2. **Batch it.** One query with an `IN`, or a DataLoader-style batcher.
3. **Cache it.** Per request first, then across requests.
4. **Only then parallelise** what's left.

Same hierarchy as the client side: delete the work, batch it, cache it, then move it.

## Request deduplication

Four components on one page each need the product. That's good design — components owning their
own data requirements beats threading props through six layers. Four *queries* is not.

```js
const memo = new Map();
const getProduct = (id) => {
  if (!memo.has(id)) memo.set(id, fetchProduct(id));   // cache the PROMISE, not the value
  return memo.get(id);
};
```

Caching the promise is what deduplicates *concurrent* callers, not just sequential ones. It's the
same pattern as the SWR coalescing map in the caching course, and it is exactly what Next.js calls
**request memoization** (`nextjs-caching` lab 01) and what React's `cache()` does.

**Scope it per request.** A module-level memo on a server is a cross-user data leak waiting for a
bug — user A's data served to user B. If you take one thing from this lab into a code review, make
it that.

## Think about

- Your TTFB is 1.2s. What are the four things it could be, and how do you tell them apart in one
  request?
- When *should* two awaits be sequential?
- Why is a global (not per-request) memo on the server dangerous?

<details>
<summary>Answers</summary>

**Four causes of a slow TTFB.** (1) A data waterfall; (2) one genuinely slow query; (3) render
time itself (a huge tree, or synchronous work in the render path); (4) cold start / connection
setup / queueing before your code ran. `Server-Timing` with a mark per phase separates all four in
a single request, which is why emitting it is worth the twenty minutes.

**When sequential is correct.** When there's a real data dependency: you need the user's id from
the session to fetch their orders. The tell is whether the second call's *arguments* come from the
first call's result. If they don't, it's a bug.

**Global memo.** It's keyed by data identity, not by user identity, so anything user-specific
leaks across requests — and it survives between users on a warm server. If you want cross-request
caching, key it explicitly and consciously (and read the `Vary`/`private` lab in the HTTP caching
course, because the same mistake exists at the HTTP layer).
</details>

---

## 🏗️ Build challenge: a render-path profiler

Build the thing that makes this class of bug impossible to miss.

1. **A tracing wrapper** for your data layer: every call gets a name, a start, a duration, and its
   parent (so you can see the *shape*, not just the totals). `AsyncLocalStorage` in Node gives you
   the per-request context without threading a parameter through everything.
2. **Emit `Server-Timing`** on every server-rendered response, with one mark per data source plus
   `render` and `total`.
3. **Detect the waterfall automatically**: if `sum(durations) > 1.5 × total` the render is
   parallel; if `total ≈ sum` it's sequential. Log a warning in dev naming the calls that ran back
   to back, with their stacks. That warning is worth more than any dashboard.
4. **Detect N+1**: the same query name called more than K times in one request → warn with the
   call count and the arguments' shape.
5. **A per-request memo** with a dev-mode assertion that it is never shared across requests (tag
   it with a request id and throw if it's read under a different one).
6. **Report it in RUM**: read `serverTiming` off the navigation entry in the browser and send it
   with your Web Vitals, so you can correlate a bad LCP with a specific slow query in the field.

**Done when:** a deliberately sequential route trips the dev warning, an N+1 trips it, and your
RUM shows a p75 breakdown of TTFB by data source for a real page.

---

## Interview questions

1. An SSR page takes 1.7s; its slowest query takes 900ms. What's wrong?
2. When are two sequential `await`s correct?
3. What is `Server-Timing`, who can read it, and what must you not put in it?
4. You parallelise an N+1. What have you fixed and what have you made worse?
5. What is request memoization and what must its scope be?
6. How would you catch a new data waterfall in code review, mechanically?
