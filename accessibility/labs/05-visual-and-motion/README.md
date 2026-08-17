# Lab 05 — Visual & motion ⭐⭐⭐⭐

**Goal:** the requirements you can check with a number.

**Primary metric:** contrast ratios, target sizes, and whether the page works at 400% zoom.

> <http://localhost:8080/accessibility/labs/05-visual-and-motion/>

---

## Contrast

| Ratio | Applies to |
|---|---|
| **4.5:1** | normal text (AA) |
| 3:1 | large text (≥24px, or ≥18.7px bold) |
| **3:1** | **UI components and meaningful graphics** (1.4.11) — borders, icons, focus rings, chart lines |
| 7:1 | normal text (AAA) |

The third row is missed constantly. Your input border, your focus ring and your chart lines all have
a requirement.

Two things the formula doesn't capture, which is why it's being replaced: it treats all hues alike
(light-on-dark is systematically underrated by it), and it says nothing about weight beyond one
threshold. **APCA** (draft for WCAG 3) models this properly — use it to make better decisions, and
the current formula for compliance, because that's what the law references.

**Never use colour alone.** A red/green status dot with no text is invisible information to millions
of people. Add an icon, a label, a pattern, a position.

## The 400% zoom test

Set your window to **1280px** and zoom to **400%**. That's equivalent to a 320px viewport, which is
what WCAG 1.4.10 (Reflow) requires — usable with no two-dimensional scrolling.

What usually breaks:

- fixed heights on anything containing text
- `position: fixed` headers/footers now occupying the whole screen
- horizontal scrolling — the actual failure condition
- tables (the one legitimate exception; wrap them in a scroll container)
- absolutely positioned tooltips landing off-screen

The fix is nearly always: `min-height` instead of `height`, `rem` instead of `px` for text-sized
things, let content wrap. And it doubles as responsive QA, because it's the same failure surface as
a small phone.

**Text spacing (1.4.12)** catches the other half: line-height 1.5, letter-spacing 0.12em,
word-spacing 0.16em, paragraph spacing 2em. If your buttons clip their labels under that, they were
relying on a fixed height they shouldn't have had.

## Motion

`prefers-reduced-motion: reduce` is not a stylistic preference. Vestibular disorders are real and
common; large parallax, zoom and slide transitions cause genuine nausea. Someone who turned this on
has told you something about their body.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important; animation-iteration-count: 1 !important;
    transition-duration: .01ms !important; scroll-behavior: auto !important;
  }
}
```

But **"reduce" doesn't mean "remove"**. A cross-fade is usually better than a hard cut, because
motion carries meaning. Rule of thumb: **remove movement (translate, scale, parallax, spin), keep
opacity.**

Also required, separately:

- **2.2.2** — anything moving, blinking or auto-updating for over 5 seconds needs pause/stop/hide.
  Carousels, tickers, animated backgrounds.
- **2.3.1** — nothing may flash more than 3 times per second (seizure risk).
- Autoplaying video: pause under reduced motion, never autoplay with sound.

## Target size

WCAG 2.2 added **2.5.8: 24×24 CSS px at AA**. 2.5.5 (AAA) asks 44×44 — also Apple's guidance, and
roughly a fingertip.

The exceptions matter: inline links in a sentence are exempt, and a small target passes if there's
24px of *spacing* around it. So the failing case is a row of tiny icon buttons packed together.

Fixes that don't change the design: **padding on the interactive element** (padding is part of the
target; margin on a wrapper isn't), a `::before` with negative insets to extend the hit area, or
making the whole row the target.

The group most affected isn't who people assume: anyone with a tremor, anyone on a phone one-handed
on a moving train, and anyone over about 60.

## The other user preferences

| Query | Respond by |
|---|---|
| `prefers-color-scheme` | a real dark theme; don't just invert |
| `prefers-contrast: more` | stronger borders and text; drop subtle greys |
| **`forced-colors: active`** | Windows High Contrast — don't fight it |
| `prefers-reduced-transparency` | drop the frosted-glass backdrop |
| `prefers-reduced-data` | smaller images, no autoplay video |

**`forced-colors` breaks custom components hardest.** Windows replaces your palette entirely.
Survives: native elements, borders, text. Disappears: background-image icons, box-shadow-only
borders, colour-only state. Fixes are structural — borders not shadows, `currentColor` for icons,
system colour keywords (`ButtonText`, `Canvas`, `Highlight`) inside a `forced-colors` query.

The principle behind every row: **the user told the browser something about how they need to see.**
Reading it is free; ignoring it is a choice.

## Think about

- Your brand colour fails contrast on white. Now what?
- Is dark mode an accessibility feature?
- A carousel auto-advances every 5 seconds. What's required?

<details>
<summary>Answers</summary>

**Brand colour failing contrast.** Keep the brand colour for large text, logos and decorative
surfaces (where 3:1 or no requirement applies), and define a darker/lighter *accessible variant* for
body text and small UI. Almost every mature brand has one. What you must not do is use it for 14px
body copy and hope — and it's worth measuring first, because designers often assume a failure that
isn't there, or vice versa.

**Dark mode as accessibility.** For some people yes (light sensitivity, migraine, some low-vision
conditions), for others actively worse — people with astigmatism often find light text on dark
harder to read due to halation. So it's a *preference to respect*, not an accessibility win in
itself. What matters is that both themes independently meet contrast requirements, which is where
naive inversion falls down.

**Auto-advancing carousel.** WCAG 2.2.2 requires a mechanism to pause, stop, or hide it, since it
moves for more than 5 seconds. Also: it must not steal focus as it advances, the controls must be
keyboard-operable and labelled, the slide change should be announced (or the region marked
`aria-live="off"` if it's decorative), and it should not auto-advance at all under
`prefers-reduced-motion`. The honest answer is usually to stop auto-advancing.
</details>

---

## 🏗️ Build challenge

1. Audit your colour tokens with the contrast formula. Fix at the token level, once.
2. Include **UI component contrast** (3:1) — borders, focus rings, icons, chart series.
3. Do the 400% test on your three most important pages. Fix the reflow failures.
4. Add the `prefers-reduced-motion` block, then go through your animations deciding which lose
   movement and which lose everything.
5. Audit target sizes: `$$('button, a').filter(el => { const r = el.getBoundingClientRect(); return
   Math.min(r.width, r.height) < 24 })`.
6. Open your app in Windows High Contrast Mode. Fix what disappears.

**Done when:** contrast is enforced in the palette rather than per component, and 400% zoom works.

---

## Interview questions

1. What are the AA contrast thresholds, including the one for components?
2. What does the 400% zoom test actually test?
3. Why doesn't "reduced motion" mean "no animation"?
4. What's the minimum target size, and what are the exceptions?
5. What breaks in Windows High Contrast Mode, and why?
