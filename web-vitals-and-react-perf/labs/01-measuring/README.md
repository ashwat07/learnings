# Lab 01 — Measuring the vitals ⭐⭐⭐⭐⭐

**Goal:** know exactly what each number counts, so you never optimise the wrong thing.

> <http://localhost:8080/web-vitals-and-react-perf/labs/01-measuring/>

---

## What starts and stops each clock

| Metric | Starts | Stops | The gotcha |
|---|---|---|---|
| **LCP** | navigation start | render of the largest text block or image | keeps updating **until the first interaction** |
| **CLS** | always on | never — it's a running maximum | the largest **5s session window**, not the sum; shifts within 500ms of input are excluded |
| **INP** | user input | **the next paint** after the handlers | ~98th-percentile interaction of the visit, not the worst |
| TTFB | navigation start | first byte | includes redirects, DNS, TLS |
| FCP | navigation start | first text or image painted | a spinner counts |

## Three experiments

**Click during load.** LCP freezes. That's specified: once the user has interacted, later content is
a *response* to them, not loading. Consequence you'll meet in real data — a user who clicks early
produces a *lower* LCP than one who waits, on the same page. Field LCP is a distribution over user
behaviour, not a property of your HTML.

**Inject a banner.** The `layout-shift` entry names the **paragraph**, not the banner. The source is
the victim, not the cause: look for what appeared *above* the node that moved.

**Run a 300ms handler.** INP splits into three phases:

```
input delay    the thread was busy when the user touched the screen
processing     your handlers
presentation   handler end → pixels: style, layout, paint, composite
```

Most people optimise only *processing*, which is frequently the smallest of the three.

## Two combinations to recognise instantly

| Pattern | Means |
|---|---|
| FCP fast, LCP slow | you're painting a skeleton; content arrives much later |
| LCP fast, INP slow | server-rendered but not interactive — the hydration uncanny valley, measured ([hydration-strategies lab 01](../../../hydration-strategies/labs/01-hydration-cost/)) |

## Field vs lab

| Source | Is | Good for | Bad at |
|---|---|---|---|
| CrUX / field | real users, 28-day rolling p75 | the truth; what Search uses | slow, coarse, no attribution |
| RUM (your beacon) | real users, your dimensions | per-route, per-device attribution | you build and pay for it |
| Lighthouse | one simulated load | reproducible diagnosis | never interacts — reports TBT, not INP |
| DevTools Performance | one profiled load | **causality** — you see the long task | your machine isn't your users |

**Lab tools find causes; field tools set priorities.** The loop: field data says which page and
which metric → reproduce in the lab with matching throttling → fix → confirm in the field 28 days
later. The last step is the one teams skip, and the only one that counts.

## Think about

- Your p75 LCP is 4s but your own reload is 900ms. What are the three most likely reasons?
- Why can't Lighthouse report INP?
- Why is CLS a windowed maximum rather than a total?

<details>
<summary>Answers</summary>

**p75 vs your reload.** (1) Device — a mid-range Android is roughly 4–6× slower on CPU than a
developer laptop, and CPU decides render delay and hydration. (2) Network — p75 includes 3G/4G,
high-latency links, and cold caches, while your reload is a warm cache on fibre. (3) Population —
your p75 is dominated by whichever route or geography has the most traffic, which may not be the
page you keep testing. Fix the diagnosis before the code: segment the field data by device class and
route first.

**Lighthouse and INP.** INP requires an interaction, and Lighthouse doesn't perform one. It reports
**Total Blocking Time** — the sum of long-task time over 50ms during load — which correlates with
INP but measures a different thing (capacity to respond, not an actual response). Use TBT as a
proxy in CI and INP from the field as the truth.

**Windowed CLS.** Under total-sum scoring, a page that lives longer accumulates more score simply by
existing — an infinite feed or a long reading session would fail without anything ever jumping
badly. Windowing (shifts within 1s of each other, capped at a 5s window, take the maximum) scores
the *worst moment*, which is what a user actually experiences.
</details>

---

## 🏗️ Build challenge: a RUM beacon worth having

1. Use the real `web-vitals` library with **attribution**: `onLCP`, `onCLS`, `onINP` from
   `web-vitals/attribution`.
2. Send, per metric: the value, the rating, **and the attribution** — LCP element + phase
   breakdown, CLS largest-shift target, INP target + phase breakdown + `loadState`.
3. Add dimensions you'll actually segment by: route pattern (not the raw URL), device memory,
   `effectiveType`, and whether the navigation was a cold load or a soft SPA transition.
4. Send with `navigator.sendBeacon` on `visibilitychange → hidden`, never on `unload` — `unload`
   doesn't fire reliably on mobile.
5. Build one chart: **p75 by route**, with the top attribution value listed next to each row.

**Done when:** someone can open the dashboard, see the worst route, and know which element to fix
without opening DevTools.

---

## Interview questions

1. What does LCP stop measuring at, and why does that matter for field data?
2. Break INP into its phases. Which do you check first, and why?
3. Why is CLS a session-window maximum?
4. Which shifts don't count towards CLS?
5. When would you trust field data over a Lighthouse score?
