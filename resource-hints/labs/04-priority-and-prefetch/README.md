# Lab 04 — Priority & prefetch ⭐⭐⭐⭐

**Goal:** control the *order* of requests deliberately, and speculate about the next navigation
without wasting the user's data.

**Primary metric:** LCP for the priority pages; next-navigation LCP for the prefetch pages.

> Open <http://localhost:8080/resource-hints/labs/04-priority-and-prefetch/> with the Network
> panel's **Priority** column enabled and Fast 4G throttling on.

---

## The concept

Priority is a **ranking under contention**, not a speed setting. On an unconstrained connection it
changes nothing; on a real one it decides who goes first, and total time is unchanged. That's why
it's so effective for LCP (one resource matters more than everything else) and useless when
applied to everything.

The browser's own guesses are good except for two things it cannot know:

1. **Which image is the LCP.** It starts every image at Low priority and raises it only after
   layout proves it's in the viewport — which is after CSS. `fetchpriority="high"` skips that wait.
2. **Where the user is going next.** That's `prefetch` and Speculation Rules.

## Measure it

**Page 01 — fetchpriority**

| | LCP | Hero request started at | Hero priority |
|---|---|---|---|
| no hints | | | |
| `?fix=1` | | | |

**Page 02 — lazy loading**

| | LCP | Images fetched on load |
|---|---|---|
| all lazy (including hero) | | |
| `?fix=1` (hero eager+high) | | |

**Page 03 — prefetch**: note the next page's LCP with and without the prefetch. A prefetched
resource shows `transferSize: 0` on the next page.

**Page 04 — Speculation Rules**: hover a link for ~200ms, then click. Compare the prefetched
target to the prerendered one — prerender should feel instant, because it is.

## `fetchpriority` in one table

| Use | Effect |
|---|---|
| `<img fetchpriority="high">` on the LCP image | The single best-value hint there is |
| `<img fetchpriority="low">` on carousel slides 2–n | Stops them competing with slide 1 |
| `<script async fetchpriority="low">` on analytics | Frees bandwidth for content |
| `fetch(url, {priority: 'low'})` | `fetch` defaults to High even for trivial requests — mark background work Low |
| On everything | Nothing. You've re-encoded the default ranking |

## `loading="lazy"` — the LCP footgun

Lazy loading below the fold is excellent: bytes never spent. Applying it to the LCP image is a
self-inflicted regression, because the browser must run layout before it can decide the image is
needed. The codemod that adds `loading="lazy"` to every `<img>` in a codebase is a recognisable
performance incident.

Rules:

- **Never lazy-load anything in the initial viewport.**
- Always set `width`/`height` (or `aspect-ratio`) — lazy images that arrive later shift the layout,
  turning an LCP problem into a CLS problem as well.
- `decoding="async"` is separate and usually harmless: it lets the browser decode off the main
  thread. For the LCP image specifically, `decoding="sync"` can occasionally paint sooner.

## Prefetch, and what makes it a no-op

`rel="prefetch"` downloads at the **lowest** priority into the HTTP cache for a future navigation.
It silently does nothing when:

- the response is `no-store` (nothing to keep) — this is the number one cause;
- the prefetch hadn't finished when the user clicked;
- the URL differs from the one the next page requests, even by a query parameter;
- the resource was evicted (Chrome keeps unused prefetches ~5 minutes).

And it always costs the user bytes. Prefetch when the next navigation is genuinely likely — the
product page from a listing, step 2 of a checkout, the next page of a paginated article.

## Speculation Rules

The modern, declarative version. Instead of hand-rolling hover heuristics:

```html
<script type="speculationrules">
{
  "prerender": [{ "where": { "href_matches": "/products/*" }, "eagerness": "moderate" }],
  "prefetch":  [{ "where": { "href_matches": "/*" }, "eagerness": "conservative" }]
}
</script>
```

| Eagerness | Fires |
|---|---|
| `immediate` | now |
| `eager` | on the slightest signal |
| `moderate` | ~200ms of hover — the sensible default |
| `conservative` | on pointerdown — still buys ~100ms |

**`prerender` runs the next page's JavaScript before the user has decided to go there.** That is
enormously powerful and requires discipline:

```js
if (document.prerendering) {
  document.addEventListener('prerenderingchange', sendPageView, { once: true });
} else {
  sendPageView();
}
```

Anything with a side effect — analytics, A/B bucketing, ad impressions, writes, `sessionStorage`
mutations — must wait for activation. And when reporting metrics, subtract
`performance.getEntriesByType('navigation')[0].activationStart`, or your LCP will look impossibly
good and your dashboard will be lying to you.

## Think about

- Why does `fetchpriority="high"` on the LCP image help even though the preload scanner already
  found it?
- You prefetch the next page for every link on a listing of 50 products. What have you done to a
  user on a metered connection?
- Your prerendered pages doubled your reported page views. What went wrong and how do you fix it
  properly?

<details>
<summary>Answers</summary>

**High priority on a scanned image.** The scanner *found* it, but images start at Low priority
until layout proves they're in the viewport. On a contended connection the request is queued
behind higher-priority work in the meantime. The hint removes that gap — typically 100–400ms of
LCP on mobile, for one attribute.

**Prefetching 50 links.** Up to 50 pages' worth of bytes on someone's data plan for one click.
Use `eagerness: moderate` (hover-triggered) so you speculate about *one* link at a time, and check
`navigator.connection.saveData` / `effectiveType`.

**Doubled page views.** Analytics fired during prerendering. Fix with the `document.prerendering`
guard above — and audit for the other side effects, because if page views fired, so did A/B
assignment and probably ad impressions. This is a correctness bug, not a metrics nit.
</details>

---

## 🏗️ Build challenge: an intent-driven speculation layer

Build `speculate.js`, then justify it against the platform.

```js
speculate({
  match: (a) => a.href.startsWith(location.origin + '/products/'),
  strategy: 'auto',          // 'prerender' | 'prefetch' | 'auto'
  maxConcurrent: 1,
  budgetKB: 2000,            // per session
});
```

Requirements:

1. Use **Speculation Rules** where supported; fall back to `rel=prefetch` on hover elsewhere.
2. Respect `navigator.connection.saveData`, `effectiveType` (`2g`/`slow-2g` → do nothing) and
   `deviceMemory` (< 4GB → prefetch, never prerender).
3. Cap concurrency and session bytes; log what you skipped and why.
4. Only speculate on `IntersectionObserver`-visible links, and only same-origin GET navigations
   with no query parameters that look like actions (`?logout`, `?delete=`).
5. Measure the hit rate: how many speculations were used vs wasted. **Report it.** A speculation
   layer with a 5% hit rate is a bandwidth tax on your users, and without measurement you'd never
   know.
6. Add the `document.prerendering` guard helper and a lint rule (or a runtime dev warning) that
   fires when analytics-shaped calls happen during prerendering.

**Stretch:** A/B it. Speculation on vs off, measuring next-navigation LCP, bytes per session, and
hit rate. Write up whether it was worth it — including the case where the answer is no.

**Done when:** you can state your hit rate and bytes-per-useful-navigation, and defend the
eagerness setting with those two numbers.

---

## Interview questions

1. What does `fetchpriority` actually change, and when does it do nothing?
2. Why do images start at Low priority, and what does that cost the LCP image?
3. Someone adds `loading="lazy"` to every image. What breaks?
4. Prefetch vs preload — one sentence each.
5. What must you change in a page before it's safe to prerender?
6. How would you decide whether your prefetching is helping or just costing users data?
