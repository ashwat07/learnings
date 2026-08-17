# Lab 03 — Streaming ⭐⭐⭐⭐⭐

**Goal:** ship the shell before the data, understand the mechanism well enough to debug it, and
know what streaming costs you operationally.

**Primary metric:** TTFB and time-to-first-markup vs total response time.

> Open <http://localhost:8080/rendering-strategies/labs/03-streaming/>

---

## The mechanism

Streaming SSR is chunked `Transfer-Encoding` plus one trick. The server writes:

```html
<!-- chunk 1, immediately -->
<!doctype html><html><head>…css, js…</head><body>
  <div id="slot-reviews"><div class="skeleton">…</div></div>

<!-- chunk N, when the query resolves — possibly out of document order -->
<template data-slot="reviews">…the real reviews…</template>
<script>__swap("reviews")</script>
```

`__swap` replaces the placeholder with the template's content. That's it — 8 lines in
[`shared/app/render.mjs`](../../../shared/app/render.mjs). React 18's implementation is the same
idea with better bookkeeping (`$RC`, hidden divs, and reconnecting the React tree).

**Three separate wins, and people usually only name the first:**

1. **TTFB** — the shell doesn't wait for data.
2. **Resource discovery** — `<head>` arrives in the first chunk, so the browser starts fetching
   CSS, JS and fonts *while the server is still waiting on the database*. In blocking SSR those
   requests can't begin at all until the whole page is ready. This is often the bigger win.
3. **Perception** — the user reads the product while the reviews are still loading.

## Measure it

| mode | TTFB | first markup | complete | chunks |
|---|---|---|---|---|
| ssr-par | | | | 1 |
| stream | | | | |

Then open both pages with a 2.5s reviews query and watch which one shows you a product.

Read the chunk list in the lab — that's the page being built in front of the user, in **completion
order, not document order**. `product` (200ms) arrives before `recommends` (600ms) before
`reviews` (900ms), regardless of where they sit in the markup.

## What breaks streaming in production

This is the part that costs people a day:

| Cause | Symptom | Fix |
|---|---|---|
| **A buffering proxy** — Nginx `proxy_buffering on` (the default) | TTFB unchanged in prod, fine locally | `proxy_buffering off`, or `X-Accel-Buffering: no` (this sandbox sends it) |
| **Compression buffering** — gzip waiting for a full window | chunks arrive in clumps | flush per chunk; most servers do this correctly, some don't |
| **A CDN that can't stream** | the edge buffers the whole response | check your provider; most support it now, some only on specific plans |
| **Awaiting everything before the first write** | one chunk | the bug is in your code, not the transport |
| **`Content-Length` set** | can't stream by definition | don't set it |
| **A serverless platform with a buffered response model** | one chunk | check whether your runtime supports streaming responses at all |

Debug it with `curl -N -w '\n%{time_starttransfer}\n'` against the **public** URL, not the origin.
If it streams from the origin and not from the edge, it's infrastructure, not code.

## What streaming costs you

- **No `Content-Length`** — so no progress bars for the document, and some intermediaries dislike it.
- **Headers and status are committed at the first flush.** You cannot decide to send a 500, a
  redirect, or a `Set-Cookie` after that. Anything that might fail and change the response must
  resolve *before* the first write.
- **A crash mid-stream leaves a half-written page** with a 200 status. Error handling has to move
  into the page: each slot needs an error state, because the response has already promised to
  succeed. This is the real operational cost, and it's why frameworks pair streaming with error
  boundaries.
- **Anything that must be in `<head>` must be known up front** — the title, meta tags, canonical.
  If your page's title depends on the slow query, you can't stream that part. (Frameworks work
  around this by injecting late `<title>` updates via script, which works for users and is a
  gamble with crawlers. See the SEO course.)

## Where to put the boundaries

A slot is worth having when the content is **slow and non-critical**. Getting this wrong wastes the
technique:

| Section | Stream it? |
|---|---|
| Above-the-fold hero / the LCP element | ❌ — it's what the user is waiting for; get it in the shell |
| Page title, meta, canonical | ❌ — must be in `<head>` |
| Navigation, layout | ❌ — cheap, put it in the shell |
| Reviews, recommendations, "related" | ✅ — slow and nobody is waiting |
| A personalised panel on an otherwise static page | ✅ — this is how you keep a page cacheable *and* personalised |
| Anything that could change the status code | ❌ — resolve it before the first flush |

That fifth row is worth dwelling on: streaming is what lets you serve a cached/static shell and
still inject per-user content, without making the whole page uncacheable. It's the same idea as
edge-side includes, done in the response body.

## Think about

- Streaming didn't change total time at all. So what did it change?
- Your page streams locally and not in production. What's your first check?
- Why can't you `Set-Cookie` after the first flush?

<details>
<summary>Answers</summary>

**What changed.** Three things: TTFB, the browser's ability to start subresource downloads early,
and what the user can see at each moment. None of them appear in "how long did the response take",
which is why a single duration is the wrong metric for a streamed page.

**Streams locally, not in prod.** A buffering layer between you and the client. Check, in order:
your reverse proxy (`proxy_buffering`), your CDN, your platform's response model. Verify with
`curl -N` against the public URL and against the origin — the difference tells you which hop is
buffering.

**`Set-Cookie` after flush.** Headers are sent with the status line, in the first bytes of the
response. Once they're on the wire there is nowhere left to put a header. Anything header-shaped —
cookies, redirects, cache-control, status — must be decided before the first write.
</details>

---

## 🏗️ Build challenge: streaming with error boundaries

Extend the sandbox's streaming renderer into something you'd ship:

1. **Per-slot error boundaries**: if a slot's data rejects, flush an error state for *that slot*
   and leave the rest of the page intact. Prove it with a data source that throws.
2. **A timeout per slot**: after N ms, flush a "still loading, retry" state and *keep* the
   promise, updating the slot if it eventually resolves.
3. **Ordered vs unordered flushing**: add a mode that preserves document order (a slot waits for
   its predecessors) and measure the cost. React does out-of-order by default for exactly this
   reason — measure it and you'll see why.
4. **Head-flush safety**: a check that refuses to stream a route whose `<title>` depends on a
   slow query, with a clear error naming the dependency. Better a build error than a page whose
   title arrives after the crawler left.
5. **Backpressure**: honour `res.write()` returning `false` and wait for `drain`, then prove it
   matters by streaming 50MB to a slow client. Without it a slow reader becomes unbounded memory
   on your server.
6. **A `curl -N` regression test** in CI asserting that the first chunk arrives in under 100ms for
   a route whose data takes 2 seconds.

**Done when:** a route with one failing slot, one slow slot and one fast slot renders a complete,
useful page — and your CI test fails if someone reintroduces an `await` before the first flush.

---

## Interview questions

1. What does streaming SSR actually send, and how does content get into the right place?
2. Name the three benefits of streaming. Which one do people forget?
3. What can you no longer do after the first byte is flushed?
4. Your page streams in dev and not in prod. Diagnose it.
5. Which parts of a page should *not* be behind a streaming boundary?
6. How does streaming let you cache a personalised page?
