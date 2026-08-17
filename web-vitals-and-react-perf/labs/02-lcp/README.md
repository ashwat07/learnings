# Lab 02 — LCP ⭐⭐⭐⭐⭐

**Goal:** attribute LCP to one of four phases, then fix that phase.

**Primary metric:** LCP, and the element it names.

> <http://localhost:8080/web-vitals-and-react-perf/labs/02-lcp/>

---

## The four phases

| Phase | Typically | Fix |
|---|---|---|
| 1. TTFB | ~40% | server time, redirects, CDN, edge cache, streaming the shell |
| 2. **Resource load delay** | **the big one** | preload-scanner visibility, `preconnect`, nothing in the discovery chain, `fetchpriority` |
| 3. Resource load duration | small if you sized it right | format, `srcset`, compression |
| 4. Element render delay | the sneaky one | render-blocking CSS, blocking fonts, hydration |

**Phase 2 dominates most real sites.** The browser could have downloaded the image in 200ms — it
just didn't know the image existed until 2s in. This is why "the hero is 400KB" is usually the wrong
answer.

Get the breakdown for free:

```js
onLCP(m => console.log(m.attribution), {reportAllChanges: false})
// → element, url, timeToFirstByte, resourceLoadDelay, resourceLoadDuration, elementRenderDelay
```

Send *those* to RUM, not just the total.

## Run the scenarios

Same image, same delay, six discovery paths. Record LCP for each:

| scenario | LCP | why |
|---|---|---|
| baseline `<img>` in HTML | | the preload scanner finds it during parse |
| discovered via CSS `background-image` | | HTML → CSS → selector match → request. The scanner scans *HTML* |
| injected by JavaScript | | nothing exists until a script downloads, parses, runs |
| `loading="lazy"` on the hero | | defers the request until layout decides it's near the viewport |
| `preload` + `fetchpriority="high"` | | discovery at the earliest possible moment |
| text LCP | | no request at all |

Two of these are worth internalising:

**`loading="lazy"` above the fold** is a one-line "optimisation" that regularly costs a second.
Never lazy-load the LCP element.

**A CSS background image as the hero** is the single most common cause of a slow LCP on real sites,
because the discovery chain is invisible in every waterfall screenshot people paste into tickets.

**Preload doesn't make the download faster.** It makes the *discovery* earlier. If your image is
already discovered by the scanner, preloading it buys you priority, not time.

## The checklist

- [ ] The LCP image is a plain `<img>` in the initial HTML
- [ ] `fetchpriority="high"` on it — images default to Low priority until layout says otherwise
- [ ] Never `loading="lazy"` above the fold
- [ ] `preconnect` to the image host if it's third-party (DNS+TLS is 100–300ms before the request)
- [ ] No LCP image referenced only from CSS or JS
- [ ] `srcset`/`sizes` so mobile doesn't fetch the desktop asset
- [ ] `font-display: swap` (or `optional` + `size-adjust`) if the LCP is text
- [ ] Critical CSS inline, the rest deferred
- [ ] Measured at p75 on a mid-range Android

## Think about

- Your LCP element changes between page loads. Is that a problem?
- You preloaded the hero and LCP didn't improve. What happened?
- Would SSR fix a slow LCP?

<details>
<summary>Answers</summary>

**Changing LCP element.** Not a problem in itself — it's normal for a page with a hero image *and* a
large headline, and it tells you the two are close in size. It *is* a signal worth reading: if the
element differs by device (image on desktop, headline on mobile), your optimisation targets differ
too, and a single "fix the hero" ticket will only move half your traffic.

**Preload with no improvement.** Most likely one of: (a) the image was already discovered by the
preload scanner, so you bought priority you already had; (b) the bottleneck is phase 4 — the image
arrived but render-blocking CSS or a font delayed the paint; (c) you preloaded a *different* URL
than the one the responsive `srcset` selected, so you now download two images and made things worse.
Check the network panel for a duplicate request — that's the tell.

**Would SSR fix it?** Only if the bottleneck is phase 2 or 4 caused by client rendering — i.e. the
hero doesn't exist until JS runs. SSR moves the content into the HTML, so the scanner finds it. If
your bottleneck is TTFB, SSR usually makes it *worse* (now the server does data fetching before the
first byte), unless you stream. See [rendering-strategies lab 02](../../../rendering-strategies/labs/02-server-waterfalls/).
</details>

---

## 🏗️ Build challenge

1. Instrument your real site with `onLCP` attribution and log the **element selector + phase
   breakdown** for 100 loads on a throttled profile.
2. Group by element. If more than one element appears, split the analysis.
3. Fix the largest phase. Only then look at the image bytes.
4. Add a CI check: Lighthouse against your three most important routes, failing if LCP regresses by
   more than 10% against a stored baseline.

**Done when:** you can state your LCP element and dominant phase per route, from data.

---

## Interview questions

1. Name the four LCP phases and which usually dominates.
2. Why is a CSS `background-image` hero slow to discover?
3. What does `preload` actually change?
4. Why is `loading="lazy"` dangerous above the fold?
5. What's the fastest possible LCP element?
