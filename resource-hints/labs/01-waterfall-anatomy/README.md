# Lab 01 — Waterfall anatomy ⭐⭐⭐⭐⭐

**Goal:** read a waterfall the way a doctor reads an X-ray — find the chain, the contention, and
the blocking, in under a minute.

**Primary metric:** LCP, and the depth of the longest dependency chain.

> Open <http://localhost:8080/resource-hints/labs/01-waterfall-anatomy/> with Network throttling
> set to **Fast 4G** and hard-reload each page.

---

## The concept

A request starts when the browser **discovers** the URL. Bandwidth is rarely the problem; the
problem is that resource N+1 isn't known until resource N has arrived and been processed.

```
deep chain (01):
  HTML ─400─► CSS ─400─► background image                  = 800ms before the LCP image starts
  HTML ─300─► module ─300─► import ─300─► fetch            = 900ms before any data

flat (02):
  HTML ─┬─400─► CSS
        ├─400─► image      all discovered from the HTML,
        ├─300─► module     so all start together           = ~400ms total
        ├─300─► chunk
        └─300─► data
```

Same bytes. Same server delays. Roughly half the time, sometimes much better.

### The preload scanner

While the parser is blocked on a script, a second lightweight parser races ahead through the
remaining HTML looking for URLs, and starts downloading them. This is why a slow script in the
head is less catastrophic than it looks — and why **anything the scanner can't see** (URLs built
in JavaScript, CSS `url()`, dynamic imports) loses that head start entirely.

Page 04 shows both cases side by side: the `<img>` in the HTML starts early despite the blocking
script; the JS-injected `<img>` waits for the script to download and run.

## Measure it

For each page, record:

| Page | FCP | LCP | load | requests | longest chain (depth) |
|---|---|---|---|---|---|
| 01-deep-chain | | | | | |
| 02-flat | | | | | |
| 03-connection-limit | | | | | |
| 04-blocking | | | | | |

Then in the Network panel, for each page:

1. Sort by *Waterfall*. Is it a staircase (chain) or a block (parallel)?
2. Turn on the **Priority** column (right-click the header). Note that the browser has already
   made priority decisions you can override — that's Lab 04.
3. Hover a bar. The breakdown is *Queueing / Stalled / DNS / Initial connection / SSL / Request
   sent / Waiting (TTFB) / Content Download*. Long **queueing** means contention, not a slow
   server.

## The four shapes, and what each one means

| Shape in the waterfall | Diagnosis | Fix |
|---|---|---|
| Staircase — each bar starts where the last ended | Dependency chain | Hoist the URL into the HTML (`preload`, or just declare it) |
| Bars in groups of six with long grey heads | HTTP/1.1 connection limit | HTTP/2, or fewer requests; sharding only if stuck on H1 |
| Everything starts at 0 but finishes late | Genuine bandwidth limit | Send fewer bytes; prioritise |
| A gap where nothing is happening | Main thread busy, not the network | Performance panel, not Network |

## Page 03 — the connection limit

Twenty 400ms images take ~1.6s on one HTTP/1.1 origin: six at a time, four rounds. Split across
two origins and you get twelve in flight.

That's the origin of domain sharding (`img1/img2/img3.example.com`) — and of its death. Under
HTTP/2 a single connection multiplexes unlimited streams, so sharding now *costs* you: extra DNS,
extra TCP, extra TLS, and a loss of prioritisation (the browser can only prioritise sensibly
within one connection). If you see sharding in a modern codebase, it's a fossil.

Check which protocol you're on: the Network panel's **Protocol** column. This lab server is
HTTP/1.1 on purpose so you can see the limit; most production servers are `h2` or `h3`.

## Think about

- In 01, the LCP image is discovered by the CSS. Name three ways to make the browser learn about
  it sooner, and rank them.
- In 04, why does the preload scanner *not* help the JS-injected image?
- Your page makes 120 requests over HTTP/2 and loads fine; a colleague wants to bundle them into
  4. What do you measure to find out whether that would help?

<details>
<summary>Answers</summary>

**Three ways to hoist the LCP image:** (1) put it in the HTML as `<img>` — best, because the
preload scanner sees it and it participates in normal priority; (2) `<link rel="preload"
as="image">` in the head — good when it genuinely must stay a CSS background; (3) inline the
critical CSS so the `url()` is discovered without a round trip — helps the CSS chain generally,
not just this image. Rank: HTML `<img>` > inline critical CSS > preload. A `preload` that
duplicates a URL the scanner would have found anyway buys nothing.

**JS-injected image:** the scanner reads HTML text. The URL doesn't exist in the HTML — it's
computed at runtime — so nothing can find it before the script has downloaded, parsed and
executed. This is the single biggest hidden cost of "we render everything client-side".

**120 requests on H2:** measure whether the requests are *concurrent* (they should be — no
connection limit) and whether the critical path depth changed. Bundling helps compression ratios
and reduces per-request overhead, but hurts caching granularity (Lab 04 of the caching course).
Look at the waterfall shape: if it's a block, bundling saves little; if it's a staircase, bundling
may collapse the chain, which is the real win.
</details>

---

## 🏗️ Build challenge: a critical-path analyser

Build `critical-path.mjs`: given a HAR file, output the **dependency chain**, not a list.

```
critical path (4 hops, 1,840ms):
  1. document           /                          0 → 320ms
  2. stylesheet         /assets/main.css         330 → 710ms   (initiator: parser)
  3. image              /img/hero.jpg            740 → 1,520ms (initiator: CSS url())
  4. LCP                                                1,540ms

  ⚠ hop 3 is discovered by CSS. Preloading it would save ~380ms.
  ⚠ 6 requests queued behind the connection limit (HTTP/1.1) — 420ms of queueing.
```

Requirements:

1. Build the initiator graph from the HAR (`_initiator` in Chrome's export) and find the longest
   path by end time, not by request count.
2. Attribute each hop's discovery route: parser, preload scanner, CSS, script, hint.
3. Detect connection-limit queueing: group by origin and protocol, and report total queueing time
   that would disappear on HTTP/2.
4. Estimate the saving from preloading each hop — and be honest that it's an upper bound, since
   preloading contends for the same bandwidth.
5. Flag hints that were *wasted*: preloaded resources never used, prefetches never navigated to,
   preconnects to origins never contacted.

**Stretch:** take two HARs (before/after) and diff the critical path, so a PR can show "chain
depth 5 → 3, LCP −620ms".

**Done when:** it finds the same critical path you'd find by hand on all four lab pages, plus one
real site.

---

## Interview questions

1. What's the difference between a page making 100 requests and a page with a 5-deep request
   chain? Which is worse?
2. What is the preload scanner and what can it not see?
3. A stylesheet blocks rendering. Does it block *discovery* of the image below it in the HTML?
4. You see six requests starting together and the rest waiting. What's happening and what are the
   two fixes?
5. Why was domain sharding a good idea in 2012 and a bad one now?
6. Where in a waterfall would you look to tell "slow server" apart from "queued behind other
   requests"?
