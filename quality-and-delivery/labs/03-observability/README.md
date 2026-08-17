# Lab 03 — Observability ⭐⭐⭐⭐⭐⭐

**Goal:** know that a user hit a bug, which release caused it, and what they were doing.

> <http://localhost:8080/quality-and-delivery/labs/03-observability/>

---

## Four listeners catch almost everything

```js
addEventListener('error', handler, true);          // note the CAPTURE flag
addEventListener('unhandledrejection', handler);
addEventListener('securitypolicyviolation', handler);
// plus one fetch wrapper, centrally
```

Two details that are easy to get wrong:

- **The capture flag.** Resource load failures — a broken image, a 404 script, a failed stylesheet —
  fire an `error` event that **does not bubble**. Without `capture: true` you never see them, and
  "the CDN dropped a chunk" is a real and common outage.
- **Unhandled rejections are the majority.** In an async codebase most errors are rejected promises,
  not thrown exceptions. A setup listening only for `error` misses most of what happens.

React error boundaries don't cover event handlers, async work, or anything outside React
([resilience lab 01](../../../resilience/labs/01-error-boundaries/)). These listeners are the floor
underneath them.

## What a good report contains

| Field | Why |
|---|---|
| **release / build id** | the most important field. Half of all investigations end here |
| **route pattern** (`/orders/:id`, not the URL) | raw URLs never aggregate |
| session/user id | to see the whole session, and to count **affected users**, not events |
| error type, message, stack | the stack is useless without source maps |
| **breadcrumbs** | the last N actions — the single most useful debugging field |
| browser, OS, viewport, DPR | a one-engine bug looks universal until you check |
| connection type, device memory | errors cluster on slow devices |
| a `handled` flag | separates crashes from things you recovered from |
| a fingerprint / grouping key | or one bug becomes 40,000 unique issues |

**Breadcrumbs turn a report into a fix.** A stack tells you where it exploded; breadcrumbs tell you
how the user got there:

```
navigate /orders → click "Refund" → POST /api/refund 500 → error
```

Record navigations, clicks on named elements, network calls with status, and state transitions. Cap
the list, scrub anything sensitive.

**Count affected users, not events.** One user in a retry loop generates 50,000 events and looks like
an emergency; a bug hitting 3% of checkouts generates fewer and *is* one.

## The four signals

| Signal | Tells you | The gap |
|---|---|---|
| errors | something is broken | nothing about slow-but-working |
| RUM (Core Web Vitals) | it's slow, and for whom | aggregate; needs attribution |
| traces | **where** the time went across services | the client half is usually missing |
| product analytics | whether people complete the task | lagging, rarely joined to the rest |

**The missing link in most setups is joining them.** Errors in one tool, performance in another,
funnels in a third — and nobody can answer "did conversion drop because of that error, or because the
page got slower?"

The cheapest fix is a **shared correlation id**: generate a session id in the browser and attach it
to every error, every RUM beacon, every analytics event, and every outgoing request header. Now three
vendors can be joined.

Distributed tracing extends it: propagate `traceparent` from the browser and your backend spans hang
off the same trace as the click that caused them. **The client half is what almost nobody does**, and
it's the half that explains "the API is fast but the page is slow".

**Sample deliberately:** 100% of errors (rare, each matters), a percentage of RUM (constant), 100% of
anything on a critical flow.

## Source maps and releases

A minified stack is noise:

```
TypeError: r is not a function
  at t (main.4f2a.js:1:48213)
```

1. Generate real source maps in production builds.
2. **Upload them to your error tracker at build time**, tagged with the release id.
3. **Don't serve them publicly** — omit the `sourceMappingURL` comment, or serve `.map` files only to
   authenticated requests. A public source map is your entire source code.
4. **Tag the release everywhere**: bundle, source map upload, error report, deploy annotation.

That last point makes "which deploy caused this?" a five-second question. Annotate your dashboards
with deploys and the correlation is usually visible without analysis.

**Deploys themselves cause errors.** A spike of `ChunkLoadError` after a release isn't a new bug, it's
version skew ([offline-and-pwa lab 05](../../../offline-and-pwa/labs/05-updates/)). Tag those
separately or they'll drown your signal every time you ship.

## Alerting

Alert on **user-visible symptoms**, not causes: crash-free session rate, checkout success rate, p75
LCP/INP per route, error rate as a **ratio** of sessions.

Two rules: **every alert must have an owner and a runbook** (an alert nobody can act on gets muted),
and **alert on a change in rate, not an absolute count** — traffic varies by time of day, and a
threshold tuned at 3pm fires every night at 2am until someone disables it.

## Think about

- Your error tracker shows 50,000 events from one user. Emergency?
- Why must the release id be in the bundle *and* the report?
- What can't error tracking tell you?

<details>
<summary>Answers</summary>

**50,000 events, one user.** Probably not — one client in a retry loop, an extension conflict, or a
bot. Check the affected-user count first; that's the number that maps to impact. But do look at *why*
one client produced 50,000: an unbounded retry loop is a real bug ([resilience lab
02](../../../resilience/labs/02-retries-and-idempotency/)) and it's also melting your quota and
hiding real signal.

**Release id in both places.** The report tells you which version the *user* was running, which is
frequently not the version you just deployed — service workers, long-lived tabs and CDN caching mean
old versions persist for days. And the source map that decodes the stack is only valid for that exact
build, so without the id you can't symbolicate. It's the join key for the whole system.

**What error tracking can't tell you.** Anything that fails *without* throwing: a button that does
nothing, a request that silently returns the wrong data, a page that renders an empty state because a
condition inverted, a form that saves to the wrong account. Those are silent, and they're caught by
product analytics (the funnel dropped) and RUM (something got slower), not by errors — which is why
the four signals only work together.
</details>

---

## 🏗️ Build challenge

1. Add all four listeners, with the capture flag, and a central fetch wrapper.
2. Attach release id, route pattern, session id and breadcrumbs to every report.
3. Wire source map upload into CI, tagged by release, and stop serving maps publicly.
4. Add `web-vitals` with attribution to the same endpoint, with the same session id.
5. Propagate a `traceparent` header from the browser to your API.
6. Build one dashboard: crash-free sessions, p75 INP/LCP by route, and checkout success — annotated
   with deploys.
7. Write a runbook for every alert. Delete alerts you can't write one for.

**Done when:** you can answer "which release, which route, which browser, what were they doing" for
any error in under a minute.

---

## Interview questions

1. Which four listeners, and why the capture flag?
2. What's in a good error report beyond the stack?
3. Why count affected users rather than events?
4. Why is the release id the most important field?
5. Why does a deploy produce an error spike that isn't a bug?
