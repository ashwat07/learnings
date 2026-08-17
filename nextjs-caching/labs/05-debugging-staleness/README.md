# Lab 05 — Debugging staleness ⭐⭐⭐⭐⭐⭐

**Goal:** given "the data is stale", identify which of the four caches is responsible — in under
five minutes, without guessing.

**Primary metric:** correct diagnosis on the first attempt.

---

## The decision procedure

Run it in this order. Each step eliminates a layer.

```
1. HARD RELOAD (Cmd-Shift-R). Is it still stale?
      no  → the ROUTER CACHE (client, lab 04)
      yes → keep going

2. Is the route ○ or ƒ in the build output?
      ○   → the FULL ROUTE CACHE (lab 03). Check its revalidate window.
      ƒ   → keep going

3. Check the data source's counter. Did the request reach it?
      no  → the DATA CACHE (lab 02). Check revalidate / tags.
      yes → keep going

4. Is the value wrong at the source?
      yes → not a Next cache at all: your API's own cache, a CDN in front of it,
            an HTTP cache header, or the database. Go read the http-caching course.
      no  → it is your rendering logic, not a cache.
```

Four questions, four answers, no speculation. Write this on a card.

## Practise it

Reproduce each symptom in the sandbox and confirm the diagnosis:

| Symptom | Reproduce | Layer |
|---|---|---|
| Back button shows old data | `/router-cache/a` ↔ `/b` via `<Link>` | router cache |
| Page frozen since deploy | `/static` in a production build | full route cache |
| Data frozen, page fresh | `/data-cache`, the `revalidate` row | data cache |
| Same query 4× per render | `/memo` with memoization defeated (add a random query param) | memoization not working |
| Fixed after a deploy — but not for everyone | a CDN in front, or the router cache in open tabs | outside Next |

## The tools, and what each proves

| Tool | Proves |
|---|---|
| **A counter on the data source** | whether the request happened at all. **The strongest evidence.** |
| `next build` output (○ / ƒ, revalidate, expire) | how the route was compiled |
| Dev-mode `logging: { fetches: { fullUrl: true } }` (this app enables it) | per-fetch cache HIT/MISS |
| `x-nextjs-cache` response header | route cache HIT/MISS/STALE, where the host exposes it |
| DevTools Network → the RSC payload requests | what the client fetched, and when |
| A timestamp rendered into the page | when the HTML was produced |

Rendering a timestamp and a version into every page — in a comment, or a `<meta>` — costs nothing
and turns most of these investigations into "look at the page source".

## The five bugs you'll actually hit

1. **"It works in dev."** Dev bypasses most caching. Reproduce with `build && start` before
   theorising.
2. **"I deployed and it's still old."** The data cache survives deploys. Revalidate the tags.
3. **"I marked it dynamic and it's still stale."** The router cache doesn't care that the route is
   dynamic (lab 04).
4. **"It's stale for some users."** A CDN in front of Next, with its own TTL. Two caches, two
   purges — and the one you forgot is the one serving the stale copy.
5. **"The same query runs 30 times."** Memoization defeated by a differing key, or a non-`fetch`
   read without `cache()`.

## The write-up

For an app you work on, produce a one-page table — this is the deliverable, and it's the thing that
makes an on-call handover possible:

| Data | Read where | Cached by | Window | Invalidated by | Worst-case staleness |
|---|---|---|---|---|---|

If you can't fill in the last column for a row, that row is a bug report waiting to happen.

## Think about

- A user reports stale data and a colleague can't reproduce it. What are the two most likely
  explanations?
- You have Next's four caches *plus* a CDN. How many places can a stale response come from, and how
  do you purge them coherently?
- What single piece of instrumentation would have made your last caching bug obvious?

<details>
<summary>Answers</summary>

**Not reproducible.** (1) The router cache — it's per tab and per session, so your colleague's fresh
tab is fine; (2) a CDN POP — geography, so different users get different edges. Both are "state that
lives somewhere you aren't looking". Ask for a hard refresh and their region.

**Five layers.** Router cache (client), full route cache, data cache, the CDN, and your API's own
cache/HTTP headers. Purge coherently by making invalidation flow one way: the write triggers a
server-side revalidation by **tag**, that tag also maps to a CDN surrogate key purge, and server
actions carry the refresh to the client. Anything you have to remember to do by hand will eventually
not be done.

**Instrumentation.** Almost always: a version/timestamp rendered into the page, plus a counter on
the data source. Between them they answer "when was this HTML made" and "did the request happen",
which is most of the diagnosis.
</details>

---

## 🏗️ The final build: a cache observability layer

1. Render a **build id, render timestamp and cache mode** into every page (a `<meta>` or an HTML
   comment). Include it in error reports.
2. Emit a **`Server-Timing`** header with per-layer marks: data-cache hit/miss, render time, total
   ([rendering-strategies lab 02](../../../rendering-strategies/labs/02-server-waterfalls/)).
3. Log **cache decisions** per request in production, sampled: route, static/dynamic, which fetches
   hit the data cache, and which tags were involved.
4. Build the **staleness table** above automatically from your tagging conventions, and publish it.
5. Add a **staleness alarm**: after a `revalidateTag`, poll the public URL until the new content
   appears and record the propagation time across every layer, CDN included. Alert if it exceeds
   your stated window — because your stated window is a promise to someone.

**Done when:** you can answer "how stale can this page be, and who do I ask to purge it?" for every
route, from a document that generates itself.

---

## Interview questions

1. Walk me through diagnosing "the data is stale" in a Next.js app.
2. Which cache survives a hard reload? Which doesn't?
3. Which cache survives a deploy?
4. A user sees stale data and you can't reproduce it. What are the two most likely causes?
5. What would you instrument so this is a five-minute investigation next time?
