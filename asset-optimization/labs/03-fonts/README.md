# Lab 03 — Fonts ⭐⭐⭐⭐⭐

**Goal:** text readable from the first paint, no invisible period, and no layout shift when the real
font arrives.

**Primary metric:** CLS caused by the font swap, and when text becomes readable.

> `node make-fonts.mjs` in `asset-optimization/` (needs internet once), then
> <http://localhost:8080/asset-optimization/labs/03-fonts/>

---

## Why fonts are hard

A font is discovered **three hops in**:

```
HTML → CSS downloads → CSS parses → layout matches a rule to text → fetch the font
```

And until it arrives the browser must choose between two bad options: **hide the text** (FOIT) or
**show it in the wrong font and swap later** (FOUT, which moves the layout).

## `font-display`, precisely

| Value | Block period | Swap period | Result |
|---|---|---|---|
| `block` | ~3s | infinite | **FOIT** — invisible text for up to 3s |
| `swap` | 0 | infinite | Readable immediately; swaps whenever it arrives (**late shift**) |
| `fallback` | ~100ms | ~3s | Brief FOIT, then fallback; swaps only if it's quick |
| `optional` | ~100ms | **none** | Browser may skip the font entirely this load. **Zero shift** |
| `auto` (default) | up to the browser | | usually behaves like `block` |

Run all four with a 2500ms delay and compare the CLS column.

| case | FCP | font usable | CLS | shifts |
|---|---|---|---|---|
| block | | | | |
| swap | | | | |
| fallback | | | | |
| optional | | | | |
| swap + preload | | | | |
| swap + metric overrides | | | | |

**`optional` is the right choice more often than people think.** If your brand font is
nice-to-have rather than load-bearing, it gives you zero CLS *and* zero FOIT — and the font is still
cached for the next visit, where it renders immediately with no shift.

**`block` is right for icon fonts only** (a fallback would render random letters where icons should
be) — and the better answer there is SVG.

## The layout shift nobody attributes to fonts

Run `swap` with the 2500ms delay and watch the CLS number. Playfair and Georgia have different
metrics, so when the swap happens every line re-flows and everything below moves.

This shift is routinely blamed on images or ads because it happens late and affects a whole page.
The fix is **metric overrides**:

```css
@font-face {
  font-family: Brand;
  src: url(brand.woff2) format('woff2');
  font-display: swap;
  size-adjust: 108%;         /* scale the fallback so average widths match */
  ascent-override: 92%;
  descent-override: 22%;
  line-gap-override: 0%;
}
```

Now the swap changes the **glyphs** and not the **geometry**. That's what "zero-layout-shift font
loading" means, and it's what `next/font` and Fontaine do for you automatically. Doing it by hand
means comparing the two fonts' ascent/descent/lineGap and average character width — there are
calculators, or read the font tables with a script.

## Preloading a font — two rules

```html
<link rel="preload" as="font" type="font/woff2" href="/fonts/brand.woff2" crossorigin>
```

1. **`crossorigin` is mandatory, even same-origin.** Fonts are fetched in CORS mode; a non-CORS
   preload can't be reused, so you download the font **twice** and it arrives *later* than if you
   hadn't preloaded it.
2. **It must be in the HTML as sent by the server.** This lab injects it with script to show the
   mechanism, which is nearly useless in practice — by then the CSS has usually already found it.

Preload only what's used **above the fold**, at the weights you actually render. Preloading six
weights makes everything else on the critical path slower.

## Shipping fewer font bytes

| Technique | Saving |
|---|---|
| **Subset** to the characters you use (`unicode-range`, or a build-time subset) | Often 70–90% |
| **woff2 only** | ~30% vs woff; every browser you support has it |
| **Fewer weights/styles** | Each is a separate file; 400 + 700 covers most designs |
| **Variable fonts** | One file for all weights — a win *if* you use 3+ weights, a loss if you use 2 |
| **`font-synthesis`** | Let the browser fake italic/bold instead of shipping a face — for minor text |
| **System font stack** | Zero bytes. Genuinely fine for a lot of UI |

## Self-hosting vs a font CDN

Self-host. The old argument for Google Fonts ("users already have it cached") **died with cache
partitioning** — since 2020 Chrome and Safari partition the HTTP cache by top-level site, so a font
fetched on another site is not reused on yours (see [http-caching lab 05](../../../http-caching/labs/05-vary-and-cache-keys/)).

What's left of the CDN option is: an extra DNS lookup, an extra TCP+TLS handshake, an extra origin
to `preconnect` to, a third party in your critical path, and a privacy/GDPR question. Self-hosted
fonts are same-origin, preloadable, and cacheable for a year with a hashed filename.

## Think about

- Your font is 2s slow. Which `font-display` gives the best experience for body copy? For a logo?
- Why does `crossorigin` on a font preload matter even same-origin?
- CLS is 0.18 and all your images have dimensions. Where else would you look?

<details>
<summary>Answers</summary>

**Body copy vs logo.** Body copy: `swap` with metric overrides (readable immediately, no shift), or
`optional` if you can accept the fallback on slow connections. A logo: it shouldn't be a web font at
all — make it SVG, and get it in the first paint with no font dependency.

**`crossorigin` same-origin.** Fonts are always fetched in CORS mode. The cache distinguishes CORS
from non-CORS fetches, so a non-CORS preload can't satisfy the CORS font request — you get two
downloads and a *later* font. The console warning ("preloaded but not used") is your only clue.

**CLS 0.18 with sized images.** Fonts are the next suspect: a late swap re-flows every line of text.
Then: injected banners/ads with no reserved space, `@font-face` on a lazily-loaded component,
dynamically added content above the fold, and iframes without dimensions. Use the Layout Instability
API's `sources` to get the actual shifted nodes — it names them.
</details>

---

## 🏗️ Build challenge: a font pipeline

Build the pipeline you'd put in a real project:

1. **Subset** a font to the characters your site actually uses. Scrape the rendered text of your
   routes, build the character set, and subset with `pyftsubset`/`fonttools` (or `glyphhanger`).
   Report before/after bytes. This is usually the single biggest font win and it's a build step
   nobody has.
2. **Split by `unicode-range`** so Latin users don't download Cyrillic or Greek. Verify the browser
   only fetches the ranges it needs — check the Network panel on a Latin-only page.
3. **Generate metric overrides automatically**: read `ascent`, `descent`, `lineGap` and `unitsPerEm`
   from both the web font and the intended fallback, compute the overrides, and emit the
   `@font-face`. This is what `next/font` does; doing it yourself makes it obvious.
4. **Fingerprint + a year of caching**, and preload only the above-the-fold faces.
5. **A CLS regression test**: load each route with the font delayed by 3s and assert CLS < 0.02.
   That test fails the moment someone adds a font without overrides.
6. Report a **font budget** per route: files, bytes, weights, and which were actually rendered
   (`document.fonts` tells you `status: 'loaded'` per face — faces that never load are pure waste,
   and there are always some).

**Done when:** subsetting cuts your font bytes by more than half, the CLS test fails on a font added
without overrides, and your report names a weight nobody renders.

---

## Interview questions

1. Walk through the chain from HTML to a font being rendered. How many hops?
2. FOIT vs FOUT — what causes each, and which `font-display` value produces which?
3. What does `size-adjust` do and what problem does it solve?
4. Why does a font preload need `crossorigin`?
5. Is Google Fonts faster than self-hosting? Defend your answer.
6. Your CLS is 0.18 and every image has width and height. What next?
