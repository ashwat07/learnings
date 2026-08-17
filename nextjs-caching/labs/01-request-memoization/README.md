# Lab 01 — Request memoization ⭐⭐⭐⭐

**Goal:** let components fetch their own data without turning one page into N queries.

**Primary metric:** hits on the data source per page render.

> <http://localhost:3000/memo> · counter at <http://localhost:8080/api/stats>

---

## The problem it solves

Colocating data with the component that needs it is good design — it beats threading props through
six layers. But four components needing the same user is not four queries.

```jsx
async function Header()  { const u = await getUser(id); … }
async function Sidebar() { const u = await getUser(id); … }
async function Body()    { const u = await getUser(id); … }
async function Footer()  { const u = await getUser(id); … }
```

**Request memoization** deduplicates identical `fetch` calls within a single render pass. It's a
**React** feature, not a Next.js cache — which explains all of its properties:

- lifetime = **one render pass** (one request)
- never shared between users or requests
- nothing to invalidate; it evaporates when the render ends
- keyed on URL + options

## Measure it

```sh
curl -s http://localhost:8080/api/reset > /dev/null
curl -s http://localhost:3000/memo > /dev/null
curl -s http://localhost:8080/api/stats | grep next-memo
```

Five call sites (`Header`, `Sidebar`, `Body`, the page itself, plus a `cache()`d pair in `Footer`).
Expected: **+1 per reload** for `next-memo`, +1 for `next-memo-computed`.

| | hits after 1 load | after 2 loads |
|---|---|---|
| `next-memo` (5 fetch call sites) | | |
| `next-memo-computed` (2 `cache()` call sites) | | |

## `cache()` — for everything that isn't a fetch

`fetch` is memoized automatically. A database query, a file read, an SDK call is not:

```js
import { cache } from 'react';

export const getUser = cache(async (id) => db.user.findUnique({ where: { id } }));
```

Same lifetime, same scope, same invalidation story (none). If you use an ORM rather than `fetch`,
**wrap every read in `cache()`** — otherwise colocated data fetching quietly becomes an N+1 per
render.

## What it is not

| | Request memoization | Data cache (lab 02) |
|---|---|---|
| Lives for | one render | across requests and deploys |
| Shared between users | **never** | yes |
| Survives a refresh | no | yes |
| Invalidated by | nothing | `revalidate`, tags, paths |

This distinction matters for correctness, not just performance: memoization can never leak one
user's data to another, because it doesn't outlive the request. A hand-rolled module-level `Map`
*can*, and that's the bug this exists to prevent (see
[rendering-strategies lab 02](../../../rendering-strategies/labs/02-server-waterfalls/)).

## Gotchas

- **Only identical calls dedupe.** Different URLs, methods, headers or bodies are different keys.
  A cache-busting parameter defeats it.
- **`POST` is not memoized** (nor are other non-GET methods) — correctly, since they may have
  effects.
- **It doesn't parallelise.** Four `await`s in a row still run sequentially even when three of them
  are cache hits; the hits are just instant. Deduplication and concurrency are different problems
  ([rendering-strategies lab 02](../../../rendering-strategies/labs/02-server-waterfalls/)).
- **It doesn't cross a `Suspense` boundary boundary in the way you might hope** — it's per render
  pass, and a streamed segment rendering later still shares the same pass, but a *separate request*
  (a router prefetch, say) does not.

## Think about

- You use Prisma, not `fetch`. What do you have to do?
- Your page makes 12 queries for 4 distinct pieces of data. What's happening?
- Could request memoization ever serve one user's data to another?

<details>
<summary>Answers</summary>

**Prisma.** Wrap each read in React's `cache()`. Without it, every component that asks gets its own
query — and the symptom is a page that gets slower as you add components, which nobody attributes
to data fetching.

**12 queries, 4 pieces of data.** The keys differ: a timestamp or random value in the URL, different
headers per call site, a non-GET method, or the calls are `cache()`-less non-fetch reads. Log the
exact keys and compare them character by character; it's always something small.

**Cross-user leakage.** No — that's the point of the lifetime. It exists only for the duration of
one render pass and is discarded. A module-level `Map` used as a "cache" *can* leak, which is why
you should reach for `cache()` rather than inventing one.
</details>

---

## 🏗️ Build challenge

Instrument it, because "how many queries did that page make?" should not require a counter you set
up by hand.

1. Wrap your data layer so every read logs: the key, the call site (a stack frame), whether it was a
   memoization hit, and the duration.
2. Aggregate per request (`AsyncLocalStorage`) and log a summary: total reads, distinct keys, hits,
   total data time, and whether the reads were sequential or concurrent.
3. **Warn on N+1**: the same key called more than K times with different arguments in one render.
4. **Warn on waterfalls**: total data time ≈ sum of individual times means sequential.
5. Expose it as a dev-only overlay so the number is visible while you build, not after someone
   complains.

**Done when:** adding a component that needs already-fetched data changes the query count by zero,
and your overlay proves it.

---

## Interview questions

1. What is request memoization, and what is its lifetime?
2. Why is it a React feature rather than a Next.js cache?
3. What do you do if you use an ORM instead of `fetch`?
4. Does it help with a data waterfall?
5. Can it leak data between users?
