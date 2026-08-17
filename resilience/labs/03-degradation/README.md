# Lab 03 — Degradation ⭐⭐⭐⭐

**Goal:** decide in advance which parts of the page survive which failure.

**Primary metric:** how many widgets die when one dies.

> <http://localhost:8080/resilience/labs/03-degradation/>

---

## `Promise.all` is the bug

`Promise.all` rejects as soon as **one** promise rejects — so one failed widget discards the results
of the three that succeeded. That single choice is the most common cause of "the whole page is
broken because one API is down".

Use `Promise.allSettled` and handle each result, or give each widget its own independent load.

## The tier model

Do this exercise on your product, in writing, with the people who own the features. It takes an hour
and settles arguments that otherwise happen during an incident.

| Tier | Example | On failure | Blocks the page |
|---|---|---|---|
| **critical** | the product, the price, the checkout button | say so loudly, offer a retry | yes |
| **important** | reviews, stock, delivery estimate | labelled placeholder | no |
| **nice to have** | recommendations, recently viewed | hide silently | no |
| **decorative** | social proof, avatars, animation | hide silently | no |
| **analytics** | tracking, experiments | fail silently, **never block rendering** | never |

**Match the visibility of the failure to the importance of the feature.** A user who never knew
recommendations existed doesn't need an apology for their absence — an error box there is *worse*
than the gap. Getting this backwards produces pages covered in warning triangles everyone has
learned to ignore.

Three things fall out of the exercise immediately:

1. **Analytics and experiments are the lowest tier, always.** A tracking script that blocks
   rendering is a self-inflicted outage caused by code that produces no user value.
2. **The tier determines the fetch strategy.** Critical data is server-rendered or fetched first,
   with a generous timeout and a retry. Decorative data goes last, short timeout, no retry.
3. **A fallback is not an error message.** It's the smallest useful thing you can still show: cached
   data with a timestamp, a static default, a reduced feature.

## Don't replace the page

When the critical widget fails, the header, navigation, search and reviews still work. A user who
can navigate away is in a far better position than one staring at a full-page "Something went
wrong". Reserve the full-page error for when nothing on the page can be trusted — and even then,
keep the navigation.

## Timeouts make degradation possible

Without a timeout, **slow and broken are the same experience** — except slow is worse, because the
user waits before finding out.

```js
await fetch(url, { signal: AbortSignal.timeout(1500) });
```

Choose the number from the *user*, not the network. Lab 04.

## Think about

- Where does this live in a server-rendered app?
- Your recommendations API is slow, not down. Which is worse?
- Should a failed analytics call ever be retried?

<details>
<summary>Answers</summary>

**Server-rendered.** Same model, better tools: stream the critical tier first and let the rest
arrive when it can ([rendering-strategies lab 06](../../../rendering-strategies/labs/03-streaming/)),
with Suspense boundaries expressing the tiering directly in the component tree. The advantage over
the client-side version is that a slow tier-3 dependency can't delay the first byte at all — you've
made the degradation structural rather than a timeout race.

**Slow vs down.** Slow is worse, and it's the case people don't design for. "Down" is fast, obvious,
and triggers your fallback immediately. "Slow" holds a connection, a spinner, and often a lock,
degrades *everything* sharing the connection pool, and is invisible in an up/down dashboard. Treat
"slower than the timeout" as down — that's what the timeout is for.

**Retrying analytics.** Rarely, and never in a way the user can feel. Use `navigator.sendBeacon` or
`fetch(..., {keepalive: true})` and accept the loss: analytics data is statistical, so a few percent
lost changes nothing you'd decide differently. Retrying it competes for the same connections as the
requests that matter, on behalf of data nobody is waiting for.
</details>

---

## 🏗️ Build challenge

1. Write the tier table for your app's most important page. Get the product owner to sign it.
2. Audit for `Promise.all` in data-loading paths. Convert to `allSettled` or independent loads.
3. Give each widget a timeout matched to its tier, and a fallback matched to its tier.
4. Kill each dependency in turn (the injector in [lab 05](../05-chaos/)) and screenshot the result.
   Put the screenshots in the PR.
5. Add a test per tier-1 and tier-2 widget: dependency down → the rest of the page still renders.

**Done when:** every dependency in your critical page can be down without the page being down.

---

## Interview questions

1. Why is `Promise.all` a resilience bug in a UI?
2. What tier is your analytics script, and what follows from that?
3. When should a failure be invisible to the user?
4. What's the difference between a fallback and an error message?
