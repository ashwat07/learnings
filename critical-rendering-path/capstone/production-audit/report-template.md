# Performance audit — <target>

**Auditor:** <you> · **Date:** <YYYY-MM-DD> · **Time spent:** <hours>
**Scope:** <which URLs / flows> · **Out of scope:** <auth areas, admin, checkout, …>

---

## 1. Executive summary

> One page maximum. Assume this is the only section most readers finish — because it is.

Three sentences of verdict. What's the headline problem, who does it affect, and is this app in
good, mediocre, or poor shape overall?

**Top 3 findings**

| # | Finding | Est. impact | Effort | Confidence |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |

**If the team does nothing else, do #1** — one sentence on why.

---

## 2. Method and environment

| | |
|---|---|
| Browser + version | |
| Extensions | disabled (incognito) |
| Runs per measurement | 3, median reported |
| Mobile profile | CPU 4× / 6×, Fast 3G / Slow 4G |
| Desktop profile | no throttle |
| Viewports | 390×844, 1440×900 |
| Date/time of runs | |
| Tools | Lighthouse <ver>, Chrome DevTools, CrUX via PageSpeed Insights |

**Caveats:** <anything that limits reproducibility — geography, CDN region, logged-out only, a flaky
third party that failed to load on one run, …>

---

## 3. Load performance

### Cold load (empty cache)

| Metric | Mobile 4× / Fast 3G | Mobile 6× / Slow 4G | Desktop | Target |
|---|---|---|---|---|
| FCP | | | | < 1.8s |
| LCP | | | | < 2.5s |
| LCP element | | | | — |
| CLS | | | | < 0.1 |
| TBT | | | | < 200ms |
| Requests | | | | — |
| Transferred | | | | — |
| Render-blocking resources | | | | 0–1 |
| Unused CSS / JS | % / % | | | — |
| Longest task | | | | < 50ms |

### Warm load

| Metric | Value | vs cold |
|---|---|---|
| FCP | | |
| LCP | | |
| Transferred | | |

### Third parties

| Origin | Purpose | Bytes | Main-thread ms | Blocking? |
|---|---|---|---|---|
| | | | | |

**Total third-party cost:** <bytes> / <ms> — <what fraction of the whole>

---

## 4. Interaction performance

| Interaction | INP | Input delay | Processing | Presentation | Dominant phase | Bottleneck stage |
|---|---|---|---|---|---|---|
| | | | | | | |
| | | | | | | |
| | | | | | | |
| | | | | | | |
| | | | | | | |

**Scroll performance**

| Region | FPS | Worst frame | Cause |
|---|---|---|---|
| | | | |

**Layers:** <count> promoted, <MB> GPU memory. <Over-promotion? Layer explosion? Reason strings.>

**Forced reflows:** <count during which interactions, and the call site if identifiable>

---

## 5. Sustained use (10 minutes)

| Metric | t=0 | t=5min | t=10min | After GC | Verdict |
|---|---|---|---|---|---|
| JS heap | | | | | |
| DOM nodes | | | | | |
| Listeners | | | | | |
| Detached nodes | | | | | |

**Did it get slower?** Re-ran <interaction> at t=0 and t=10:
<number> → <number>. <Conclusion.>

---

## 6. Field data (CrUX p75)

| Metric | Field (real users) | My lab measurement | Agree? |
|---|---|---|---|
| LCP | | | |
| INP | | | |
| CLS | | | |

**Where they disagree:** <which metric, and the most likely explanation — device mix, geography,
cache rates, logged-in state. Say which you'd trust for prioritisation and why.>

---

## 7. Findings, ranked

> 8–15 findings. Repeat this block for each. Ranked by impact × confidence ÷ effort.

### F1 — <short title>

| | |
|---|---|
| **Symptom** | what a user experiences |
| **Evidence** | trace screenshot / numbers / repro steps |
| **Mechanism** | which pipeline stage or resource, and why — be specific |
| **Recommendation** | what to change |
| **Est. impact** | user-facing unit, with a range if uncertain |
| **Effort** | S / M / L (<n> eng-days), risks: <…> |
| **Confidence** | high / medium / low, and why |
| **Related lab** | for your own reference |

### F2 — …

---

## 8. Deliberate non-findings

> Things that are slow, that you are **not** recommending changing. This section is what makes the
> report credible.

| Thing | Cost | Why I'm leaving it |
|---|---|---|
| | | |

---

## 9. What I couldn't determine

> Where you ran out of access, time, or certainty. Be specific — this builds more trust than
> implying completeness.

- <…>

---

## 10. Prediction scorecard

Sealed before starting:

| # | Prediction | Actual | Right? |
|---|---|---|---|
| 1 | | | |
| 2 | | | |
| 3 | | | |

**What this tells me about my instincts:** <one honest paragraph. If you were badly wrong, this is
the most valuable text in the document.>

---

## 11. Anticipated objections

| Recommendation | Strongest objection | My response (with evidence) |
|---|---|---|
| | | |

---

## Appendix

- Lighthouse JSON: `appendix/lighthouse-*.json`
- Trace files: `appendix/trace-*.json`
- Screenshots: `appendix/`
- Raw run data (all 3 runs per measurement, not just medians)
