# Lab 01 — Testing strategy ⭐⭐⭐⭐⭐

**Goal:** decide what to test and at which level, from first principles rather than from a pyramid
diagram.

**No page for this one** — it's a decision exercise. Do it against your own codebase.

---

## The two questions per test

1. **What breaks if this is wrong?**
2. **What's the cheapest test that would catch it?**

Everything else — pyramid, trophy, honeycomb — is a summary of what those two questions produce for a
typical codebase.

## The levels

| Level | Catches | Cost | Fragility |
|---|---|---|---|
| **static** (types, lint) | typos, wrong shapes, banned patterns | ~0 | none |
| **unit** | logic errors in pure functions | very low | low |
| **component** | rendering, interaction, wiring | low | low **if queried by role** |
| **integration** | several units + a mocked network | medium | medium |
| **e2e** | the whole thing, in a real browser | **high** | high |
| **visual** | unintended visual change | medium | high without control of variance |
| **manual/exploratory** | everything nobody thought of | high | — |

## Why the shape is a trophy, not a pyramid, on the front end

The classic pyramid (many unit, few e2e) comes from a world where most complexity lived in business
logic. On a front end, **most bugs are in the wiring**: a prop passed wrong, a state update that
doesn't happen, a component that renders the empty state when data exists.

Unit tests of pure functions don't catch those. Component tests do, and they're nearly as cheap. So
the shape is:

```
        ▲ a few e2e (the critical journeys, and only those)
       ███ lots of component tests
      █████ a base of static analysis
        ▪ unit tests where there is real logic
```

**Static analysis is the most underrated level.** TypeScript catches an entire category of bug for
zero marginal cost per test, and a lint rule is the cheapest possible way to prevent a *class* of
mistake forever — `no-static-element-interactions`, `no-floating-promises`, a rule banning direct
`fetch` outside your client. Every recurring review comment should become a lint rule or stop being
made.

## What to test at each level

| Test this | Here | Not here |
|---|---|---|
| a date formatter, a reducer, a parser | unit | e2e |
| "clicking Save calls onSave with the form values" | component | e2e |
| "the error state renders when the request fails" | component (mocked network) | e2e |
| "a user can complete checkout" | **e2e, once** | component |
| "the API contract hasn't changed" | contract test / typed client | e2e |
| "the layout didn't shift" | visual regression | e2e assertion |
| "it's accessible" | component (`jest-axe`) + e2e mid-flow | manual only |

**The rule for e2e: one test per critical user journey, and no more.** E2E tests are slow, flaky, and
expensive to maintain, and their unique value is proving the pieces are *connected*. Use them for
"can a user sign up, buy the thing, and get a receipt" — not for "the validation message says the
right words".

## What not to test

- **implementation details** — internal state, private methods, "was this function called". These
  break on refactor while the behaviour is unchanged, which trains people to delete tests.
- **the framework** — React re-renders when state changes; you don't need a test for that.
- **third-party libraries** — test *your* usage of them, at the boundary.
- **generated code and pure config** — unless a mistake there is silent and expensive.
- **everything, to hit a coverage number.** Coverage measures which lines ran, not whether anything
  was asserted. 100% coverage with no assertions is achievable and worthless.

Use coverage to **find untested areas**, never as a gate on a number. The one exception worth
enforcing: coverage on *changed lines* in a PR, which is a much better signal than a global
percentage.

## Think about

- Your team has 4,000 unit tests and bugs keep reaching production. What's likely wrong?
- When is an e2e test worth its maintenance cost?
- Should you test a component's internal state?

<details>
<summary>Answers</summary>

**4,000 unit tests, bugs in production.** The tests are almost certainly at the wrong *level*: they
verify functions in isolation while the bugs are in wiring, integration and state. Look at your last
20 production bugs and ask, for each, which test would have caught it. Usually the answer is a
component or integration test that doesn't exist — and often the same 4,000 tests are also making
refactoring expensive, because many assert implementation details.

**When e2e is worth it.** When the test covers a journey where failure is unacceptable *and* which
spans systems no other test level connects — checkout, sign-up, payment, publishing. The maintenance
cost is real (flakes, fixtures, environments), so the bar is "this journey failing silently would be a
serious incident". Ten such tests is a healthy suite; two hundred is a second product nobody
resourced.

**Internal state.** No — assert what the user can observe. A test that reads `state.isOpen` breaks
when you switch to a reducer or a context, even though nothing the user sees has changed. Assert that
the panel is visible (`getByRole`), and the test survives every refactor that preserves behaviour,
which is exactly the property you want.
</details>

---

## 🏗️ Build challenge

1. Take your last 20 production bugs. For each, write down the cheapest test that would have caught
   it. The histogram of levels is your strategy — not a diagram from a blog post.
2. Find your ten flakiest tests. Fix or delete them; a flaky test is worse than no test because it
   trains people to re-run CI.
3. Convert three implementation-detail tests to behavioural ones and confirm they survive a refactor.
4. Turn your three most common review comments into lint rules.
5. Count your e2e tests. If it's over ~20, ask which journeys are genuinely critical.
6. Switch coverage reporting to changed-lines-in-PR.

**Done when:** you can say, for each level, what it's for and what it's not for — and point at the
data.

---

## Interview questions

1. Why is the front-end testing shape a trophy rather than a pyramid?
2. What's an implementation-detail test and why is it harmful?
3. When do you write an e2e test?
4. What's wrong with coverage as a gate?
5. Why is static analysis the cheapest level?
