# Lab 05 — Fix the waterfall ⭐⭐⭐⭐⭐

**Goal:** take a 4.5s LCP to under 1.5s by changing only *when* things are discovered — no
deleting resources, no shrinking images.

**Primary metric:** LCP at Fast 4G, median of three runs.

> Open <http://localhost:8080/resource-hints/labs/05-fix-the-waterfall/>

---

## The exercise

`broken.html` is a product page with eight independent discovery problems. `your-fix.html` is an
identical copy with the TODO list in the source. The constraint — **every resource must still
load, at the same size and delay** — is deliberate: in real life you'd delete the 200KB analytics
script, and then you'd never learn to read a waterfall.

Measure first. Three runs, Fast 4G, hard reload, median:

| Metric | broken | your fix | target |
|---|---|---|---|
| LCP | | | < 1.5s |
| FCP | | | < 1.0s |
| chain depth | | | 1 |
| duplicate downloads | | | 0 |
| CLS | | | < 0.05 |
| console warnings | | | 0 |

## Method

Work in this order — it's the order that generalises to any page:

1. **Find the LCP element** (DevTools → Performance → LCP marker, or the Elements pane's LCP
   badge). Everything else is secondary.
2. **Trace its discovery chain backwards.** What had to arrive before the browser knew this URL?
   That chain is your critical path.
3. **Collapse the chain** — hoist the URL into the HTML, by any means.
4. **Then** fix priority: make sure nothing unimportant is ahead of it.
5. **Then** fix blocking: what's delaying first paint?
6. **Re-measure after each change, individually.** If you make eight changes and LCP halves, you
   don't know which one mattered — and next time you'll cargo-cult all eight.

## Hints, one per problem

<details><summary>1 — the synchronous third-party script</summary>

It blocks the parser for 500ms. `defer` keeps execution order and runs it after parsing; `async`
runs it as soon as it arrives. For a tag manager that other scripts depend on, `defer` is the
safe choice. Ask yourself what actually breaks if it runs 500ms later — usually nothing, and if
something does, that's worth knowing.
</details>

<details><summary>2 — the cross-origin connection</summary>

`<link rel="preconnect" href="http://localhost:8081">` as the **first** thing in the head, before
the stylesheet that will occupy the next 600ms. Note that both third-party scripts use that
origin, so one preconnect serves both.
</details>

<details><summary>3 — the LCP image behind the stylesheet</summary>

Two options, and they're not equivalent:

- `<link rel="preload" as="image" fetchpriority="high" href="…">` with the URL copied *exactly*
  from the CSS. Fastest to write, and the URL duplication is now a maintenance hazard.
- Restructure: make the hero a real `<img>` in the HTML. The preload scanner finds it, it gets
  normal image priority handling, and there's no duplicated URL. Better, if the design allows.

Pick one, and say in a comment why.
</details>

<details><summary>4 — the lazy hero</summary>

`loading="lazy"` on the LCP element means layout must run before the request starts. Remove it.
(Note it's on a `<div>` here, where the attribute does nothing at all — which is its own lesson
about attributes that silently don't apply. If you convert the hero to an `<img>` as part of fix
3, make sure you don't carry `loading="lazy"` across with it.)
</details>

<details><summary>5 — the 3-hop data chain</summary>

`HTML → module → import → fetch` is three round trips before any data.

- `<link rel="modulepreload">` for both modules removes two hops.
- `<link rel="preload" as="fetch" crossorigin>` for the data removes the third.
- Better still: start the fetch in an inline `<script>` in the head, stash the promise on
  `window`, and have the module `await` it. The request then starts at ~0ms and the module
  consumes it when it's ready. This "early fetch, late await" pattern is the single most effective
  trick for client-rendered apps.
- Best of all in production: server-render the data into the HTML. No request at all.
</details>

<details><summary>6 — the mismatched preload</summary>

The preload is `…&delay=400`; the fetch is `…&delay=400&fields=all`. Different URLs, so two
downloads, plus the "preloaded but not used" warning. Make them byte-identical, and add
`crossorigin` because `fetch()` is CORS-mode.

The robust fix in real code: derive both from one constant, so they can't drift.
</details>

<details><summary>7 — the invisible thumbnails</summary>

They're created in JS, so nothing can discover them early. Options: render them in the HTML
(best), preload them (wasteful — twelve high-priority preloads is exactly Lab 03's page 04), or
leave them late *and* mark them `fetchpriority="low"` / `loading="lazy"` so they stop competing
with the hero. For thumbnails below the fold, the last option is usually right: the fix isn't to
make them faster, it's to stop them stealing bandwidth from the hero.
</details>

<details><summary>8 — the layout shift</summary>

`width` and `height` attributes (or `aspect-ratio` in CSS) on every image, and a reserved box for
the price/stock lines so they don't jump when the data lands. CLS is caused by content arriving
into an unreserved space; the fix is always reservation, never animation.
</details>

## When you're done

Write the change log, in the format a PR would want:

```
1. preconnect to :8081                          FCP −180ms   LCP −180ms
2. defer the tag manager                        FCP −420ms   LCP −420ms
3. preload the hero image (matched URL)         LCP −600ms
4. remove lazy from the hero                    LCP −120ms
5. modulepreload + early fetch for the data     data ready −800ms (no LCP effect)
6. fix the preload URL mismatch                 −80KB, −1 warning
7. thumbnails to fetchpriority=low              LCP −240ms
8. width/height on images                       CLS 0.24 → 0.01
────────────────────────────────────────────────────────────
                                                LCP 4.5s → 1.4s
```

Two things that make this a real deliverable rather than an exercise:

- **Per-change numbers, not just the total.** That's the difference between "we made it faster"
  and knowing which of your habits are worth keeping.
- **The ones that didn't help.** Fix 5 improves data latency and does nothing for LCP. Saying so
  is what makes the rest of the table believable.

---

## 🏗️ Build challenge: make it a regression test

A fix that isn't enforced is a fix with a shelf life of one sprint.

Build `perf-budget.mjs` — a CI gate using Puppeteer or Playwright:

```sh
node perf-budget.mjs your-fix.html --profile fast4g --runs 5 --budget lcp=1500,cls=0.05,chain=2
```

Requirements:

1. Drive a headless browser with **CPU and network throttling** set explicitly (via CDP:
   `Network.emulateNetworkConditions`, `Emulation.setCPUThrottlingRate`). A budget measured on an
   unthrottled CI machine is meaningless.
2. Run N times and report the **median and p90**, not one number. Fail on the median; warn on p90.
3. Compute **critical chain depth** from the initiator graph, and fail if it grows — this is the
   metric that catches a regression *before* it shows up in LCP on a fast connection.
4. Detect duplicate downloads and unused preloads, and fail on either.
5. Emit a diff against a stored baseline, with per-resource start/end times, so a failure tells the
   developer which resource moved.
6. Post it as a PR comment (or write a JSON artifact a bot can post).

**Stretch:** capture a filmstrip and store it as an artifact, so the reviewer sees the difference
instead of reading about it.

**Done when:** the gate passes on your fixed page, fails on `broken.html`, and the failure message
names the specific resource and chain that regressed.

---

## Interview questions

1. Walk me through how you'd find why a page's LCP is 4 seconds, in order, with no profiler open
   yet.
2. What's the difference between fixing discovery, fixing priority, and fixing blocking? Give an
   example of each.
3. You made eight changes and LCP halved. How do you report that?
4. Which of these never helps LCP: preconnect, preload, prefetch, fetchpriority, defer,
   modulepreload? Under what circumstances would your answer change?
5. Your fix works on your laptop and not in the field. Name four reasons.
