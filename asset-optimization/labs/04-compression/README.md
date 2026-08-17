# Lab 04 — Compression ⭐⭐⭐⭐

**Goal:** compress everything that benefits, nothing that doesn't, at a level chosen for *when* you
compress.

**Primary metric:** bytes on the wire, and encode time.

> <http://localhost:8080/asset-optimization/labs/04-compression/>

---

## Measure it

| encoding | bytes sent | ratio | encode ms |
|---|---|---|---|
| identity | | 100% | 0 |
| gzip | | | |
| br | | | |

Then switch the payload to **already-compressed bytes** and look at the ratio: ~100%, or slightly
*worse*, and you paid CPU for it.

## The rule

| Compress | Don't compress |
|---|---|
| HTML, CSS, JS | JPEG / PNG / WebP / AVIF |
| JSON, XML, SVG | woff2 (**already brotli inside**) |
| source maps, plain text | MP4, audio |
| | zip / gz / tar.gz |
| | anything under ~1KB (framing overhead exceeds the saving) |

A misconfigured server that gzips JPEGs spends CPU on every request to *add* bytes. On a busy origin
that's measurable.

## Level depends on *when* you compress

Run the level sweep. Most of the win comes from the low levels; the top levels cost
disproportionate CPU for a few more percent.

| Situation | Setting |
|---|---|
| **Dynamic** responses (compressed per request) | gzip 6, or brotli 4–5 |
| **Static** files (compressed once at build) | **brotli 11**, always |

The CPU of a dynamic response is on your critical path: every millisecond of encoding is a
millisecond of TTFB, per request, per user. **Brotli 11 on a dynamic response is a classic
self-inflicted latency bug.**

For static files you pay once and ship the `.br` alongside the original — every user gets the
smallest possible bytes forever. Turn on `brotli_static`/`gzip_static` (nginx) or the equivalent on
your CDN.

The worst configuration is compressing static assets **at request time at level 11**: maximum CPU,
repeated for every request, for a file that never changes.

## Two things that bite

**1. `Vary: Accept-Encoding` is mandatory** on any compressed response. Without it a cache can serve
gzipped bytes to a client that didn't ask for them — garbage on screen. (See
[http-caching lab 05](../../../http-caching/labs/05-vary-and-cache-keys/).)

**2. Compression + secrets = BREACH/CRIME.** If a response contains both attacker-influenced input
*and* a secret (a CSRF token), compression ratios leak information about the secret. Mitigations:
don't reflect user input next to secrets, rotate tokens per request, or mask them. This is a real
attack — it's why TLS-level compression was removed from the web entirely.

## What compression doesn't fix

**Parse time.** A 2MB JSON payload that gzips to 60KB is still 2MB of parsing on the main thread
(see [web-workers lab 01](../../../web-workers/labs/01-main-thread-blocking/)). Compression saves
*network*, not *CPU*.

So "it's only 60KB over the wire" is not a defence of a 2MB payload. Ask what the client does with
it after it arrives.

## Think about

- Your JSON API is 2MB and gzips to 55KB. Is that fine?
- Why is brotli 11 wrong for a server-rendered HTML page?
- What does `Content-Encoding` have to do with `Content-Length` and progress bars?

<details>
<summary>Answers</summary>

**2MB → 55KB.** The network is fine; the client is not. That payload costs JSON parse time on the
main thread, memory to hold the objects, and probably a render over data nobody asked for. Compress
it *and* send less of it — pagination, field selection, or an aggregate computed on the server.

**Brotli 11 on dynamic HTML.** Encoding happens per request, on your server, before the first byte
goes out — so you've added tens to hundreds of milliseconds of TTFB to save a few KB. Worse with
streaming (lab 03 of rendering-strategies), where you want the first chunk out immediately. Use
brotli 4–5 for dynamic, 11 for static.

**Content-Length and progress.** With `Content-Encoding: gzip`, `Content-Length` is the
**compressed** size, while a `fetch` reader yields **decompressed** bytes — so a naive progress bar
runs past 100%. There's no way to observe the compressed stream from `fetch`. If you need accurate
progress, send an `X-Uncompressed-Length` header (and expose it via
`Access-Control-Expose-Headers` cross-origin — CORS course, lab 05).
</details>

---

## 🏗️ Build challenge: a compression audit

Build `compression-audit.mjs` that checks a real site:

1. For every resource on a page, request it with `Accept-Encoding: br, gzip` and with `identity`,
   and report: is it compressed, with what, and what's the ratio?
2. **Flag compressible-but-uncompressed** resources, ranked by bytes wasted. This is the finding.
3. **Flag incompressible-but-compressed** resources (images, woff2, video) — CPU burned for nothing.
4. **Flag missing `Vary: Accept-Encoding`** on compressed responses.
5. **Detect request-time vs build-time compression**: compare `Server-Timing`/TTFB for a compressed
   static asset against an uncompressed one of similar size, and estimate whether it's being
   compressed per request. Recommend precompression where it is.
6. Estimate the total saving: "compressing these 14 resources with brotli would save 380KB per
   cold visit".

**Done when:** you run it on a real site, find at least one uncompressed JSON or SVG response, and
one image being gzipped.

---

## Interview questions

1. What should and shouldn't be compressed, and why?
2. Which compression level would you use for a static JS bundle vs a server-rendered HTML page?
3. What must accompany a compressed response, and what breaks without it?
4. What is BREACH and what does it have to do with compression?
5. Your API gzips 2MB down to 55KB. What problem remains?
6. Why does a `fetch` progress bar overshoot on a gzipped response?
