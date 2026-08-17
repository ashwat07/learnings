# Lab 05 — Analyse & budget ⭐⭐⭐⭐⭐

**Goal:** stop the bundle growing back, with a check that names the file and the number.

**Primary metric:** initial-download bytes per entry, enforced per commit.

> ```sh
> node build.mjs --all
> node budget.mjs                       # check against budget.json
> node budget.mjs --update-baseline     # ratchet
> ```

---

## Why bundles grow back

Every bundle-size fix decays, because size grows one PR at a time and no single PR looks like the
problem:

- a new dependency for one feature
- a `"use client"` or a static import that moves 40KB from lazy to initial
- a barrel import that defeats tree shaking
- an icon set imported by name
- a polyfill added for a browser you no longer support

None of these trip a threshold on their own. **Only a per-commit check with attribution catches
them.**

## The check that works

Four properties, in order of importance:

1. **Budget the initial download**, not the total. Total size can grow safely if the growth is lazy.
2. **Attribute the change.** "JS grew 18KB" gets muted; "`main.js` grew 18KB because
   `routes/admin.js` is now statically imported" gets fixed.
3. **Flag lazy → initial transitions.** A module moving into the initial download is a regression
   even when the total is unchanged, and it's invisible to a size check.
4. **Ratchet.** Baseline at current + a small margin; never let it rise; lower it as you improve.
   A check that fails from day one gets disabled in a week.

## `budget.mjs`

The script in this folder does all four against the fixture's metafiles:

```sh
node budget.mjs                    # check
node budget.mjs --variant single   # a different build
node budget.mjs --update-baseline  # accept the current numbers
```

It fails (exit 1) on: initial bytes over budget, a module newly in the initial download, or
duplication over the threshold — and prints the offending module and the import chain that pulled
it in.

## Reproduce a failure

Watch the gate catch a real regression:

```sh
node build.mjs --variant=split
node budget.mjs --update-baseline          # green baseline

# now make the admin route static — the regression this gate exists for
#   in src/main.js, replace the dynamic admin route with a static import:
#     import { render as renderAdmin } from './routes/admin.js';
#     admin: (el, data) => renderAdmin(el, data),

node build.mjs --variant=split
node budget.mjs                            # FAIL, with the import chain
```

The failure names `src/vendor/chart-data.js` as newly initial and prints the chain that pulled it
in. Undo the edit and it goes green again.

## Where the numbers should come from

| Signal | Source | Cadence |
|---|---|---|
| Initial bytes per entry | the metafile | **every commit** — deterministic, fast, no browser |
| Per-module attribution | the metafile | every commit |
| Compressed bytes | brotli the outputs at build time | every commit |
| Parse/compile time | a real browser | nightly |
| LCP / TBT | Lighthouse CI or Playwright | nightly and on release |
| Field CWV | RUM | continuously |

The top three are cheap and deterministic — put them in the PR check. The bottom three are slow and
noisy — run them on a schedule and treat them as the reality check, not the gate.

## The report a reviewer should see

```
bundle budget: FAIL

  initial download   184.2 KB / 170 KB budget   (+14.2 KB over)
  changed since main:
    + 42.1 KB  src/vendor/chart-data.js   now INITIAL (was lazy)
        why: src/main.js → src/routes/admin.js → src/vendor/chart.js → src/vendor/chart-data.js
    -  1.2 KB  src/lib/format.js

  the admin route is now statically imported. Restore the dynamic import, or raise the budget
  deliberately.
```

Everything in it is derivable from two metafiles. That's the whole trick: the data already exists,
and almost nobody generates the diff.

## Think about

- What's the right budget for a team currently 3× over?
- Why budget initial rather than total?
- Your budget passes and the app feels slower. What did the budget miss?

<details>
<summary>Answers</summary>

**3× over.** Baseline at current + 5% and ratchet down. Being permanently red teaches everyone to
ignore the check, and then the PR that adds another 100KB looks like every other PR.

**Initial, not total.** Total can grow safely — a new lazy route adds bytes nobody downloads unless
they go there. Budgeting the total punishes the correct behaviour (adding features behind dynamic
imports) and ignores the harmful one (moving something from lazy to initial with no size change at
all).

**Passes, feels slower.** Bytes are a proxy. What it misses: parse/compile time (roughly correlated
but not the same), *execution* time on load, hydration cost, main-thread contention, an added round
trip from a new chunk, a render-blocking resource, a slower TTFB. This is exactly why the nightly
browser run exists alongside the per-commit byte gate.
</details>

---

## 🏗️ Build challenge: the whole gate

Extend `budget.mjs` into the check you'd run on a real repo:

1. **Compressed sizes**: brotli each output at build time and budget those too — that's what users
   download.
2. **Per-entry budgets** in a config file (an app may have several entries with different limits).
3. **The PR comment**: the diff table above, posted automatically, with the `--why` chain for
   anything newly initial.
4. **A dependency-attribution view**: group modules by `node_modules/<package>` and report the top
   packages by contribution. "We added 40KB of `some-ui-kit`" is more actionable than 30 module
   rows.
5. **Duplication check** across chunks, with a threshold.
6. **Trend storage**: append each commit's numbers to a file (or a service) and plot it. The graph
   is what makes size a shared concern rather than one person's hobby.

**Done when:** it runs on every PR in your own repo, its failure message names a package and an
import chain, and you've caught one real regression with it.

---

## Interview questions

1. Why do bundle-size fixes decay, and what prevents it?
2. Budget initial or total? Why?
3. What's the most useful thing a size check can print on failure?
4. Why is a "lazy → initial" transition a regression even at constant total size?
5. Which size checks belong per-commit and which nightly?
6. How would you set the first budget on a team that's well over?
