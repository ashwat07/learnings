# Lab 06 — Choose per route ⭐⭐⭐⭐⭐⭐

**Goal:** pick a rendering strategy per route and defend each choice with the one fact that decided
it — which is the actual interview question, and the actual job.

**Primary metric:** 14 routes, graded, with reasons.

> Open <http://localhost:8080/rendering-strategies/labs/06-choose-per-route/>

---

## Part 1 — the exercise

Fourteen routes, each with the facts that decide it. Choose cold, grade, then read every
explanation — including for the ones you got right.

Then do the harder half: **for every route, name the single fact that decided it.** If you can't,
you guessed.

## The six facts that decide, in order of force

1. **Is it per-user?** → rules out static caching, or forces a page split.
2. **Does SEO matter?** → rules out client-only rendering.
3. **How fresh must it be?** → sets the revalidate window, or rules out caching entirely.
4. **How many pages are there?** → rules out build-time generation.
5. **Is one query much slower than the rest?** → argues for streaming boundaries.
6. **What's the traffic?** → decides whether any of this is worth your time.

Everything else — framework, fashion, what the last team used — is downstream of those six.

## The default answer for a mixed app

Most real apps are:

```
marketing, docs, blog        SSG (+ on-demand invalidation from the CMS)
catalogue, product pages     ISR, with slow sections streamed or client-loaded
search, feed                 streaming SSR for the first screen, client for the rest
app pages behind auth        CSR or RSC — no SEO, no cacheable output
checkout                     SSR, no-store, no caching anywhere
status page                  ISR + stale-if-error at the edge
internal tools               CSR; spend the effort elsewhere
embeds                       static + one island
```

Note that this is **five different strategies in one app**, and that's normal. "We're an SSR shop"
is a statement about tooling, not a decision about rendering.

## The four traps the grader enforces

| Trap | Why it's wrong |
|---|---|
| SSR on a page that never changes | A render per request for byte-identical output |
| SSG/ISR on per-user content | You will serve one user's page to another |
| Caching a checkout | A security incident, not an optimisation |
| SSR on a status page | **Your status page goes down with your app.** A real, recurring outage pattern |

That last one is worth remembering as a general principle: *the page people load when your
infrastructure is failing must not depend on your infrastructure.*

## The split that resolves most arguments

"This page is personalised, so it can't be cached" is almost always false. It's usually **95% shared
and 5% personal**:

```
static/ISR shell (cacheable, SEO-visible, fast)
  └── streamed or client-loaded island: stock level, cart count, "your price"
```

Streaming (Lab 03) is what makes this practical: the shared page stays cacheable at the edge, and
the per-user fragment arrives in the same response. Before you accept "we have to SSR this", ask
what fraction of the bytes are actually per-user.

## Part 2 — do it for your own app

The deliverable is a one-page table, and it's the artefact worth having:

| Route | Strategy | Deciding fact | Revalidate / staleness | Cacheable at the edge? | What we'd have to change to do better |
|---|---|---|---|---|---|

That last column is the one that makes it useful. "This is SSR because the price is embedded in the
page and our CMS has no webhook" is a *roadmap item*, not a rendering decision.

## Think about

- Which routes in your app are SSR only because everything is SSR?
- Which routes are personalised in a way that is actually 5% of the page?
- Which route would you least like to be un-cacheable during an incident?

---

## 🏗️ Build challenge: a route strategy audit

Make the table above generate itself.

`route-audit.mjs`:

1. Enumerate the app's routes (from the router config or the filesystem).
2. For each, detect: does it read cookies/headers/auth? does it use a dynamic function that opts out
   of static rendering? what data sources does it touch, and what are their p75 latencies? is it in
   the sitemap (i.e. does SEO matter)? what's its traffic share (from analytics)?
3. Infer the *current* strategy from the build output, and flag mismatches against the six facts —
   e.g. "SEO-critical route rendering client-side", "static route opted out of caching by a
   `cookies()` call", "route with a 900ms data source and no streaming boundary".
4. Estimate the cost of the current mix: server-render seconds per 1,000 visits, edge cache hit
   ratio, client JS per route.
5. Rank the findings by `traffic × improvement`, because a perfect strategy on a route nobody
   visits is worth nothing.

**Stretch:** detect the "accidentally dynamic" case specifically — a route that *would* be static
except for one call. In Next.js that's usually a single `cookies()`, `headers()` or
`noStore()` deep in a component, and finding it by hand is miserable.

**Done when:** it names one route in a real app whose strategy is wrong, with the deciding fact and
the estimated win — and the fix turns out to be one line.

---

## Interview questions

1. Walk me through choosing a rendering strategy for a marketplace: home, category, product,
   search, cart, checkout, seller dashboard.
2. A page is "personalised so it can't be cached". How do you challenge that?
3. Why should a status page never be server-rendered per request?
4. Your app is entirely SSR. Which routes would you move first, and how would you prioritise?
5. What single fact most often decides the strategy?
6. How would you know, from production data, that a route's strategy is wrong?
