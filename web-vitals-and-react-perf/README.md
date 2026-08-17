# Core Web Vitals & React render performance ⭐⭐⭐⭐⭐

Three numbers describe how a page feels: **is it there yet** (LCP), **does it hold still** (CLS),
**does it answer me** (INP). This course measures each one properly, breaks it deliberately, fixes
it, and then does the same for the React render that sits underneath INP.

```sh
./serve.sh          # labs 01–04
cd react-sandbox && npm install && npm run dev     # labs 05–06
```

---

## The metrics, and what each is really asking

| Metric | Good | Question | Almost always caused by |
|---|---|---|---|
| **LCP** | ≤ 2.5s | is the main content there? | the resource-discovery chain, not the resource |
| **CLS** | ≤ 0.1 | does the layout hold still? | space not reserved before content arrives |
| **INP** | ≤ 200ms | does it answer me? | the main thread being busy with something else |
| TTFB | ≤ 800ms | did the server start replying? | your backend, or a redirect chain |
| FCP | ≤ 1.8s | did anything paint? | render-blocking CSS/JS |

"Good" means the **75th percentile of real users** on a real distribution of devices and networks —
not your machine. Every one of those thresholds is a promise about your worst quarter of visits.

## Curriculum

| # | Lab | Question it answers | ⭐ |
|---|---|---|---|
| 01 | [Measuring](labs/01-measuring/) | What do these numbers actually count? | ⭐⭐⭐⭐⭐ |
| 02 | [LCP](labs/02-lcp/) | Which element, and which of the four phases? | ⭐⭐⭐⭐⭐ |
| 03 | [CLS](labs/03-cls/) | Which node moved, and what pushed it? | ⭐⭐⭐⭐ |
| 04 | [INP](labs/04-inp/) | Input delay, processing, or presentation? | ⭐⭐⭐⭐⭐⭐ |
| 05 | [React render perf](labs/05-react-render-perf/) | Why did that click render 400 components? | ⭐⭐⭐⭐⭐ |
| 06 | [Profiling & budgets](labs/06-profiling-and-budgets/) | How do I keep it fixed? | ⭐⭐⭐⭐ |

Prerequisites: [critical-rendering-path](../critical-rendering-path/) (what layout and paint cost)
and [event-loop](../event-loop/) labs 03–05 (why the main thread is the bottleneck for INP).

## Read `shared/vitals.js` first

[`/shared/vitals.js`](../shared/vitals.js) is a readable stand-in for the `web-vitals` library —
about 120 lines, and every subtlety in it is one you'll eventually have to explain to someone:

- **LCP keeps updating until the first interaction.** The "largest" element can change late, and a
  click during load freezes the metric — which is why field LCP is noisier than lab LCP.
- **CLS is the largest 5-second session window, not the total.** Summing punished long-lived pages;
  windowing scores the *worst moment*.
- **INP is roughly the 98th-percentile interaction**, not the worst and not the first.
- Every observer uses `buffered: true`, or you lose everything that happened before your script ran.

Use the real library in production. Read this one to know what it's doing.

## The one habit

**Never optimise a metric you haven't attributed.** "LCP is 4s" is not actionable. "LCP is the hero
image, which isn't discovered until the CSS that references it has parsed, at 2.9s" is a fix.
Every lab here ends with the attribution, not the number.
