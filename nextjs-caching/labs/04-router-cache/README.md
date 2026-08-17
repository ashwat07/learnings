# Lab 04 — Router cache ⭐⭐⭐⭐⭐

**Goal:** understand the one cache that lives in the browser, and stop being surprised by "the back
button shows old data".

**Primary metric:** does a `force-dynamic` route's timestamp change on a client navigation?

> <http://localhost:3000/router-cache/a>, after a production build.

---

## The experiment

Both pages are `force-dynamic` — the server produces a **new timestamp on every render**, by
construction.

1. Load page A. Note its timestamp.
2. Click **"go to B (client navigation)"**, then **"back to A (client navigation)"**.
   → Did A's timestamp change?
3. Now use the **full page load** links for the same round trip.
   → Did it change this time?

| Navigation | A's timestamp changed? | Why |
|---|---|---|
| `<Link>` there and back | | |
| `<a href>` there and back | | |
| Browser back button | | |
| `router.refresh()` | | |

The route is dynamic. The server *would* have produced something new. The client had a payload
already and used it.

## What it is

An **in-memory, client-side** cache of RSC payloads for routes you've visited or prefetched. It
exists to make client-side navigation instant — including the back button, where the browser would
otherwise have nothing to show.

- **Where**: the browser, per tab.
- **Lifetime**: seconds to minutes depending on the version and whether the route is static or
  dynamic; cleared on a full page load.
- **Applies to**: `<Link>` navigations, `router.push/replace`, back/forward.
- **Does not apply to**: `<a href>`, a reload, a new tab.

## Why it surprises everyone

It's the only Next.js cache that **isn't on your server**, so:

- You can't inspect it in your logs.
- It ignores `revalidateTag`/`revalidatePath` — those are server-side. The server's cache is fresh
  and the client still shows the old payload.
- It applies to **dynamic** routes too, which people don't expect: "I marked it force-dynamic, why
  is it stale?"
- It's per tab, so one tab can be fresh and another stale.

The classic report: *"I update a record, navigate away, come back, and my change isn't there — but a
hard refresh shows it."* That sentence is a router-cache diagnosis with no further investigation
needed.

## Invalidating it

| Method | Effect |
|---|---|
| `router.refresh()` | refetch the current route's payload; keeps client state |
| A **server action** | automatically refreshes the router cache for affected routes |
| `revalidatePath` / `revalidateTag` **called from a server action** | invalidates server caches *and* the router cache for that navigation |
| A full page load | clears it entirely |
| `<Link prefetch={false}>` | avoids pre-populating it for that link |

**The rule that resolves most bugs:** mutate through a **server action**, not a bare `fetch` to a
route handler. A server action carries the invalidation back to the client automatically; a bare
`fetch` updates your database and leaves the client's cached payload untouched.

```jsx
// stale after mutation: the router cache still has the old payload
async function save() {
  await fetch('/api/save', { method: 'POST', body });
  router.push('/items');          // may render from the cache
}

// correct: the server action refreshes what it invalidated
async function save(formData) {
  'use server';
  await db.save(formData);
  revalidatePath('/items');
}
```

## Prefetching interacts with it

`<Link>` prefetches by default when it enters the viewport, which **populates** the router cache
before you click. Good for speed; it also means the payload you eventually render may have been
fetched some seconds earlier. If a route must always be fresh at click time, `prefetch={false}` plus
a `router.refresh()` on arrival is the honest combination — and you should be able to say why you
need it.

## Think about

- A user edits their profile, navigates away and back, and sees the old name. Which cache?
- Why doesn't `revalidateTag` fix it?
- Two tabs, one stale. Explain.

<details>
<summary>Answers</summary>

**Old name.** The router cache, almost certainly — the tell is that a hard refresh fixes it (a hard
load clears the client cache; server caches would still be stale after a refresh). Fix: mutate via a
server action with `revalidatePath`, or call `router.refresh()` after the mutation.

**`revalidateTag` doesn't fix it.** It runs on the server and invalidates server-side caches. The
browser's copy of the payload is untouched unless the invalidation happens *within a server action*,
which pipes the refresh back to the client that called it.

**Two tabs.** The cache is per tab, in memory. Tab A performed the mutation through a server action
and got its refresh; tab B has been open the whole time with its own payload and no reason to know
anything changed. Real-time correctness across tabs is a different problem — `BroadcastChannel`, a
websocket, or refetching on `visibilitychange`.
</details>

---

## 🏗️ Build challenge

1. Build a small CRUD flow twice: once mutating through a **route handler** + `router.push`, once
   through a **server action** with `revalidatePath`. Demonstrate the stale read in the first and its
   absence in the second.
2. Add **cross-tab invalidation**: `BroadcastChannel` message on mutation, `router.refresh()` in
   other tabs. Prove it with two windows.
3. Add a `visibilitychange` refresh for long-lived tabs, and decide (and document) how stale is too
   stale for your data.
4. Measure the cost: how many extra payload requests does aggressive refreshing cause? There is a
   real trade between freshness and requests, and it should be a number.

**Done when:** a mutation in one tab is visible in another within a second, and you can state the
request cost of that guarantee.

---

## Interview questions

1. Where does the router cache live, and what does it store?
2. Why doesn't `revalidateTag` clear it?
3. Why can a `force-dynamic` route still serve stale content?
4. What's the difference between mutating via a server action and via a route handler?
5. How would you make two tabs agree?
