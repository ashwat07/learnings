# Lab 17 — Style recalculation ⭐⭐⭐⭐

**Goal:** reason about the pipeline's *first* stage. Every other lab attacks Layout, Paint, or
Composite; this one is about the purple `Recalculate Style` bar, invalidation scope, and why the
folklore about "slow selectors" is mostly wrong.

**Primary metric:** `Recalculate Style` duration and **elements affected** per change.

---

## The concept

Style recalculation answers "what computed values apply to each element?" Its cost is:

```
cost ≈ (number of elements invalidated) × (candidate rules per element)
```

Almost always, the first factor dominates. That's the thing to internalise, because the industry
spent a decade optimising the second one.

### Invalidation, not matching

Browsers don't restyle the document when you change a class. They maintain **invalidation sets**: for
each rule, which changes could possibly affect which elements. Change `.active` on a leaf and the
engine restyles that leaf and — if any rule uses `.active` as an ancestor or sibling condition — the
elements those rules could reach.

So what widens the blast radius:

| Change | Elements invalidated |
|---|---|
| inline style on a leaf | 1 |
| class on a leaf, no descendant rules use it | 1 |
| class on a leaf, `.leaf .child` rules exist | that subtree |
| class on a leaf, `.leaf ~ .sibling` rules exist | following siblings |
| class on a leaf, `:has(.leaf)` rules exist | **ancestors** — invalidation travels *up* |
| class on `<html>`/`<body>` | potentially everything |
| custom property on `:root` | every descendant that reads it (they inherit) |
| custom property on the element that uses it | that element (and its inheritors) |

### Selector complexity: the nuance

Selectors are matched **right-to-left**, starting from the rightmost compound (the "key selector"),
so `body div.card span` is not "walk the whole document" — it's "for each `span`, walk up looking for
`div.card`, then `body`", and it bails early. Engines also bucket rules by the key selector's
id/class/tag, so an element only ever considers a handful of candidate rules.

Which means: **selector micro-optimisation is usually noise, and invalidation scope is usually the
whole story.** The exceptions worth knowing:

- Enormous stylesheets — tens of thousands of rules — raise the per-element constant, and every
  invalidated element pays it.
- `:has()` inverts the direction: a change on a descendant can invalidate ancestors, and engines are
  more conservative here. On a high-frequency toggle it's genuinely dangerous.
- Universal and attribute-substring selectors (`*`, `[class*="x"]`) can't be bucketed as cheaply.
- `:nth-child` and sibling combinators mean inserting one element can restyle its siblings —
  the classic O(n²) list-render bug.

### Where to look

`Recalculate Style` in the Performance panel tells you the duration, and hovering it gives you
**"Elements Affected"** — the number that matters. For the per-selector view, enable **CSS selector
stats** in the Performance panel's settings before recording: you get match attempts, match count,
and elapsed time per selector, which is how you settle an argument about a specific rule with data.

## Break it

`index.html` builds a deep tree of ~5,000 elements plus a large generated stylesheet, and gives you
seven changes to trigger:

1. **`inlineLeaf`** — inline style on one leaf. The cheap baseline.
2. **`classLeaf`** — a class on one leaf, with no rules that reach outward.
3. **`classRoot`** — a class on `<html>`. The theme-toggle pattern.
4. **`varRoot`** — a custom property on `:root`, read by thousands of descendants.
5. **`varLeaf`** — the same custom property, set on the element that actually needs it.
6. **`hasSelector`** — a change that a `:has()` rule observes, so invalidation travels upward.
7. **`siblingCombinator`** — a change picked up by `~` rules, restyling following siblings.

Plus a stylesheet-size control, so you can separate "how many elements" from "how many rules".

## Measure it

