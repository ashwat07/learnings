# Lab 02 — Testing in practice ⭐⭐⭐⭐⭐

**Goal:** write tests that survive refactoring and fail for real reasons.

**Run this against your own suite.**

---

## Query by role, always

```js
// survives every refactor that preserves behaviour, and fails if accessibility breaks
await screen.getByRole('button', { name: 'Save' }).click();

// breaks on a class rename; passes on an inaccessible button
container.querySelector('.btn-save').click();
```

**This is the single highest-leverage testing habit on the front end**, for two reasons: it asserts
what a *user* (including one with a screen reader) can perceive, and it gives you accessibility
regression coverage from tests you were writing anyway. A `<button>` swapped for a `<div>` fails the
test. See [accessibility lab 06](../../../accessibility/labs/06-testing-and-architecture/).

Priority order: role → label → placeholder → text → **test id last**, and only for things with no
accessible identity at all.

## Mock at the boundary, not in the middle

| Mock | Verdict |
|---|---|
| **the network** (MSW, or `fetch` at the edge) | ✅ realistic, one place, reusable across levels |
| a module your component imports | ⚠️ couples the test to your file layout |
| a function inside the module under test | ❌ you're testing the mock |

**MSW is the right default** because it intercepts at the network layer: the same handlers work in
unit tests, component tests, Storybook and local development, and your code under test is completely
unmodified — no injected client, no dependency-injection ceremony.

And **type your mocks against the real contract**, or your tests will pass against a shape your API
stopped returning last quarter.

## Flakiness is a bug, not weather

| Cause | Fix |
|---|---|
| **arbitrary waits** (`sleep(500)`) | wait for a *condition* — `findBy*`, `waitFor`, `expect(...).toBeVisible()` |
| shared state between tests | reset the database/store per test; never depend on order |
| **test order dependence** | randomise the order in CI and fix what breaks |
| time and randomness | inject a clock and a seed; fake timers |
| animations | disable them in the test environment |
| network variance | mock it |
| **the real cause: a race in the app** | the flake is telling you something true — investigate before you retry |

**A retried flaky test is a bug you decided not to look at.** Quarantine flakes out of the blocking
suite, but track them and fix them — a suite people don't trust is a suite people ignore.

## Visual regression

Genuinely valuable and genuinely high-maintenance. It's the only practical way to catch "the layout
broke on this one breakpoint", and it fails on anything that varies.

Control the variance or it will control you: pin fonts (and *wait for them to load*), freeze time and
animation, seed data, pin the browser version, and run in a container so rendering matches CI.
Otherwise you get a review culture of "approve all" — which is worse than no snapshots, because it
launders real changes.

Scope it to **components and a handful of key pages**, not every page at every breakpoint.

## What makes a test suite fast

| Lever | Effect |
|---|---|
| parallelism | usually the biggest single win |
| **only run tests affected by the change** | huge on a large repo (Nx, Turborepo, Jest `--changedSince`) |
| shard e2e across machines | linear |
| reuse an authenticated session instead of logging in per test | often 30–50% of an e2e suite |
| no arbitrary sleeps | see above |
| a fast dev server / native-speed transform | Vite, esbuild, SWC |

**A suite over ten minutes stops being run before pushing**, which means it stops being a feedback
loop and becomes a gate people work around. Optimise for the loop, not the total.

## Think about

- Your e2e suite takes 40 minutes and everyone ignores it. What first?
- When is a snapshot test useful?
- How do you test something that depends on time?

<details>
<summary>Answers</summary>

**40-minute e2e suite.** First, cut it: most such suites contain many tests that should be component
tests. Keep the genuinely critical journeys and move the rest down a level — that's usually a 5–10×
reduction on its own. Then shard across machines, reuse an authenticated storage state instead of
logging in per test, and run the full suite post-merge with a fast smoke subset on PRs. The goal is a
suite whose result arrives while the author is still thinking about the change.

**Snapshot tests.** Useful for small, stable, meaningful output — a formatted string, a serialised
config, a component's rendered *text*. Harmful for large DOM trees, where nobody reads the diff and
every legitimate change produces a hundred-line update that gets approved unread. Rule of thumb: if
you wouldn't read the whole snapshot in review, don't snapshot it.

**Time-dependent code.** Inject the clock rather than calling `Date.now()` directly, so tests can
supply a fixed value — and use fake timers for anything involving `setTimeout`/`setInterval` so you
can advance time instantly instead of waiting. The same discipline pays in production, because it's
what lets you test relative-time formatting, expiry, backoff and scheduling deterministically.
</details>

---

## 🏗️ Build challenge

1. Convert one test file to role-based queries. Delete the test ids you can.
2. Introduce MSW and share handlers between component tests, e2e, and local dev.
3. Randomise test order in CI. Fix the failures — they were real.
4. Find every `sleep`/arbitrary wait and replace with a condition.
5. Reuse an authenticated session across e2e tests; measure the time saved.
6. Add visual regression to your five most-used components, with fonts and time pinned.
7. Measure your PR feedback time end to end. Set a target and defend it.

**Done when:** the suite is green three times in a row on a random order, and PR feedback arrives in
under ten minutes.

---

## Interview questions

1. Why query by role?
2. Where should you mock, and why the network specifically?
3. Name four causes of flaky tests.
4. When is a snapshot test a liability?
5. How do you make a big e2e suite fast?
