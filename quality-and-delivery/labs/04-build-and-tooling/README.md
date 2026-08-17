# Lab 04 — Build & tooling ⭐⭐⭐⭐

**Goal:** make the feedback loop short, because everything else compounds off it.

Measure your own numbers; there's no page for this one.

---

## The three loops

| Loop | Target | Why it matters |
|---|---|---|
| **inner** — save → see the change | **< 1s** | you do it hundreds of times a day |
| **PR** — push → all checks green | < 10 min | longer and people context-switch away |
| **release** — merge → in production | < 30 min | it decides how big each change is |

**The inner loop is worth the most and is measured the least.** A 3-second HMR instead of 300ms, done
400 times a day, is 18 minutes of waiting — but the real cost is that you stop making small
experimental changes, which is where most of the design work happens.

## Why the modern tools are fast

| Technique | Effect |
|---|---|
| **native-speed transforms** (esbuild, SWC, Rust/Go) | 10–100× over a JS-based transpiler |
| **native ESM in dev** — no bundling at all | startup independent of app size |
| transform on demand | only what the browser actually requested |
| persistent caching | the second start is nearly free |
| parallelism | multi-core, which single-threaded JS tooling never used |

Vite's insight is the second one: **in development, don't bundle**. The browser supports ESM, so
serve modules directly and transform each on request. Startup stops scaling with project size — a
2,000-module app starts as fast as a 20-module one.

**Type-checking is the usual remaining bottleneck**, because `tsc` is not native-speed. Run it in
parallel with the build, not in series, and use `isolatedModules` so your transformer never needs
type information.

## Making CI fast

| Lever | Effect |
|---|---|
| **cache dependencies** (lockfile-keyed) | often the largest single win |
| cache build artefacts and test results | huge on a monorepo |
| **only build/test what changed** | Nx, Turborepo, `--changedSince` |
| parallelise independent jobs | lint ‖ types ‖ unit ‖ build |
| shard slow suites across machines | linear |
| run e2e post-merge, smoke on PR | keeps the PR loop short |
| **fail fast** — cheapest checks first | lint before e2e, always |

**Cache correctly or not at all.** A cache keyed on something too coarse produces stale results and
mysterious failures that cost more than the cache saves; key on the lockfile hash and the tool
version.

## Dependencies as a tooling decision

Every dependency is a build-time cost, a security surface
([security-and-auth lab 05](../../../security-and-auth/labs/05-supply-chain/)) and a future upgrade.

| Ask | Before adding |
|---|---|
| what does this replace, in lines? | |
| how many transitive packages does it add? | run `npm ls --all \| wc -l` before and after |
| is it maintained, and by how many people? | |
| **what does it cost the bundle?** | check with a bundle analyser, not the README |
| can we delete it in a year? | |

The recurring wins: `Intl` instead of a date library with locale files
([i18n lab 01](../../../i18n/labs/01-formatting/)), `fetch` instead of an HTTP client, platform APIs
instead of polyfilled abstractions, and CSS instead of a JS animation library for anything
declarative.

## Monorepo or not

| | Monorepo | Polyrepo |
|---|---|---|
| atomic cross-project changes | ✅ | ❌ |
| shared tooling and standards | ✅ | costly to keep aligned |
| **tooling investment required** | **high** — task graph, caching, ownership | low |
| CI cost | needs affected-only builds or it explodes | naturally scoped |
| independent release cadence | needs work | ✅ |

**The deciding question is whether changes routinely span projects.** If a typical feature touches
the design system, the app and the API client together, a monorepo pays for itself. If teams ship
independently on their own schedules, it's overhead — and a monorepo without affected-only builds and
remote caching is strictly worse than what you had.

## Think about

- Your dev server takes 40 seconds to start. Where's the time?
- Is a faster bundler worth a migration?
- Why run type-checking separately from the build?

<details>
<summary>Answers</summary>

**40-second startup.** Almost certainly bundling the whole app before serving anything, plus a
JS-based transpiler and a cold cache. Profile it rather than guessing (most tools have a
`--profile`), but the usual order of causes is: no dependency pre-bundling/caching, a slow transform
chain (Babel with many plugins), source-map generation in dev, and type-checking in the critical
path. Moving to on-demand ESM serving addresses the first and biggest.

**Faster bundler, worth a migration?** Compute it: (seconds saved per cycle) × (cycles per day) ×
(developers), against the migration cost *plus* the ongoing cost of an ecosystem gap — a plugin you
depended on that doesn't exist yet. Usually worth it when the inner loop is over a couple of seconds,
rarely worth it purely to make CI faster (caching and affected-only builds are cheaper wins there).

**Type-checking separately.** Modern transformers strip types without understanding them, which is
what makes them fast — so type-checking is a separate pass that can run *in parallel* with the build
and tests rather than blocking them. It also means a type error doesn't stop you seeing the app in the
browser, which is usually what you want mid-refactor.
</details>

---

## 🏗️ Build challenge

1. Measure your three loops. Write the numbers down.
2. Profile dev server startup and HMR. Fix the biggest contributor.
3. Add dependency and build caching to CI, keyed on the lockfile.
4. Parallelise lint/types/test/build and order them cheapest-first.
5. Move e2e to post-merge with a smoke subset on PRs.
6. Run a bundle analysis and delete the three largest dependencies you can replace with platform APIs.
7. Add a size gate ([bundle-strategy lab 05](../../../bundle-strategy/labs/05-analyse-and-budget/)).

**Done when:** HMR is under a second and PR feedback is under ten minutes.

---

## Interview questions

1. Why is a dev server that doesn't bundle faster, and where does it stop being an advantage?
2. What makes CI slow, and what's the highest-leverage fix?
3. Why run type-checking in parallel with the build?
4. What do you ask before adding a dependency?
5. When is a monorepo the wrong choice?