1. CPU 4× throttle. Enable **CSS selector stats** (Performance panel → gear → "Enable CSS selector
   stats (slow)") — note the warning, it does add overhead, so use it for attribution and not for
   absolute timings.
2. Record while triggering each change 20× (the page has a repeat control).
3. For each: `Recalculate Style` total, and **Elements Affected** from the tooltip.
4. Then re-run everything with the stylesheet at 500 rules and at 40,000 rules. Two variables, one at
   a time.

| Change | Elements affected | Style recalc (ms) | @ 40k rules | Layout followed? |
|---|---|---|---|---|
| 1 inline leaf | | | | |
| 2 class on leaf | | | | |
| 3 class on `<html>` | | | | |
| 4 custom prop on `:root` | | | | |
| 5 custom prop on leaf | | | | |
| 6 `:has()` observed | | | | |
| 7 `~` observed | | | | |

That last column matters: a style change that alters a geometric property also costs Layout, so make
sure you're attributing the cost to the right stage. Two of these seven changes are style-only; find
out which.

## Why is it slow?

1. Compare 4 and 5 — same property, same value, wildly different cost. Explain in terms of
   inheritance.
2. In 6, the change is on a *descendant* and the invalidation goes *up*. Why does `:has()` force the
   engine to be conservative?
3. In 7, you changed one element and N siblings restyled. What rule shape caused that, and what's the
   corresponding real-world bug? (Hint: think about `:nth-child` striping in a list you append to.)
4. Compare 2 at 500 rules vs 40,000 rules. Did the *cost per element* change, and by how much? Is
   rule count worth optimising relative to element count?
5. Change 3 is the theme toggle. It's expensive. Is it a *problem*? Answer with a distinction between
   one-off and per-frame costs.

## Fix it yourself

- [ ] **Scope the theme toggle.** Make change 3 cheap — options: put the class on the smallest
      subtree that needs it, use `color-scheme` + system colours where possible, or accept one
      expensive restyle but guarantee it never happens during an animation. Measure each, and be
      honest about which is a real fix versus a deferral.
- [ ] **Fix the custom-property scope.** Take change 4 and get its cost down to change 5's without
      changing what the user sees. This usually means setting the variable on the subtree that reads
      it rather than on `:root`. Measure elements affected before and after.
- [ ] **Replace the `:has()` on the hot path.** Change 6 uses `:has()` for a real effect (a parent
      that styles itself when a child is selected). Implement it without `:has()` — a class toggled on
      the parent by JS — and compare. Then argue the other side: when is `:has()` clearly worth it?
      (It is, often. The point is to know the cost, not to ban it.)
- [ ] **Kill the sibling invalidation.** Fix change 7 so appending an element doesn't restyle its
      siblings. Then measure appending 1,000 items with and without `:nth-child` striping in the
      stylesheet — this is a real O(n²) that ships constantly.
- [ ] **`contain: style`.** Apply it and re-measure changes 3, 6, and 7. Document exactly what it
      contained (counters and quotes — read the spec, it's narrower than people assume) and whether
      it helped here.
- [ ] **Cut the stylesheet.** Split the 40,000-rule sheet so only ~2,000 rules are live, and re-run
      every measurement. Compare the win against the invalidation-scope wins you already got. Rank
      them, and write down which you'd do first on a real project and why.
- [ ] **Settle a selector argument with data.** Pick a selector you suspect is slow. Use selector
      stats to get its match attempts and elapsed time. Then rewrite it and prove the difference — or
      prove there isn't one, which is the more likely and more useful outcome.

<details>
<summary>Hint — right-to-left matching</summary>

`nav > ul li a.link` is evaluated starting at `a.link`. For each candidate `a.link` the engine walks
ancestors and bails as soon as the chain fails. So "deep selectors are slow" is mostly a myth from
the pre-invalidation-set era. What's actually expensive is a selector that makes *invalidation*
imprecise, forcing the engine to restyle elements it can't prove are unaffected.
</details>

<details>
<summary>Hint — why custom properties are different</summary>

Custom properties are inherited, so setting one on an ancestor changes the computed value of every
descendant that references it — each of those elements needs its computed style recomputed. There's
no way to be lazy about it: the value is part of their computed style. Registering a property with
`@property` and a non-inherited descriptor changes this, which is worth an experiment of its own.
</details>

---

## 🏗️ Build challenge: a CSS invalidation profiler

You can measure Layout and Paint from JS. You cannot measure style invalidation — there's no API for
"how many elements did that restyle". So build the closest honest approximation and learn where it
breaks down.

**Part 1 — the measurement.** Given a mutation function, report the style cost:
1. Run the mutation many times with layout forced afterwards, and time it — the naive approach. Then
   explain, in writing, why that number includes things you didn't want and excludes things you did.
2. Do it properly with CDP: `Performance.enable`/trace events, or drive a trace via Playwright and
   parse the `UpdateLayoutTree` events, which carry an element count. Compare your JS-side
   approximation against the trace's ground truth and report the error.
3. Emit per-mutation: elements affected, duration, and whether layout followed.

**Part 2 — the linter.** Static analysis over a stylesheet:
1. Flag rules whose key selector is `*` or an attribute-substring match.
2. Flag `:has()` rules and report which mutations would trigger upward invalidation.
3. Flag sibling combinators and `:nth-*` in rules that apply to list items — the O(n²) shape.
4. Report custom properties declared on `:root` that are read by more than N elements, with the
   count from a real page render.
5. Report the rule count and the per-element candidate-rule estimate.

**Part 3 — the finding.** Run both against a real stylesheet — a design system, Tailwind output, or a
large app's CSS. Report the top three invalidation hazards with measurements, fix one, and — this is
the important half — report at least one thing your linter flagged that turned out **not** to matter.
A tool that only produces true positives has never been run on real code.

**Done when:** your JS approximation is within a stated error margin of the trace ground truth, the
linter finds a real hazard in real CSS, and you can point at one flagged rule and say "this one is
fine, and here's the measurement that says so".

---

## Interview questions

1. What does style recalculation compute, and what drives its cost?
2. Are deep descendant selectors slow? Give the real answer.
3. Why is setting a custom property on `:root` expensive?
4. How does `:has()` change invalidation, and when would you avoid it?
5. Appending one row to a list restyles the whole list. What's in the stylesheet?
6. Our theme toggle causes a 300ms hitch. Walk me through the diagnosis and the options.
7. Does `contain: style` help with style recalculation? (Careful.)
8. When would you spend time reducing stylesheet size versus reducing invalidation scope?
