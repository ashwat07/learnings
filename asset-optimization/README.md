# Asset, image & font optimization; CDN / edge ⭐⭐⭐⭐

Images and fonts are most of the bytes on most pages, and they map almost directly onto Core Web
Vitals: the LCP element is usually an image, layout shifts are usually images or fonts, and the
bytes competing with your critical path are usually assets nobody looked at.

This course is about hitting budgets, not vibes — so it generates **real** files and measures
**real** bytes.

```sh
cd asset-optimization
node make-images.mjs     # generates real PNG/BMP (+ JPEG/WebP/AVIF if your machine can)
node make-fonts.mjs      # downloads 3 open-licensed fonts (needs internet once)
cd .. && ./serve.sh      # then http://localhost:8080/asset-optimization/labs/01-images/
```

Both generators are gitignored and have a `--clean` flag. `make-images.mjs` encodes PNG itself
(zlib + four chunks) and shells out to `sips` / `cwebp` / `avifenc` for the rest — **whatever your
machine lacks is reported, not faked**, because the entire point is comparing real bytes.

---

## The budgets

Numbers to hold yourself to, on a mid-range phone over 4G:

| Metric | Good | Needs work | What usually causes it |
|---|---|---|---|
| **LCP** | < 2.5s | > 4s | The hero image: too big, discovered late, or low priority |
| **CLS** | < 0.1 | > 0.25 | Images with no dimensions; fonts swapping with different metrics |
| **INP** | < 200ms | > 500ms | JS, not assets — but assets compete for the same bandwidth |
| Total image bytes | < 1MB | > 2MB | No responsive sizes; wrong format |
| Total font bytes | < 100KB | > 300KB | Too many families/weights; no subsetting |
| Compression | brotli on all text | identity | Misconfigured server, or compressing what's already compressed |

## Curriculum

| # | Lab | Question it answers | ⭐ |
|---|---|---|---|
| 01 | [Images: formats & sizes](labs/01-images/) | Which format, which size, and who decides? | ⭐⭐⭐⭐⭐ |
| 02 | [Image loading](labs/02-image-loading/) | LCP, lazy loading, decode, and the CLS trap | ⭐⭐⭐⭐⭐ |
| 03 | [Fonts](labs/03-fonts/) | FOIT, FOUT, `font-display`, and the layout shift nobody attributes to fonts | ⭐⭐⭐⭐⭐ |
| 04 | [Compression](labs/04-compression/) | gzip vs brotli, what to compress, and what not to | ⭐⭐⭐⭐ |
| 05 | [CDN & edge](labs/05-cdn-and-edge/) | Cache keys, purges, and what the edge can't fix | ⭐⭐⭐⭐ |
| 06 | [Budgets in CI](labs/06-budgets/) | Making it stay fixed | ⭐⭐⭐⭐⭐ |

Related: [resource-hints](../resource-hints/) is about *when* assets are discovered;
[http-caching](../http-caching/) is about not fetching them twice. This course is about the bytes
themselves.

## The order that actually works

1. **Don't ship it** — is the asset needed at all?
2. **Ship fewer bytes** — right format, right dimensions, right compression.
3. **Ship it at the right time** — priority, lazy, preload (the resource-hints course).
4. **Don't ship it again** — caching (the http-caching course).
5. **Ship it from closer** — CDN/edge.

Teams usually start at 5 because it's a purchase order rather than a code change. It's the smallest
win of the five.
