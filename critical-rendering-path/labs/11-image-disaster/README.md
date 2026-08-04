# Lab 11 — Image disaster ⭐⭐⭐⭐

**Goal:** understand the four separate costs of an image (bytes, decode, layout, memory) and fix
each with the right tool.

**Primary metric:** LCP and CLS, plus total transferred bytes and main-thread decode time.

> **Needs a server and a generator step.** From this folder:
> ```sh
> node make-images.mjs            # writes 20 huge BMPs into images/ (~115MB)
> cd ../.. && ./serve.sh
> ```
> Then open <http://localhost:8080/labs/11-image-disaster/>.
> `images/` is generated — delete it when you're done (`node make-images.mjs --clean`).

---

## The concept

An image costs you in four independent places, and each has a different fix:

| Cost | What it is | Fixed by |
|---|---|---|
| **Bytes** | download time, especially on mobile networks | format (AVIF/WebP), compression, correct dimensions, `srcset` |
| **Decode** | turning compressed bytes into a bitmap — main-thread work unless you avoid it | `decoding="async"`, `createImageBitmap`, smaller images |
| **Layout** | an image with unknown size reserves no space, so content jumps when it loads | `width`/`height` attributes or `aspect-ratio` |
| **Memory** | the *decoded* bitmap: `width × height × 4` bytes, regardless of file size | serving appropriately-sized images |

That memory row is the one people miss. A 200KB JPEG at 4000×3000 decodes to **48MB** of bitmap.
Twenty of them is 960MB, and on a phone that's a tab crash — file size told you nothing about it.

And the LCP subtlety: the LCP element is usually an image. If it's lazy-loaded, you've delayed your
own headline metric. `loading="lazy"` on the hero image is one of the most common self-inflicted
performance wounds in the wild.

## Break it

`make-images.mjs` writes 20 uncompressed BMPs at 1600×1200 (~5.7MB each, ~115MB total). Then
`index.html` does everything wrong:

- all 20 loaded eagerly, above and below the fold
- no `width`/`height`, so every load shifts the layout
- no `srcset` — the same 1600px file for a 200px slot
- displayed at 200px wide, so you download 64× the pixels you show
- synchronous decode
- the hero image is `loading="lazy"` (the classic own-goal)

## Measure it

With **Network: Fast 3G** and **CPU 4×**, in an incognito tab, reload-and-record:

1. **Network panel**: total transferred, total resources, and the waterfall. Note how many
   connections are in flight and where the queue backs up.
2. **Performance panel → Timings**: FCP, LCP. Click the LCP marker — DevTools tells you which
   element it was. Is it the one you expected?
3. **Layout Shift** entries in the Experience track: click each to see which element moved. Record
   total CLS (the page prints it too).
4. **Main track**: find `Image Decode` / `Decode Image` entries. Total them. This is main-thread
   time you're spending on pictures.
5. **Memory**: take a heap snapshot, or use `chrome://memory-internals`; better, watch the Chrome
   Task Manager (⇧Esc) "Memory footprint" and "GPU memory" for the tab. Compare with the sum of
   file sizes and note that they're wildly different numbers.
6. **Lighthouse**: run it once. Read "Properly size images", "Efficiently encode", "Serve in
   modern formats", "Image elements do not have explicit width and height". You should be able to
   predict every item it flags before you run it.

| Metric | Broken | Fixed | Target |
|---|---|---|---|
| Transferred bytes | ~115MB | | < 500KB |
| Requests | 20 | | |
| LCP | | | < 2.5s |
| CLS | | | < 0.1 |
| Total decode time | | | |
| Tab memory footprint | | | |
| Images loaded on first paint | 20 | | 2–3 |

## Why is it slow?

Separate the four costs with evidence:

1. How much of the LCP is network and how much is decode? (Hint: compare on a fast connection with
   CPU 6× throttle versus a slow connection with no CPU throttle.)
2. What exactly causes each layout shift, and why does adding `width`/`height` fix it when CSS
   already sets the display size?
3. Why is tab memory much larger than the total file size?
4. The hero has `loading="lazy"`. What did that do to LCP, and why?

## Fix it yourself

Each of these is a separate, measurable step. Record numbers after each.

- [ ] **Reserve space.** Add `width` and `height` attributes (the intrinsic ones) and let CSS scale
      them. Measure CLS. Then try `aspect-ratio` in CSS instead and compare — when is each the right
      tool?
- [ ] **Un-lazy the hero.** Remove `loading="lazy"` from the LCP image and add
      `fetchpriority="high"`. Measure LCP. Then add `<link rel="preload" as="image">` for it and
      measure again. Did preload help once you'd already fixed the priority? (Often not — say why.)
- [ ] **Lazy-load the rest.** `loading="lazy"` + `decoding="async"` on below-the-fold images.
      Measure requests-on-first-paint and LCP.
