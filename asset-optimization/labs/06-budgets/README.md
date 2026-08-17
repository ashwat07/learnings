# Lab 06 — Budgets ⭐⭐⭐⭐⭐

**Goal:** turn "make it faster" into a number a build can check, allocated across asset types before
anyone writes code.

**Primary metric:** critical-path bytes per route, enforced in CI.

> <http://localhost:8080/asset-optimization/labs/06-budgets/>
> CLI: `node budget-check.mjs <url>`

---

## Derive the budget, don't invent it

A budget of "under 2.5s LCP" is a goal, not a budget. A *budget* is the byte allowance that
produces that goal on the connection your users have:

```
LCP target                                    2500ms
− handshake (3 RTT: DNS + TCP + TLS)          −450ms
− the HTML request (1 RTT)                    −150ms
− server time                                 −200ms
─────────────────────────────────────────────────────
= transfer time available                     1700ms
× Fast 4G throughput (1.5 MB/s)
= ~2.5MB … on Fast 4G. On Slow 4G: ~85KB.
```

Run the calculator with each profile. **On Slow 4G the handshake alone is over a second** — which
is why reducing *round trips* (the resource-hints course) matters as much as reducing bytes for
users on slow connections.

Then split the allowance by type:

| Type | Share | Why |
|---|---|---|
| HTML | 10% | the document |
| CSS | 10% | render-blocking by definition |
| JS (critical) | 20% | anything that must run before the page is usable |
| **LCP image** | **45%** | the thing the metric is named after |
| Fonts | 10% | above-the-fold faces only |
| Everything else | 5% | |

## What makes a budget usable rather than decorative

1. **Per type**, so it can be assigned to whoever owns that type.
2. **About the critical path**, not the whole page — lazy-loaded below-the-fold images aren't in
   it, which is precisely what makes lazy loading valuable.
3. **Checkable by a script**, so it's a build failure rather than an opinion in a retro.
4. **Per route**, because a product page and a marketing page have different budgets.

## The CLI

```sh
node budget-check.mjs http://localhost:8080/render/ssr-par/product/3
node budget-check.mjs --budget js=120,total=900 https://example.com/
node budget-check.mjs --json https://example.com/ | jq '.[0].assets[:5]'
```

It fetches the HTML, extracts declared subresources, totals bytes per type, flags compressible
assets served uncompressed and assets with `no-store`, and exits 1 on a breach.

**What it deliberately doesn't do: run JavaScript.** So it measures what the *HTML* costs, which is
what a per-commit gate should be about. Anything a bundle fetches at runtime needs a real browser —
that's the build challenge.

## Bytes vs Core Web Vitals

Run the sandbox audit. Note that the **CSR page has the smallest critical-path bytes and the worst
LCP** ([rendering-strategies lab 01](../../../rendering-strategies/labs/01-the-strategies/)).

> A byte budget is necessary and not sufficient.

The division of labour that works:

| | Check | When |
|---|---|---|
| **Bytes** | `budget-check.mjs` | every commit — cheap, deterministic, no flakiness |
| **Core Web Vitals (lab)** | Lighthouse CI / Playwright | nightly and on release branches — slower, noisier |
| **Core Web Vitals (field)** | RUM / CrUX | continuously — the only numbers that are actually true |

Field data is the ground truth; lab data explains it; byte budgets prevent it from getting worse.

## Setting the first budget on an existing site

Don't set the ideal number — you'll fail on day one and mute the check. Instead:

1. Measure the current value per route.
2. Set the budget at **current + 5%** so nothing can grow much.
3. Ratchet it down as things improve, and never let it rise.

This is the only approach that survives contact with a real team. A gate that fails on every PR from
the start gets disabled in a week.

## Think about

- Your budget says 170KB of JS and you're at 400KB. What do you set the budget to today?
- Which routes deserve different budgets?
- Bytes are under budget and LCP got worse. What happened?

<details>
<summary>Answers</summary>

**400KB against a 170KB target.** Set it to 420KB today and start ratcheting. A budget you're
already failing provides no signal — every PR is red, so nobody reads it, and the one PR that adds
another 100KB looks exactly like the rest. Ratcheting turns the same target into a series of
achievable steps *and* prevents regression while you work.

**Different budgets per route.** Landing pages (first visit, cold cache, from search) get the
tightest budget. Deep app routes behind a login, where the bundle is warm and the user is committed,
get a looser one. A single site-wide number is either too loose for the landing page or absurd for
the editor.

**Bytes fine, LCP worse.** Bytes aren't the only input: discovery order (the image moved behind a
CSS chain), priority (something else got the connection), a new render-blocking script, server TTFB,
or the LCP element itself changed to something slower. This is exactly why the byte gate is per
commit and the CWV check is nightly — the byte gate can't see any of those.
</details>

---

## 🏗️ Build challenge: the full gate

Extend `budget-check.mjs` into the check you'd actually run:

1. **A real browser pass** (Playwright + CDP throttling): capture LCP, CLS, TBT, and the *actual*
   transferred bytes per type — including everything JS fetched at runtime, which the static pass
   cannot see. Compare the two numbers and report the gap; a large gap means your page's cost is
   invisible to static analysis.
2. **Per-route budgets in a config file**, with the ratchet built in: a `--update-baseline` flag
   that writes the current values back, so improving is a one-command commit.
3. **Attribution on failure**: don't just say "JS is 20KB over" — diff the asset list against the
   baseline and name the file that grew, with its before/after size. That single feature is the
   difference between a check people act on and one they mute.
4. **The largest-asset report** in the PR comment, so the reviewer sees the top five by bytes.
5. **A filmstrip artifact** on CWV failures.
6. **Field correlation**: pull your RUM p75 LCP per route and put it next to the lab number. When
   they diverge, the lab profile is wrong — and knowing that is worth more than another lab run.

**Done when:** it runs on every PR in under a minute, its failure message names a file and a number,
and someone who didn't write it can act on the output without asking you what it means.

---

## Interview questions

1. How do you derive a byte budget from an LCP target?
2. Why does the handshake matter more on slow connections than on fast ones?
3. What's the right first budget for a site that's currently 3× over?
4. Which routes get tighter budgets, and why?
5. Byte budgets pass and LCP regresses. Name three causes.
6. How do lab metrics, field metrics and byte budgets divide up between per-commit, nightly and
   continuous checks?
