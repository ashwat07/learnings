# Lab 03 — preload ⭐⭐⭐⭐⭐

**Goal:** use `preload` where it removes a round trip from the critical path, and recognise the
five ways it silently costs you instead.

**Primary metric:** LCP, plus the number of resources downloaded **twice**.

> Open <http://localhost:8080/resource-hints/labs/03-preload/> — throttle to **Fast 4G**, keep the
> console open.

---

## The concept

`preload` declares "this page needs this resource, at this priority, now". It changes **when the
request starts**, nothing else. That's enough to be transformative when the resource was
previously discovered two hops in — and useless when it wasn't.

Good candidates, in order of typical payoff:

1. **The LCP image**, when it's a CSS background, a JS-rendered `<img>`, or inside a carousel.
   (If it's a plain `<img>` in the HTML, the preload scanner already found it — preload adds
   nothing. Use `fetchpriority="high"` instead; see Lab 04.)
2. **Fonts** used above the fold — otherwise they're discovered after CSS parses *and* layout
   decides they're needed, which is 3 hops.
3. **Critical data** your app fetches immediately after boot.
4. **A late-discovered module** (`modulepreload`, which also preloads the dependency graph).

## Measure it

| Page | FCP | LCP | load | duplicate downloads |
|---|---|---|---|---|
| 01-late-discovery | | | | 0 |
| 02-preloaded | | | | |
| 03-traps | | | | |
| 04-too-many | | | | |

Page 02 should cut LCP by roughly one server delay versus page 01. If it doesn't, check that the
preload URL matches the CSS's `url()` **byte for byte** — that's trap 1.

## The five traps (page 03)

| # | Trap | Symptom | Fix |
|---|---|---|---|
| 1 | Preload URL ≠ used URL (one query param, a different case, a trailing slash) | resource downloaded **twice** | make them identical; generate both from one constant |
| 2 | `as="font"` or `as="fetch"` without `crossorigin` | downloaded twice + console warning | add `crossorigin`, even same-origin |
| 3 | Preloaded, never used | "preloaded but not used within a few seconds" | delete it, or use it |
| 4 | Missing `as` | wrong priority, wrong `Accept`, usually no reuse | always set `as` |
| 5 | Preloading something big and non-critical at high priority | LCP gets *worse* | preload only what's on the critical path |

Traps 1 and 2 are the expensive ones because they're invisible: the page works, it's just
downloading the file twice. **Check the Network panel for duplicate rows after adding any
preload.** That's the whole QA step and almost nobody does it.

### Why fonts need `crossorigin`

Fonts are always fetched in **CORS mode**, even from your own origin. The browser's cache
distinguishes CORS from non-CORS fetches, so a non-CORS preload can't satisfy a CORS font request.
Result: two downloads of a 90KB font, and the font arrives *later* than if you hadn't preloaded it
at all.

```html
<link rel="preload" as="font" type="font/woff2" href="/inter.woff2" crossorigin>
```

Same for `as="fetch"`: `fetch()` is CORS-mode.

## Page 04 — why "preload everything" fails

Priority is a **ranking**, not a throttle. Twenty-five `fetchpriority="high"` preloads mean the
LCP image is now competing with 25 equals for the same connection and the same bandwidth. On a
constrained link, the total transfer time is the same either way — you've just chosen a worse
order.

The discipline: **a page should have single-digit preloads.** If you have twenty, you haven't
prioritised; you've made a list.

## Preload vs the alternatives

| Situation | Reach for |
|---|---|
| LCP image is a plain `<img>` in the HTML | `fetchpriority="high"` — the scanner already found it |
| LCP image is a CSS background | `preload as="image"` (or restructure it into an `<img>`) |
| Font used above the fold | `preload as="font" crossorigin` + `font-display: swap` |
| Data fetched on boot | `preload as="fetch" crossorigin`, or inline it into the HTML |
| Below-the-fold images | `loading="lazy"`, never preload |
| Next page's bundle | `prefetch` (Lab 04), never preload |
| The whole CSS file | it's already render-blocking; preload adds nothing |

Note the last row: preloading a resource the browser was already going to fetch at high priority
(render-blocking CSS, a sync script in the head) does nothing at all. Roughly half the preloads in
the wild are this.

## Think about

- You add `<link rel="preload" as="image">` for your hero and LCP gets slightly *worse*. Name two
  plausible causes.
- Your `<img srcset>` hero picks a different file per viewport. How do you preload it without
  downloading two images?
- When would you inline a resource into the HTML instead of preloading it?

<details>
<summary>Answers</summary>

**LCP worse after preloading.** (a) The preload is competing with the render-blocking CSS, and
until the CSS lands nothing paints anyway — so you've slowed the CSS to speed up an image that
can't be shown yet. (b) URL mismatch: you're now downloading it twice, doubling the bytes on a
constrained link.

**Responsive hero.** Use `imagesrcset` and `imagesizes` on the preload link, mirroring the `<img>`
exactly. If they don't match, the browser picks a different candidate for the preload than for the
`<img>` and you download both.

**Inline instead of preload.** When the resource is small and always needed: critical CSS, a tiny
LCP image as a data URI, or the first API response embedded as JSON in the HTML. Inlining removes
the round trip entirely rather than starting it earlier — strictly better, at the cost of
cacheability. The break-even is roughly "smaller than ~2–4KB, and it changes as often as the HTML".
</details>

---

## 🏗️ Build challenge: a preload linter

Every problem in this lab is statically detectable. Build `preload-lint.mjs`:

Given a URL (or HTML + a HAR):

1. **Duplicate downloads**: match each `<link rel=preload>` against actual requests in the HAR;
   report any resource fetched twice, showing both URLs so the mismatch is obvious.
2. **Missing `crossorigin`** on `as="font"` / `as="fetch"`.
3. **Missing or wrong `as`** — including `as="script"` on a module (should be `modulepreload`).
4. **Unused preloads** — preloaded but never requested by anything else.
5. **Redundant preloads** — the resource is also a render-blocking `<link rel=stylesheet>` or a
   sync `<script>` in the head, so the preload adds nothing.
6. **Priority inversion** — count high-priority preloads that start before the LCP resource and
   report the estimated delay to LCP (bytes ahead of it ÷ observed throughput).
7. **Responsive mismatch** — a preload with `imagesrcset` that doesn't match the `<img>`'s
   `srcset`/`sizes`.

Output should be prioritised by estimated milliseconds of LCP impact, not by rule severity.

**Stretch:** a `--fix` mode that emits the corrected `<link>` tags, and a check that runs in CI
against a built HTML file so a bad preload can't merge.

**Done when:** it finds all five traps on page 03, no false positives on page 02, and at least one
real finding on a production site.

---

## Interview questions

1. What does `preload` actually change about a request?
2. Why does `as` matter — give three separate effects.
3. Why do fonts need `crossorigin` on a preload even when they're same-origin?
4. Your LCP image is a plain `<img>` in the HTML. Is preloading it useful?
5. A page has 20 preloads. What's your first question, and what would you measure?
6. When is inlining better than preloading, and what's the trade?
