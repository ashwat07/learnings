# Lab 02 — Data cache ⭐⭐⭐⭐⭐

**Goal:** know exactly which fetches persist across requests, for how long, and how to invalidate
them on purpose.

**Primary metric:** does `servedAt` change between reloads?

> <http://localhost:3000/data-cache> · counter at <http://localhost:8080/api/stats>

---

## What it is

A persistent, server-side cache of `fetch` results. It survives requests, users, **and deploys** —
which surprises people the first time a fix doesn't take effect after a deploy.

Four fetches of the same endpoint, four instructions:

| Call | Cached? |
|---|---|
| `fetch(url)` | **version-dependent — measure it** |
| `fetch(url, { cache: 'no-store' })` | never |
| `fetch(url, { next: { revalidate: 10 } })` | yes, for 10s |
| `fetch(url, { next: { tags: ['products'] } })` | yes, until the tag is revalidated |

Reload the page a few times and fill in:

| Call | `servedAt` changes on reload? | Cached? |
|---|---|---|
| default | | |
| `no-store` | | |
| `revalidate: 10` | | |
| `tags: ['products']` | | |

**Measured on Next 16.3.1 (this app):** default → changes (not cached); `no-store` → changes;
`revalidate` → frozen for 10s; tagged → frozen until revalidated.

## The default changed, and it matters

- **Next 13–14**: `fetch` was cached **by default**; you opted out with `no-store`. Upgrading an app
  that relied on this silently made every request hit the origin.
- **Next 15+**: `fetch` is **not** cached by default; you opt in.

Which is why the transferable skill is the counter, not the rule. Whatever version you're on:

```sh
curl -s http://localhost:8080/api/reset >/dev/null
curl -s http://localhost:3000/data-cache >/dev/null
curl -s http://localhost:3000/data-cache >/dev/null
curl -s http://localhost:8080/api/stats | grep dc-
```

Two page loads. Which keys went up by 2, and which by 1?

## Invalidation

| Method | Scope | Use for |
|---|---|---|
| `revalidate: N` | that fetch | time-bounded staleness you can state out loud |
| `revalidateTag('products')` | every fetch tagged `products`, everywhere | **a webhook when content changes** |
| `revalidatePath('/products')` | that route's data and route cache | a change you know affects one page |

Tags are the good one. Try both buttons on the page and watch which timestamps move.

```js
// tag at read time
const products = await fetch(url, { next: { tags: ['products', `product:${id}`] } });

// invalidate at write time — from a server action or a CMS webhook
revalidateTag(`product:${id}`);
```

That's the same design as CDN surrogate keys ([asset-optimization lab 05](../../../asset-optimization/labs/05-cdn-and-edge/)):
the *response* declares its dependencies at render time, so you don't maintain a
change → URL-list mapping in application code, which always rots.

## Two things that catch people

**1. It survives deploys.** The data cache is not per-build. A fix that changes how you *render*
data ships immediately; a fix that depends on *new* data may not, because the old response is still
cached. If you need a clean slate, revalidate the tags as part of the deploy.

**2. `no-store` opts the whole route out of static rendering** (lab 03). It's not only a data
decision — one `no-store` deep in a component tree makes the route dynamic, and you'll wonder why
the page is server-rendering on every request. Same for `cookies()`/`headers()`.

## Think about

- You add `revalidate: 3600` to a fetch and change the data. When do users see it?
- Your CMS publishes a correction. Which invalidation, and where does it live?
- Why is the data cache surviving deploys sometimes a problem?

<details>
<summary>Answers</summary>

**`revalidate: 3600`.** Up to an hour later, plus one request — and *only if someone asks*.
Revalidation is pull-driven: on a low-traffic page nothing refreshes until a visitor arrives. Exactly
the staleness window from [rendering-strategies lab 04](../../../rendering-strategies/labs/04-ssg-and-isr/).

**CMS correction.** `revalidateTag` from a webhook the CMS calls on publish, tagging by entity
(`product:42`, `post:99`) rather than by page. The webhook handler lives in a route handler or a
server action, and it should be authenticated — an open revalidation endpoint is a cheap way for
someone to hammer your origin.

**Surviving deploys.** Because the cache key is the fetch, not the build. Ship a change to how a
price is *computed* server-side, and users still get the cached response. It's the right default
(you don't want a deploy to cold-start every cache) and it needs a deliberate step when your deploy
changes the data's meaning.
</details>

---

## 🏗️ Build challenge

1. Add a **tagging convention** to a real app: every read tags itself with its entity type and id.
   Write it down as a rule (`entity:id`, plus a collection tag) — undisciplined tags make
   invalidation unpredictable.
2. Build the **webhook endpoint**: authenticated, idempotent, and it logs what it invalidated.
3. Add a **staleness dashboard**: for each tagged dataset, when it was last revalidated and its
   configured window. This is the artefact that lets you answer "how out of date can this be?"
   without guessing.
4. **Test invalidation**: an automated test that changes data at the source, calls the webhook, and
   asserts the page reflects it within N seconds. This test catches the whole class of "we thought
   the webhook was wired up" bugs.
5. Measure origin load before and after adding caching, and staleness exposure (how many requests
   served data older than X).

**Done when:** you can publish a change in your CMS and see it live in under 5 seconds, without a
deploy, and prove it with a test.

---

## Interview questions

1. What does the data cache cache, and how long does it live?
2. What's the default caching behaviour for `fetch` in the Next version you use? How did you check?
3. `revalidateTag` vs `revalidatePath` — when each?
4. Why does the data cache survive deploys, and when is that a problem?
5. What else does `cache: 'no-store'` affect besides that one fetch?