- [ ] **Right-size.** Use `sips` (built into macOS) to generate 200px, 400px, and 800px variants,
      and wire up `srcset` + `sizes`. Measure transferred bytes at DPR 1 and DPR 2.
      ```sh
      # from this folder, after generating the BMPs
      mkdir -p images/opt
      for f in images/*.bmp; do
        b=$(basename "$f" .bmp)
        for w in 200 400 800; do
          sips -s format jpeg -s formatOptions 70 -Z $w "$f" --out "images/opt/${b}-${w}.jpg"
        done
      done
      ```
- [ ] **Modern formats.** Convert to WebP and AVIF and compare sizes and quality at matched visual
      fidelity. Use `<picture>` with fallbacks. (`sips -s format heic` works on macOS; for WebP/AVIF
      install `cwebp` / `avifenc` via Homebrew, or use `sharp` in a Node script.) Record the byte
      savings *and* the encode time — AVIF encoding is slow, which matters for user-uploaded content.
- [ ] **Kill the decode cost.** Measure decode time before and after `decoding="async"`. Then try
      `createImageBitmap()` in a worker for one image and explain when that's worth the complexity.
- [ ] **Placeholders.** Add a blurred low-quality placeholder (a 20px inline data-URI, or a CSS
      gradient). Measure whether it changed LCP (careful — it can *hurt* LCP if the browser picks the
      placeholder as the LCP element, and it can help perceived speed regardless. Discuss the
      difference between a metric and an experience).
- [ ] **Bound the memory.** With 200 images on the page, what keeps memory sane? Investigate
      `content-visibility`, and what the browser does with decoded bitmaps for off-screen images.
      Measure with the Chrome Task Manager.

<details>
<summary>Hint — width/height vs aspect-ratio</summary>

The `width`/`height` attributes give the browser the *intrinsic ratio* before the file arrives, so
it can reserve the right box even when CSS sets `width: 100%`. Modern browsers compute
`aspect-ratio: attr(width) / attr(height)` from them automatically. Use CSS `aspect-ratio` when the
displayed ratio differs from the intrinsic one (with `object-fit`), and the attributes always.
</details>

<details>
<summary>Hint — why the file-size/memory gap exists</summary>

Compression only affects the bytes on the wire. Once decoded, a bitmap is 4 bytes per pixel in
memory no matter the source format, and the browser may hold both a full-resolution decode and
scaled copies for compositing. Serving a 1600px image into a 200px slot means you allocated 64× the
bitmap memory you needed — that's why "properly size images" is a memory fix, not just a bandwidth
fix.
</details>

---

## 🏗️ Build challenge: an image pipeline + gallery that scores 100

Build a real gallery of 200 photos (any source: Unsplash, your own, or generated) with a build-time
pipeline and a runtime component.

**Build-time pipeline** (a Node script using `sharp`, or `sips` + `cwebp`/`avifenc`):
1. For each source image, emit AVIF, WebP, and JPEG at 320/640/960/1280/1920 widths.
2. Emit a 20px LQIP as a base64 data-URI, plus a dominant colour.
3. Emit a manifest JSON with dimensions, byte sizes per variant, LQIP, and colour.
4. Be incremental: don't re-encode unchanged sources. Report total bytes saved versus originals.

**Runtime gallery:**
1. `<picture>` with correct `srcset`/`sizes` — and get `sizes` *right* for a responsive grid, which
   is the part everyone fudges. Verify with DevTools that the browser picks the variant you intended
   at several viewport widths and DPRs.
2. LQIP → full image transition with no layout shift and no flash.
3. The first 2–3 images eager with `fetchpriority="high"`; everything else lazy.
4. A virtualized or `content-visibility` grid, so 200 images don't cost 200 decodes.
5. A lightbox that loads the full-resolution variant on demand, with a proper loading state.
6. Graceful degradation: no JS → still a working gallery of images.

**Budgets to hit, verified with Lighthouse on Fast 3G / 4× CPU:**
- LCP < 2.5s, CLS < 0.05, no layout shift from any image, ever
- < 400KB transferred on first load, regardless of gallery size
- Performance score ≥ 95
- Tab memory footprint < 300MB with all 200 images scrolled through

**Write-up:** a table of format vs size vs visual quality (include a perceptual judgement, not just
bytes), your `sizes` attribute with an explanation of every term in it, and the memory measurement
before and after right-sizing.

**Done when:** Lighthouse is ≥95 on throttled mobile, you can explain your `sizes` attribute
term-by-term, and scrolling the whole gallery doesn't grow memory without bound.

---

## Interview questions

1. Name the four costs of an image and the fix for each.
2. A 300KB JPEG. How much memory does it use once decoded, and what do you need to know to answer?
3. What does `loading="lazy"` do to LCP if applied to the hero image?
4. Explain `srcset` vs `sizes`. What breaks if `sizes` is wrong?
5. Why do `width` and `height` attributes fix CLS even when CSS controls the display size?
6. When is AVIF the wrong choice?
7. How would you serve the right image to a 3× DPR phone on a slow connection?
