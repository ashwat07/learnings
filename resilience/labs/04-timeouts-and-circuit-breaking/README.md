# Lab 04 — Timeouts & circuit breaking ⭐⭐⭐⭐⭐

**Goal:** stop waiting at the right moment, and stop asking a dead service altogether.

**Primary metric:** time to a decision, and calls skipped while the breaker is open.

> <http://localhost:8080/resilience/labs/04-timeouts-and-circuit-breaking/>

---

## `fetch()` has no default timeout

That's a deliberate platform choice and a permanent foot-gun: every `fetch` in your codebase without
a signal can hang for minutes.

```js
await fetch(url, { signal: AbortSignal.timeout(1000) });   // TimeoutError, distinguishable from a user cancel
```

### Choosing the number

There's no value derivable from the network. You're answering **"how long is waiting still useful to
this person?"**

| Context | Starting point |
|---|---|
| a page widget | 1–3s, then degrade |
| a user-initiated save | 5–10s — they're watching, and a false failure costs them work |
| a background sync | 30s+ — nobody's waiting |
| a health check | under the interval, or checks queue on top of each other |

Then measure: **set the timeout above your p99, not your median.** A timeout below p99 converts your
slowest legitimate requests into errors, which causes retries, which causes more slowness. That
feedback loop is a classic self-inflicted outage.

Distinguish the two clocks: a **connect** timeout (can I reach it?) can be short; a **response**
timeout (is it still working?) has to accommodate real work.

## Hedged requests

If the first attempt hasn't answered within ~p95, fire a second and take whichever answers first.
It's the standard technique for cutting **tail** latency — the p99 is usually one unlucky request,
not a slow system.

The rules that keep it from becoming an outage: **idempotent operations only**; threshold at ~p95 so
you hedge ~5% of requests; **disable it when the error rate rises** (hedging under load doubles
traffic in exactly the wrong direction); and cancel the loser.

## The circuit breaker

| State | Behaviour |
|---|---|
| **CLOSED** | normal; count failures |
| **OPEN** | fail immediately for a cooldown — no traffic reaches the dependency |
| **HALF-OPEN** | after the cooldown, let **exactly one** probe through; success closes, failure re-opens |

Half-open is what makes recovery safe. Without it the breaker either stays open forever or dumps the
full restored load onto a service that just came back — knocking it over again.

**Why fail fast?** When a dependency is down for *everyone*, more requests don't help you and
actively hurt it: they consume its connection pool, threads and recovery headroom. And it improves
*your* latency — a fast failure renders the fallback immediately instead of after a timeout.

### Tuning

| Knob | Trade |
|---|---|
| threshold | too low → a blip degrades your page; too high → you hammer a dying service. Prefer a **failure rate** (>50% of the last 20) over a raw count, so a low-traffic path doesn't trip on two unlucky calls |
| cooldown | long enough to actually recover, short enough that you're not showing a fallback after it's healthy. Seconds, not minutes |
| scope | **one breaker per dependency**, never one for the whole app |

### The front-end caveat

A breaker in one browser tab only protects that tab. Its value here is mostly **local** — fast
failure and a calm UI — while the load-shedding benefit only materialises because every client runs
the same logic. The place a breaker does real protective work is your **BFF or gateway**, where one
process sees the aggregate error rate.

## Breaker + fallback, always

A breaker makes failure **fast**; it doesn't make it **good**. Fast failure into an empty page is
worse than a slow success. The breaker buys you the time to show a fallback immediately instead of
after a timeout.

## Think about

- Your p99 is 4s and you set a 2s timeout. What happens?
- Why one breaker per dependency?
- Is a client-side breaker worth building at all?

<details>
<summary>Answers</summary>

**2s timeout on a 4s p99.** You've declared ~2–3% of successful requests to be failures. They'll be
retried, which adds load, which raises latency, which pushes more requests past the timeout — a
positive feedback loop that can take down a service that was merely slow. Set timeouts from measured
latency and revisit them when the distribution changes.

**One per dependency.** A shared breaker couples unrelated failures: a broken recommendations
service opens the breaker and your checkout calls start failing fast for no reason. The breaker's
whole purpose is isolation, and sharing it inverts that.

**Client-side breaker.** Worth it for the *user experience* — you avoid a 5-second timeout on every
widget when a service is down, and the page settles into its degraded state immediately. Not worth
much for *protecting the service*, since each tab has its own tiny sample and can't see aggregate
health. If you have a BFF, put the real breaker there and let the client just handle fast failures
gracefully.
</details>

---

## 🏗️ Build challenge

1. Add a timeout to **every** fetch. Enforce it: a lint rule or a wrapper that's the only way to
   call `fetch`.
2. Set each timeout from measured p99 per endpoint, not a global constant.
3. Implement a per-dependency breaker in your BFF with failure-rate thresholds and half-open probes.
   Expose its state in a health endpoint.
4. Pair every breaker with a fallback: cached response, static default, reduced feature.
5. Test recovery specifically — take a dependency down for 60s, bring it back, and confirm exactly
   one probe goes out before traffic resumes.

**Done when:** a dead dependency produces a degraded page in under a second, and its recovery doesn't
cause a stampede.

---

## Interview questions

1. Why does `fetch` have no default timeout, and what do you do about it?
2. How do you choose a timeout value?
3. Describe the three breaker states and what half-open is for.
4. Why a failure rate rather than a failure count?
5. When is a hedged request dangerous?
