# Lab 06 — Testing & architecture ⭐⭐⭐⭐⭐

**Goal:** stop accessibility from decaying, without a permanent cleanup project.

**Primary metric:** new violations per PR — not total violations.

> <http://localhost:8080/accessibility/labs/06-testing-and-architecture/>

---

## The number that reframes everything

**Automated tools reliably detect 30–40% of real accessibility issues.**

That's not a criticism of the tools — it's a statement about what's machine-checkable. Run the audit
against lab 01's div-soup page: it produces **few findings**. Nothing is technically invalid — no
missing alt, no unlabelled inputs, no duplicate ids — and the page is unusable with a keyboard.

> **A clean axe report is not an accessible page.** It means you haven't made the mistakes a machine
> can name.

| Tools find | Tools miss |
|---|---|
| missing `alt` | whether the alt text is *useful* |
| contrast below 4.5:1 | text in an image; gradient backgrounds |
| unlabelled fields | a label that says the wrong thing |
| invalid ARIA | ARIA that is valid and wrong |
| `aria-hidden` on focusable content | a focus trap, or focus lost on route change |
| missing landmarks | whether the keyboard can complete the task |
| positive tabindex | whether tab order matches visual order |

Every entry on the right is a judgement.

## The three habits that cover the rest

1. **The keyboard pass.** Unplug the mouse and complete the primary task. Highest yield per minute
   of any accessibility activity, and needs no training. **Do this today.**
2. **The screen reader pass.** Fifteen minutes on your main flow. You'll be bad at it at first and
   still find things immediately.
3. **Testing with disabled users.** Nothing else tells you whether the experience is *good* rather
   than merely conformant.

## The pipeline

| Stage | Tool | Catches |
|---|---|---|
| editor | `eslint-plugin-jsx-a11y`, axe DevTools | the obvious, pre-commit |
| component | `jest-axe` / `vitest-axe` | per-component regressions |
| component tests | **Testing Library queries by role** | accidental semantic changes |
| e2e | `@axe-core/playwright` **mid-flow** | state-dependent issues |
| CI gate | fail on **new** violations, with a baseline | regression, without a big-bang cleanup |
| manual | keyboard + screen reader per release | the other 60% |
| audit | external expert, annually | what your team stopped seeing |

**Testing Library queried by role is a secret accessibility test.** `getByRole('button', {name:
'Save'})` fails the moment someone swaps the button for a div or drops its name. You get semantic
regression coverage from tests you were writing anyway — which is why "query by role, never by test
id" is worth enforcing.

**Run axe mid-flow, not just on load.** Most scans see the initial page and never your modal, error
state, expanded menu or loaded results — where the interesting bugs live.

**The CI policy that works:** baseline the existing violations, fail on new ones. A gate that fails
on 400 pre-existing issues gets disabled in a week; a gate that fails only on what this PR added is
one nobody argues with, and the baseline shrinks over time.

## Making it structural

| Decision | Effect |
|---|---|
| **accessible primitives in the design system** | the accessible path is the *default* path |
| no raw `<div onClick>` — a lint rule | removes the biggest category at source |
| queries by role in every test | semantics become load-bearing, so they can't rot silently |
| contrast tokens, not ad-hoc colours | contrast checked once, in the palette |
| focus management owned by the router and modal primitive | nobody has to remember |
| a11y acceptance criteria in the ticket | scoped work, not a favour at the end |
| someone accountable | the difference between a policy and an aspiration |

**The one that matters most: put accessibility in the design system, not the feature code.** If
`<Button>`, `<Modal>`, `<Tabs>`, `<Combobox>` and `<Field>` are correct *once*, a feature team gets
accessibility without knowing any of this. If they're not, every team re-derives it, badly, forever.

That reframes the problem: accessibility isn't a per-feature tax, it's a **platform property** — and
platform properties are cheap when centralised and ruinous when not. See
[architecture-and-state lab 06](../../../architecture-and-state/labs/06-design-system/); the
accessibility argument is the strongest case for a design system and usually the least-mentioned.

## The commercial framing

The **European Accessibility Act** applies from June 2025 to a wide range of consumer digital
services; US ADA web litigation runs to thousands of cases a year; public-sector procurement in most
of Europe and North America requires a conformance statement (VPAT/ACR). "We'll do it later" is a
decision with a price attached.

## Think about

- Your axe score is 100. Are you accessible?
- Where do you start on a large inaccessible app?
- How do you stop it regressing?

<details>
<summary>Answers</summary>

**Axe 100.** No — you've passed the machine-checkable third. Do the keyboard pass and you'll find
out in five minutes. The score is a floor, and a useful one; treating it as the goal is the single
most common way teams convince themselves they're done.

**Where to start on a large app.** Not with the violation list. Start with the **primary user
journey**, keyboard-only, end to end — that tells you what's *blocking*, as opposed to what's merely
reported. Then fix in this order: things that make a task impossible (keyboard traps, unreachable
controls, unlabelled fields in the flow), then things that make it hard (focus, announcements,
contrast), then the long tail. Meanwhile put the primitives in the design system so new code stops
adding to the pile.

**Stopping regression.** Three things, in order of effectiveness: accessible primitives so the easy
path is correct; role-based queries in tests so semantics are load-bearing; and a CI gate on *new*
violations only. Add manual keyboard checks to your release checklist, and give someone explicit
ownership — anything that's everyone's responsibility is nobody's.
</details>

---

## 🏗️ Build challenge

1. Add `eslint-plugin-jsx-a11y` in error mode with a baseline.
2. Add `jest-axe` to your design-system component tests. Every primitive gets one.
3. Add `@axe-core/playwright` to two e2e flows, scanning **after each state transition**.
4. Convert your test suite to role-based queries. Delete the test ids you can.
5. Write the keyboard + screen reader release checklist. Do it once yourself and time it.
6. Pick the five most-used components and make them correct in the design system.

**Done when:** a PR that replaces a `<button>` with a `<div>` fails CI, and your keyboard checklist
takes under 15 minutes.

---

## Interview questions

1. What percentage of issues do automated tools find, and why is that the ceiling?
2. Why does a div-soup page pass an automated audit?
3. How does querying by role give you accessibility coverage?
4. How do you introduce a CI gate to an app with hundreds of existing violations?
5. Why is a design system the highest-leverage accessibility investment?
