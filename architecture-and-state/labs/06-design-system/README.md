# Lab 06 — Design system, tokens, theming, component APIs ⭐⭐⭐⭐

**Goal:** build primitives that survive three years of design changes, and ship theming that costs
nothing at runtime.

**Primary metric:** props per component (fewer is better), and theme-switch cost in ms.

---

## Tokens: the layer people skip

Three levels, and skipping the middle one is why design systems calcify:

```css
/* 1. primitives — the raw palette. No component ever uses these directly. */
--blue-500: #3d5bbf;
--space-3: 12px;

/* 2. semantic — what it MEANS. Components use these. */
--color-action: var(--blue-500);
--color-danger: var(--red-500);
--space-inline: var(--space-3);

/* 3. component — optional, for genuine one-offs */
--button-bg: var(--color-action);
```

Why the middle layer matters: when the brand colour changes, you edit one primitive. When "danger"
moves from red to orange, you edit one semantic token. When a component uses `--red-500` directly,
you edit every component — and you can't theme it, because a dark theme changes *meanings*, not
*hues*.

## Theming that costs nothing

```css
:root { --bg: #fff; --text: #111; }
:root[data-theme="dark"] { --bg: #0d0d12; --text: #e9e9f2; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --bg: #0d0d12; --text: #e9e9f2; }
}
```

Three states, not two: explicit light, explicit dark, and **system** (no attribute — only the media
query decides). Most implementations handle two and get the system case wrong.

Switching themes is then one attribute write, and the browser recomputes styles — no re-render, no
JS per component, no context propagation. Compare with a JS-in-JS theme object passed through
Context: every consumer re-renders on toggle (lab 02).

**The flash.** The server doesn't know the user's theme, so it renders the default and the client
corrects it — a flash of the wrong theme *and* a hydration mismatch
([hydration-strategies lab 05](../../../hydration-strategies/labs/05-mismatches/)). Fixes, in order:
store the preference in a **cookie** the server reads (no flash, no mismatch); or a tiny blocking
inline script in `<head>` that sets the attribute before first paint.

## Component APIs that survive

| Smell | What it means | Fix |
|---|---|---|
| 14 boolean props | four use cases in one component | composition (lab 01) |
| `variant="primary-large-icon-only"` | combinatorial explosion of a string | orthogonal props, or slots |
| `style` / `className` passed through everywhere | the API doesn't cover a real need | find the need, add a slot or a token |
| A prop named `isSpecialCaseForCheckout` | a caller leaked into the component | invert control: let the caller compose |
| Every prop optional | no clear contract | required props for what it can't render without |

Two API shapes worth knowing:

**Compound components** — for anything with parts:

```jsx
<Select value={v} onChange={set}>
  <Select.Trigger />
  <Select.Options>{items.map((i) => <Select.Option key={i.id} value={i.id}>{i.label}</Select.Option>)}</Select.Options>
</Select>
```

**Headless / hook-first** — behaviour and accessibility without markup:

```jsx
const { getTriggerProps, getListProps, isOpen } = useSelect({ items });
```

This is what Radix, Headless UI, Downshift and React Aria do, and it's the shape that survives a
redesign — because the hard part (keyboard interaction, focus management, ARIA wiring, collision
detection) is separated from the part that changes (the markup and the styling).

**Do not hand-roll a combobox, dialog, menu or tooltip.** The accessible behaviour is a specification
several pages long ([accessibility course](../../../accessibility/)), and a wrong one is worse than
none.

## The bundle consequence

A design system is imported by everything, so its bundling mistakes multiply:

- **Barrel files** (`export * from './Button'` …) pull the whole library into every consumer unless
  every component is provably side-effect free — [bundle-strategy lab 03](../../../bundle-strategy/labs/03-tree-shaking/).
- **`"sideEffects": false`** must be true, and CSS imports must be listed as the exception.
- **Icons by name** (`<Icon name="x" />`) means every icon ships. Per-icon imports, generated.
- **One heavy dependency** in one rarely-used component ends up in everyone's bundle unless it's
  dynamically imported.

Measure it: build an app that uses three components from your library and check what arrives.

## Think about

- Your `Button` has `variant`, `size`, `tone`, `loading`, `icon`, `iconPosition`, `fullWidth`,
  `as`. Too many?
- A team needs a button that doesn't fit the system. What do you do?
- How do you version a design system without breaking every consumer?

<details>
<summary>Answers</summary>

**Eight props.** Probably fine — they're *orthogonal* (each varies independently and combines
meaningfully), which is the actual test. Fourteen booleans that only make sense in three
combinations are not. The smell is prop *interaction*, not prop count.

**Doesn't fit.** First ask whether it's a genuine gap (then add it to the system, with the design
team) or a one-off (then let them compose it from primitives — which is why exposing primitives
matters). What you must not do is add `isCheckoutVariant`. Track the escape hatches: three teams
building the same one-off *is* the requirement.

**Versioning.** Semver honestly, with codemods for breaking changes (`jscodeshift`), a deprecation
period where the old API warns in dev, and — for large orgs — the ability to run two major versions
side by side. The technique that makes this bearable is tokens: visual changes ship as token updates
without touching component APIs at all.
</details>

---

## 🏗️ Build challenge: three primitives, properly

Build `Button`, `Dialog` and `Select` with:

1. **Three-tier tokens**, dark/light/system theming via CSS custom properties, and a cookie-based
   server-readable preference (no flash, no mismatch).
2. **Compound APIs** for `Dialog` and `Select`; measure prop count against a configuration-style
   equivalent.
3. **Full keyboard and screen-reader support** — focus trap, `Escape`, restore focus on close,
   `aria-expanded`, roving tabindex. Test with a real screen reader, not just axe.
4. **Zero runtime theming cost**: prove that a theme toggle triggers no React re-renders (use the
   sandbox's render tally).
5. **A bundle test**: an app importing only `Button` must not include `Dialog`'s or `Select`'s code.
   Fail CI if it does ([bundle-strategy lab 05](../../../bundle-strategy/labs/05-analyse-and-budget/)).
6. **Visual regression tests** for each component × each theme × each state.

**Done when:** the theme toggle causes zero re-renders, the bundle test passes, and a keyboard-only
user can complete every interaction.

---

## Interview questions

1. Why three tiers of tokens rather than two?
2. How do you theme without re-rendering, and how do you avoid the flash?
3. What's wrong with `variant="primary-large-icon"`?
4. Why is a headless component library shaped the way it is?
5. How does a design system leak into consumers' bundles?
