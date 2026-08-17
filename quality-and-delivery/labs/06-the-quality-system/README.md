# Lab 06 — The quality system ⭐⭐⭐⭐⭐

**Goal:** make quality a property of the system rather than of whoever is paying attention.

---

## Why individual discipline doesn't scale

Every practice in this repo works when one careful person applies it. None survives a team of thirty,
a deadline, and a new joiner who has never heard of it — unless it's **structural**.

| Relies on | Survives? |
|---|---|
| "remember to add a label" | ❌ |
| a lint rule that fails the build | ✅ |
| "remember to check the bundle size" | ❌ |
| a size gate in CI | ✅ |
| "remember to handle the error state" | ❌ |
| a data-fetching primitive that requires one | ✅ |
| "remember to make it accessible" | ❌ |
| an accessible `<Button>` in the design system | ✅ |

**The pattern: move the decision from the person to the platform.** In order of strength:

1. **make the wrong thing impossible** — types, a design system, an API that can't express the bug
2. **make it fail automatically** — lint, CI gates, tests
3. **make it visible** — dashboards, PR comments, budgets
4. **write it down** — docs, checklists, conventions
5. **remind people** — code review comments, Slack

Most teams live at 4–5 and wonder why standards drift. **Every recurring review comment is a lint rule
waiting to be written.**

## The gates worth having

| Gate | Blocks | Source |
|---|---|---|
| types + lint | merge | |
| unit + component tests | merge | [lab 01](../01-testing-strategy/) |
| bundle size budget | merge | [bundle-strategy lab 05](../../../bundle-strategy/labs/05-analyse-and-budget/) |
| Lighthouse CI on key routes | warn, ratchet | [web-vitals lab 06](../../../web-vitals-and-react-perf/labs/06-profiling-and-budgets/) |
| new a11y violations only | merge | [accessibility lab 06](../../../accessibility/labs/06-testing-and-architecture/) |
| e2e smoke | merge | |
| full e2e | post-merge | |
| flag expiry | warn, then fail | [lab 05](../05-release-safety/) |

**Two rules that decide whether gates work:**

**Baseline and ratchet.** A gate that fails on 400 pre-existing issues gets disabled in a week. Fail
only on what this PR *added*; the baseline shrinks over time and nobody argues.

**A gate must be fast and unambiguous.** If it takes ten minutes or produces a report someone must
interpret, it becomes a rubber stamp. The output should say *what* broke and *where*, in one line.

## Ownership

| Anti-pattern | Why it fails |
|---|---|
| "everyone owns quality" | nobody does |
| a QA team that owns quality | the people writing the bugs have no feedback loop |
| a "performance champion" with no time allocated | goodwill isn't a mechanism |

What works: **the team that ships a thing owns its quality**, with explicit budgets they're
accountable for, plus a small platform group that owns *the tools that make it easy* — the design
system, the CI gates, the observability plumbing, the release machinery.

And **someone must own each number**. An unowned dashboard is decoration.

## The rituals that pay

| Ritual | Cadence | Value |
|---|---|---|
| **blameless post-incident review** | per incident | the single highest-value ritual — every incident is a free lesson |
| a bug-and-flake triage rotation | weekly | stops the backlog becoming a graveyard |
| a budget review | monthly | catches slow drift before it's a project |
| a dependency-update batch | weekly, automated | avoids the "never patch" failure mode |
| an accessibility/keyboard pass | per release | catches the 60% tools miss |
| a game day | quarterly | [resilience lab 05](../../../resilience/labs/05-chaos/) |

**Post-incident review is where the system actually improves**, and only if it's blameless. The
question is never "who broke it" but "what let this reach production, and what would have caught it
earlier?" — and every review should produce at least one change at level 1–3 above, not a reminder to
be careful.

## Measuring the system, not the output

| Metric | Tells you |
|---|---|
| **change lead time** | how long from commit to production |
| **deploy frequency** | how small changes are |
| **change failure rate** | how often a release causes a problem |
| **MTTR** | how fast you recover |
| PR feedback time | whether the inner loop works |
| flake rate | whether the suite is trusted |
| p75 CWV per route | whether users feel it |
| crash-free sessions | whether it works at all |

The first four are the DORA metrics, and they're useful because they're **hard to game in a harmful
direction**: you can't improve MTTR without genuinely better observability and rollback, and you can't
raise deploy frequency safely without smaller changes and better gates.

**Don't measure things that reward the wrong behaviour**: lines of code, test count, coverage
percentage, story points, bugs closed.

## The honest scoping

You cannot do all of this at once, and a team that tries produces a compliance exercise. The order
that works:

1. **observability first.** You can't improve what you can't see, and it's the cheapest to add.
2. **fast rollback and a kill switch.** Now mistakes are survivable, which makes everything else less
   frightening.
3. **the gates on things you've actually broken.** Not a generic checklist — your incidents tell you
   which gates you need.
4. **the design system**, so the easy path is correct.
5. **everything else**, driven by post-incident reviews.

## Think about

- Your team keeps shipping accessibility regressions despite training. What now?
- Which quality metric would you put on a dashboard for the whole company?
- When is a process step worth its cost?

<details>
<summary>Answers</summary>

**Recurring a11y regressions despite training.** Training is level 5 — the weakest intervention.
Move it down the stack: accessible primitives in the design system so the default is correct (level
1), role-based queries in tests and a CI gate on new violations (level 2), and a per-release keyboard
pass with a named owner (level 3). If regressions still happen, look at *where* they come from —
usually a surface outside the design system, like a marketing page or a third-party embed, which
needs its own answer.

**One company-wide metric.** Crash-free session rate, or checkout/primary-task success rate — a
user-outcome number, not an engineering one. It's understandable outside engineering, it moves for
real reasons, and it can't be gamed by shipping less. Engineering-internal metrics (MTTR, lead time)
belong on the team's dashboard, where the people who can act on them will see them.

**When a process step is worth it.** When it shortens time-to-detect or time-to-recover, or prevents a
class of failure you've actually experienced — and when it's cheap enough that people don't route
around it. A step that adds an hour to every release to catch a bug that happened once is a net loss;
a lint rule that catches it forever, for free, is a win. Review your process steps the way you'd
review dependencies: what does this replace, and what does it cost every time?
</details>

---

## 🏗️ Build challenge

1. List your last ten incidents. For each, identify the strongest level (1–5) intervention that would
   have prevented it. Implement the top three.
2. Turn your three most repeated review comments into lint rules.
3. Add baseline-and-ratchet gates for size, a11y and performance.
4. Assign an owner to every dashboard and every alert. Delete the unowned ones.
5. Start blameless post-incident reviews with a required output: one systemic change.
6. Measure the four DORA metrics for a month before changing anything.

**Done when:** a new joiner can ship safely on day two without knowing any of this — because the
system enforces it.

---

## Interview questions

1. Why doesn't individual discipline scale, and what replaces it?
2. What makes a CI gate survive contact with a deadline?
3. Who should own quality?
4. What are the DORA metrics and why are they hard to game harmfully?
5. What's the right order to build a quality system in, and why observability first?
