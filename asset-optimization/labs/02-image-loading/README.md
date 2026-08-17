# Lab 02 — Image loading ⭐⭐⭐⭐⭐

**Goal:** get the LCP image fetched first, everything else fetched late or never, and nothing moving
when it arrives.

**Primary metric:** LCP and CLS, per case.

> <http://localhost:8080/asset-optimization/labs/02-image-loading/> at **Fast 4G**.
> Each button is a real navigation, because LCP and CLS only mean anything for a page load.

---

## Three questions, three attributes

| Question | Attribute | Wrong answer costs |
|---|---|---|
| Does the LCP image go first? | `fetchpriority="high"` | hundreds of ms of LCP |
| Are off-screen images fetched at all? | `loading="lazy"` | megabytes nobody sees |
| Does the page move when images land? | `width`/`height` | CLS |

## Measure it

| case | LCP | CLS | Notes |
|---|---|---|---|
| 1. baseline (hero last) | | | |
| 2. fetchpriority | | | |
| 3. lazy hero | | | |
| 4. eager hero + lazy thumbs | | | |
| 5. no dimensions | | | |
| 6. dimensions | | | |

## What each case teaches

**1 → 2. Priority is a ranking.** In the baseline nothing is too big or too slow — the *order* is
wrong, and order is free to change. Images start at **Low** priority until layout proves they're in
the viewport, so twelve thumbnails declared earlier in the markup get the connections first.

`fetchpriority="high"` on the LCP image is the highest value-per-character change in this course.
And `fetchpriority="low"` on the competition matters just as much: raising one thing while lowering
nothing changes less than you'd expect.

**3. `loading="lazy"` on the LCP element is a regression**, because the browser must run layout
before it will start the request. This is a real pattern: someone adds `lazy` to every `<img>` with
a codemod "for performance" and LCP gets worse on every page.

> **Never lazy-load anything in the initial viewport.**

**4. The right combination.** Hero eager + high priority; everything below the fold lazy. Scroll and
watch the thumbnails appear in the Network panel — **bytes you never spend are the best kind of
optimisation**. On a listing with 60 thumbnails this is a 3MB page vs a 400KB one.

`decoding="async"` on the hero lets the browser decode off the main thread — a real TBT saving for
a large image, invisible unless you profile.

**5 → 6. CLS.** With no `width`/`height` the browser reserves zero space and reflows when each image
arrives — at 400–2000ms, which is exactly when someone might be reaching for a link.

```html
<img width="800" height="450" style="max-width:100%; height:auto" …>
```

The attributes are **not the display size** — they're the intrinsic size, and modern browsers use
them purely to derive an **aspect ratio**, from which they compute the height for whatever width the
CSS gives. That's why the `height:auto` in the CSS is required: without it you've hard-coded the
height.

Leaving them off is the single most common cause of CLS on the web.

## The LCP checklist

For the one image that is your LCP element:

- [ ] In the HTML as an `<img>` (not a CSS background, not injected by JS) so the preload scanner
      finds it
- [ ] `fetchpriority="high"`
- [ ] **Not** `loading="lazy"`
- [ ] `width`/`height` set
- [ ] Correctly sized for its slot (Lab 01)
- [ ] Modern format with a fallback
- [ ] Served from the same origin, or with `preconnect` to its origin
- [ ] Not behind a CSS or JS chain (resource-hints Lab 01)

That list is worth applying by hand to your top three landing pages. It takes ten minutes and it's
usually worth more than a week of bundle work.

## Think about

- Your LCP element is a CSS `background-image`. What changes?
- Why does `loading="lazy"` delay the request rather than just deprioritising it?
- Lighthouse says LCP is 3.2s and the image is only 40KB. Where's the time?

<details>
<summary>Answers</summary>

**CSS background.** The preload scanner can't see it — the URL only exists after the CSS downloads
*and* parses *and* the rule matches. That's a two-hop chain before the request even starts. Fix:
make it an `<img>` (with `object-fit: cover` if you needed the background behaviour), or
`<link rel="preload" as="image">` with a byte-identical URL (resource-hints Lab 03).

**Lazy delays rather than deprioritises.** `loading="lazy"` is a *correctness* rule, not a priority
hint: the browser must not fetch until it knows the image is near the viewport, and it can only know
that after layout. Layout requires CSS. So `lazy` inserts a dependency on the CSS chain that
`fetchpriority="low"` does not.

**3.2s LCP for a 40KB image.** The bytes aren't the problem — discovery or contention is. Check: when
did the request *start* (not how long it took)? Is it behind a CSS/JS chain? Is it queued behind
other requests? Is the server slow to respond (TTFB)? Is a render-blocking stylesheet delaying paint
even after the image arrived? The Network waterfall answers all five in one look.
</details>

---

## 🏗️ Build challenge: an LCP guard

The LCP element changes when someone edits a template, and nobody notices until the field data
moves. Automate the check.

Build `lcp-guard.mjs` with Playwright:

1. Load each key route at Fast 4G / 4× CPU and capture the LCP element (via the
   `largest-contentful-paint` entry's `element` and `url`).
2. Assert the checklist on it: is it an `<img>` in the initial HTML? does it have
   `fetchpriority="high"`? is it *not* lazy? does it have dimensions? is its intrinsic size within
   1.5× of its displayed size?
3. **Fail if the LCP element changed** since the baseline — that's the early warning. A template
   edit that makes a different element the LCP is invisible until it hits field data.
4. Report the LCP element's discovery chain: what had to load before its request started
   (resource-hints Lab 01's critical path).
5. Track CLS per route with attribution: which element shifted, and what caused it (Layout
   Instability's `sources` gives you the node).
6. Emit a filmstrip artifact for failures so a reviewer sees the difference rather than reading
   about it.

**Done when:** it fails on case 3 of this lab, passes on case 4, and catches a deliberately removed
`width` attribute via the CLS assertion.

---

## Interview questions

1. Why does an image start at Low priority, and what does that cost the LCP element?
2. When is `loading="lazy"` harmful?
3. What do `width` and `height` actually do on a modern `<img>`?
4. Your LCP image is a CSS background. What's the problem and what are the two fixes?
5. What does `decoding="async"` change, and where would you see it?
6. LCP is 3.2s for a 40KB image. Walk me through diagnosing it.
