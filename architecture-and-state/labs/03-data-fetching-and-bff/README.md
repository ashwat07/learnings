# Lab 03 — Data fetching & the BFF pattern ⭐⭐⭐⭐⭐

**Goal:** kill the client-side N+1 and the request waterfall, and know when a
backend-for-frontend earns its keep.

**Primary metric:** requests per screen, and time to the last one.

> Sandbox: <http://localhost:5173/#state> (server-state panel) · lab server counters at
> <http://localhost:8080/api/stats>

---

## The three shapes that make a screen slow

**1. The waterfall** — each request waits for the one before it:

```js
const user = await getUser(id);              // 200ms
const orders = await getOrders(user.id);     // 300ms  ← genuinely depends on user
const items = await getItems(orders[0].id);  // 300ms  ← genuinely depends on orders
// 800ms, and three round trips, and it is CORRECT
```

Real dependencies you cannot parallelise are a **protocol** problem, not a code problem — which is
what the BFF fixes.

**2. The client-side N+1:**

```js
const orders = await getOrders();                                  // 1 request
const details = await Promise.all(orders.map((o) => getOrder(o.id)));  // 50 more
```

Parallelising it makes it faster and not right (see
[rendering-strategies lab 02](../../../rendering-strategies/labs/02-server-waterfalls/)): you now do
51 round trips and 51× the backend load, from a device on a mobile network.

**3. The duplicate fetch** — four components each fetch the user. Fixed by a query cache's
deduplication (lab 02), which is why that's the first thing to reach for.

## What a BFF is, and what it is for

A thin server that exists **for one client**, sitting between it and your services:

```
without a BFF                        with a BFF
browser ──► /users/42                browser ──► /screens/order-detail/42
        ──► /orders?user=42                          │
        ──► /items?order=99                          ├──► users
        ──► /shipping/99                             ├──► orders     (in parallel,
        ──► /reviews?item=…                          ├──► items       in a datacentre)
   5+ round trips over mobile                        └──► shipping
                                              one round trip, one payload
```

What it buys, in order of importance:

1. **Round trips.** Five 150ms mobile round trips become one. This dominates everything else.
2. **Payload shape.** Send the 8 fields the screen renders, not the 60 the domain service returns.
3. **Aggregation without coupling.** The screen's needs change without touching domain services.
4. **A place for cross-cutting concerns**: auth token exchange, rate limiting, caching, field-level
   authorisation.
5. **Secrets stay server-side** — API keys never reach the client.

What it costs: another deployable, another place for logic to hide, another team boundary, and a
new failure mode (the BFF is down, so *everything* is down). It's also a strong candidate for
becoming a distributed monolith if every team edits it.

### The alternatives, honestly

| Approach | Good when | Bad when |
|---|---|---|
| **BFF** | multiple round trips per screen; different clients need different shapes | one client, simple screens |
| **GraphQL** | many clients, wildly varying needs, a schema you control | you need caching (it's harder), or the query cost is unbounded |
| **RSC / server components** | you're already server-rendering — the "BFF" is the server component tree ([rendering-strategies lab 05](../../../rendering-strategies/labs/05-rsc-model/)) | you're a pure SPA |
| **Just fix the endpoints** | you own the API | you don't |
| **Batch endpoint** (`POST /batch`) | quick win over an API you don't own | it's a BFF with worse ergonomics |

The most common right answer for a team that already server-renders is the third row: **you may
already have a BFF and be calling it a page.**

## The exercise

Take one real screen and:

- [ ] Count the requests it makes on a cold load, and the depth of the longest chain.
- [ ] Classify each: genuinely dependent, accidentally sequential, or duplicate.
- [ ] Fix the accidental ones with `Promise.all` and the duplicates with a query cache.
- [ ] For the remainder, sketch the BFF endpoint that would collapse them, and estimate the saving:
      `(round trips saved) × RTT`.
- [ ] Decide whether that saving justifies the operational cost — and write the decision down either
      way.

## Think about

- Your screen makes 12 requests. How do you decide which are a problem?
- A BFF endpoint per screen — doesn't that couple the backend to the UI?
- What happens to caching when you aggregate five resources into one payload?

<details>
<summary>Answers</summary>

**Which of 12.** Sort by *dependency*, not count. Requests that start together and finish together
cost one round trip's latency and are fine. The problem is chains (each waiting on the last) and
duplicates. Twelve parallel requests on HTTP/2 is often fine; three sequential ones can be worse.

**Coupling.** Yes — deliberately, and that's the point: the coupling is confined to a layer that the
*frontend team owns and deploys*, instead of being spread across the client or pushed into domain
services. The failure mode to avoid is a BFF owned by a different team, which gives you the coupling
and the coordination cost.

**Caching after aggregation.** It gets harder, and this is the real cost people miss. Five resources
with different volatility (a product that changes daily, a stock level that changes by the second)
become one response whose cacheability is that of its most volatile part. Mitigations: split the
aggregate along cache-lifetime lines, cache per-resource *inside* the BFF, or stream the volatile
part separately ([rendering-strategies lab 03](../../../rendering-strategies/labs/03-streaming/)).
</details>

---

## 🏗️ Build challenge: build the BFF

Use the lab server as your "domain services" (`/api/asset?name=…&delay=…` with hit counters).

1. Write a small BFF (Node, no framework needed) exposing one `/screens/:name` endpoint that fans
   out in parallel, reshapes, and returns exactly what the screen renders.
2. Add **per-resource caching inside the BFF** with different TTLs, and prove with the counters that
   a hot screen hits the domain services far less than once per request.
3. Add **partial failure handling**: if reviews fail, return the rest with `reviews: null` and a
   `warnings` array. A BFF that 500s because one non-critical dependency did is worse than no BFF.
4. Add a **timeout per dependency** with a fallback, so one slow service can't hold the whole screen
   (the same idea as service-workers lab 03).
5. Measure: requests per screen, bytes, and time-to-last-byte, client-side, before and after.
6. Then ask the honest question: could server components have done this without the extra
   deployable? Write down why you did or didn't choose them.

**Done when:** the screen makes one request instead of five, one failing dependency degrades one
section, and you have both sets of numbers.

---

## Interview questions

1. Distinguish a waterfall, an N+1, and a duplicate fetch. Which is worst on mobile?
2. What does a BFF buy, in order of importance?
3. What does aggregation do to your caching story?
4. When is GraphQL the better answer? When is it worse?
5. If you already server-render, do you need a BFF?
