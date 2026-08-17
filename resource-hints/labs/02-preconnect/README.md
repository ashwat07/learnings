# Lab 02 — preconnect & DNS ⭐⭐⭐⭐

**Goal:** know what a connection costs, when `preconnect` is worth a line of HTML, and when it's
worse than nothing.

**Primary metric:** DNS + TCP + TLS time on the critical path.

> Open <http://localhost:8080/resource-hints/labs/02-preconnect/> — **throttle to Slow 4G first.**

---

## The concept

Before any resource from a new origin can transfer:

```
DNS lookup        ~1 RTT (often cached, sometimes 100ms+ on mobile)
TCP handshake      1 RTT
TLS handshake      1–2 RTT (TLS 1.3 = 1, and 0 on resumption)
────────────────────────────
                  2–4 RTT before the request is even sent
```

At a 150ms RTT that's 300–600ms per origin, paid before the first byte. `preconnect` moves it
earlier — in parallel with work you were doing anyway — instead of removing it.

```html
<link rel="preconnect" href="https://cdn.example.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>   <!-- fonts need this -->
<link rel="dns-prefetch" href="https://maybe.example.com">             <!-- cheap insurance -->
```

`dns-prefetch` does only the DNS lookup. It's much cheaper (no socket) and much less valuable.
Use it for origins you *might* use; use `preconnect` for origins you *will* use, soon.

### The `crossorigin` trap

**A preconnect for a font must have `crossorigin`.** Fonts are always fetched in CORS mode, and a
CORS connection is a different connection from a non-CORS one in the browser's pool. Omit the
attribute and you open a socket that the font fetch can't use — you've paid for a handshake twice.

Same for `<link rel="preload" as="font">`: `crossorigin` is mandatory, even for same-origin fonts.
Without it, the font downloads **twice**, and the preload warning in the console is your only clue.

## Measure it

**With throttling on**, run the buttons:

| Measurement | DNS | TCP | TLS | TTFB | Total |
|---|---|---|---|---|---|
| cold connection to :8081 | | | | | |
| warm (socket reused) | | | | | |

Then hard-reload both pages and compare when the `:8081` script *starts transferring*:

| Page | :8081 request starts at | DNS+connect visible? | load |
|---|---|---|---|
| 01-no-hint | | | |
| 02-preconnect | | | |

**If you see zeroes everywhere**, you're not throttling. Localhost has no DNS, no TLS and a
sub-millisecond TCP handshake. That's the meta-lesson: *your machine is the worst possible place
to evaluate a network optimisation.*

## When preconnect is right, and when it isn't

| Situation | Verdict |
|---|---|
| A font origin you always use (`fonts.gstatic.com`) | ✅ with `crossorigin` |
| Your image CDN, used above the fold | ✅ |
| An analytics origin loaded 5s later | ❌ — the socket is closed by then (~10s idle timeout) |
| Six third-party origins "to be safe" | ❌ — six handshakes competing with your critical path |
| An origin you already connected to (same-origin) | ❌ — no-op |
| A maybe-used origin (a chat widget the user might open) | `dns-prefetch` |

The rule: **preconnect to 1–3 origins that you are certain will be used in the first seconds.**
Beyond that you're spending bandwidth and sockets on speculation.

## The better fix: have fewer origins

Every origin is a handshake. Before reaching for `preconnect`, ask whether the origin needs to
exist:

- **Self-host your fonts.** Removes an origin *and* the CSS→font chain *and* the privacy problem.
  Almost always a net win over a font CDN now that cross-site caching is partitioned (see the
  caching course, Lab 05 — the "everyone already has this cached" argument is dead).
- **Proxy your API** through your own origin: no handshake, no CORS, no preflight.
- **Serve assets from the document origin** instead of a separate CDN hostname where you can.

`preconnect` is the fix when you can't remove the origin. It is not a substitute for removing it.

## Think about

- Why does a preconnect become useless if placed after a slow stylesheet in the head?
- Why is `preconnect` to a font origin without `crossorigin` actively harmful?
- Your page loads a chat widget on click, from a 4th-party origin. `preconnect`, `dns-prefetch`, or
  nothing?

<details>
<summary>Answers</summary>

**Placement.** Hints are processed in document order as the head is parsed. A preconnect after a
render-blocking stylesheet still fires when the parser reaches it — but the whole point was to
overlap the handshake with that download. Put preconnects first in the head, above everything.

**Fonts without `crossorigin`.** The connection pool is keyed partly on the CORS/credentials mode.
A non-CORS socket can't serve a CORS font request, so the browser opens a *second* connection —
you've paid the handshake twice and delayed the font.

**Chat widget on click.** `dns-prefetch` at most. A preconnect held for a click that may never
come is a wasted socket that also expires after ~10 seconds. Better: preconnect on `pointerover`
or `mousedown` of the button — that's ~100–200ms of head start, which is often enough to hide the
handshake completely, and costs nothing when the user doesn't interact.
</details>

---

## 🏗️ Build challenge: an origin audit + intent-based preconnect

**Part A — audit.** `origins.mjs` takes a HAR and reports every origin the page touches:

```
origins: 11   (handshakes: 9 · 2.4s of cumulative connection setup)
  self          example.com          42 requests   ✓
  fonts.gstatic.com                   2 requests   ⚠ 380ms handshake, first use at 1.2s → preconnect
  cdn.segment.com                     1 request    ⚠ 410ms handshake for 14KB — is it worth an origin?
  ads.doubleclick.net                 6 requests   ✗ 520ms handshake, all after load
```

Report cumulative handshake cost, first-use time per origin, and bytes-per-origin (an origin that
delivers 14KB rarely justifies its own handshake). Recommend `preconnect` / `dns-prefetch` /
"remove this origin" for each, with the number that justifies it.

**Part B — speculative preconnect on intent.** Ship a tiny script that opens a connection when the
user shows intent, not on page load:

```js
intentPreconnect({
  'https://checkout.example.com': '[data-checkout]',   // hover/touchstart on these elements
  'https://chat.example.com': '#help-button',
});
```

Requirements: fire on `pointerover`/`touchstart`/`focus`, at most once per origin, never more than
2 concurrent speculative connections, and skip entirely on `navigator.connection.saveData` or
`effectiveType` of `2g`. Measure the win with the Slow 4G profile: time from click to first byte,
with and without.

**Done when:** Part A finds a removable origin on a real site, and Part B shows a measurable
reduction in click-to-first-byte on a throttled profile.

---

## Interview questions

1. What exactly does `preconnect` do, and what does it not do?
2. Why does a font preconnect need `crossorigin`?
3. When is `dns-prefetch` the better choice?
4. Your page preconnects to eight origins. Critique that.
5. How long does a browser hold an unused preconnected socket open, and why does that matter?
6. Preconnect or self-host? Argue both sides for a Google Fonts dependency.
