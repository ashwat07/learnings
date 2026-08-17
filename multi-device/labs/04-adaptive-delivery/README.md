# Lab 04 — Adaptive delivery ⭐⭐⭐⭐

**Goal:** send less to devices that can take less — without building a worse product for them.

> <http://localhost:8080/multi-device/labs/04-adaptive-delivery/>

---

## The signals

| Signal | Caveat |
|---|---|
| `hardwareConcurrency` | logical cores; says nothing about their speed |
| `deviceMemory` | GB, **rounded down to a power of 2 and capped at 8** — a 6GB phone reports 4 |
| `connection.effectiveType` | an estimate from recent throughput and RTT, not the radio type |
| `connection.rtt` / `downlink` | heavily smoothed |
| **`connection.saveData`** | **the user explicitly asked for less** |
| `prefers-reduced-data` | the CSS equivalent |
| `devicePixelRatio` | fill cost scales with its square |

None is precise, several are Chromium-only, and together they're still far better than guessing from
the user agent.

**Act on Save-Data unconditionally.** It's a request, not telemetry. It also arrives as a request
header (`Save-Data: on`), so your CDN can act on it before any JavaScript runs.

Treat `deviceMemory` as three buckets (≤2 weak, 4 mid, ≥8 fine), not a number.

## Measure rather than ask

A measured signal beats a reported one and works in every browser:

- **a short CPU loop** at startup — tens of ms on a laptop, hundreds on a cheap phone
- **your own frame rate** over half a second, which also tells you the refresh rate
- **your own past RUM data** — the best signal of all, because it's what actually happened to users
  like this one

Two warnings: don't run an expensive probe on the critical path (you've made the slow device slower —
measure at idle and cache the result), and remember thermal throttling means a device isn't one
speed. **Prefer adapting continuously** (drop fidelity when frames drop) over classifying once.

## What to adapt

| Adapt | How | Saves |
|---|---|---|
| **third-party scripts** | defer or drop the non-essential ones | usually the biggest CPU cost on a real site |
| image resolution/format | `srcset`, lower DPR cap under Save-Data | usually the biggest byte win |
| video autoplay | off under Save-Data or slow `effectiveType` | megabytes and battery |
| prefetching / speculation rules | off under Save-Data | bandwidth the user didn't agree to spend |
| animation fidelity | fewer particles, lower pixel ratio | frames on weak GPUs |
| virtualization window | render fewer rows ahead | main-thread time |
| font loading | system stack under Save-Data | a render-blocking request |

**Do it as far up the stack as you can.** A CDN varying on `Save-Data` serves a smaller image with no
JavaScript involved; a client-side decision has already paid for the request. But `Vary: Save-Data`
fragments your cache — measure the hit rate.

## The line

> **Adapt fidelity, never capability.**

| Fine | Not fine |
|---|---|
| a smaller image, no autoplay, a system font | fewer features, a cut-down "lite" site |
| fewer particles, no prefetch, a simpler animation | hidden content, a different price |

The separate-mobile-site era ended for exactly this reason: the lite version was always behind,
always missing things, and the people on it were the ones who could least afford a worse product.

Three more cautions:

- **Never trap the user in a decision you made for them.** Offer "Load high quality".
- **These signals are fingerprinting surface.** `hardwareConcurrency` + `deviceMemory` + DPR + fonts
  is a meaningful part of a fingerprint, which is why browsers coarsen them and why Safari and
  Firefox don't implement several. Use them; don't log them.
- **Test the adapted path.** A degraded mode nobody runs is a degraded mode that's broken — the same
  point as [resilience lab 05](../../../resilience/labs/05-chaos/).

**And the honest baseline: the best adaptation is being small and fast for everyone.** A 100KB app
needs very little adaptive machinery. Reach for this after
[asset-optimization](../../../asset-optimization/) and [bundle-strategy](../../../bundle-strategy/).

## Think about

- `effectiveType` says `4g` but requests are timing out. Now what?
- Should you serve a different JS bundle to low-end devices?
- Is `deviceMemory: 4` a low-memory device?

<details>
<summary>Answers</summary>

**`4g` but timing out.** Trust your own measurements over the API. `effectiveType` is a smoothed
estimate from *recent* traffic and lags reality badly on a connection that just degraded — a train
entering a tunnel still reports `4g` for a while. Use your actual request timings and error rates as
the live signal, and treat `effectiveType` as a starting hint before you have data of your own.

**A different bundle for low-end devices.** Usually no — you'd be maintaining two builds, testing
one, and the cut-down one would rot. What *does* work is the same bundle with runtime-adaptive
behaviour (fewer prefetches, lower fidelity, deferred third parties) and route-level code splitting
that benefits everyone. The exception is genuinely enormous optional features — a 3D viewer, a rich
text editor — which should be dynamically imported anyway, and whose import you can simply decline on
a weak device.

**`deviceMemory: 4`.** Mid-range, not low. The value is rounded *down* to a power of two and capped
at 8, so 4 covers everything from 4GB to just under 8GB, and a high-end phone often reports 8. The
useful buckets are ≤2 (genuinely constrained — be careful), 4 (typical), ≥8 (comfortable). Any logic
that treats it as a linear scale is reading precision that isn't there.
</details>

---

## 🏗️ Build challenge

1. Add device-class detection: a cached idle CPU probe plus the reported signals, in three buckets.
2. Honour `Save-Data` end to end — CDN image quality, no prefetch, no autoplay, system fonts.
3. Make your third-party script loading conditional on device class. Measure the CPU saved.
4. Add continuous fidelity adaptation to your heaviest animation, driven by measured frame rate.
5. Record device class in RUM and compare Core Web Vitals per bucket. Fix the worst bucket.
6. Test the degraded path deliberately, and keep an escape hatch.

**Done when:** your p75 on the weakest bucket meets the same thresholds as the strongest, and nobody
lost a feature.

---

## Interview questions

1. Which capability signals exist, and what's wrong with each?
2. Why is `Save-Data` different from the others?
3. Why measure rather than read reported values?
4. Where's the line between adapting fidelity and adapting capability?
5. Why are these APIs a privacy concern?
