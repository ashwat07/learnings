# Lab 01 — Input modalities ⭐⭐⭐⭐⭐

**Goal:** one interface that works with a mouse, a thumb, a keyboard and a remote.

> <http://localhost:8080/multi-device/labs/01-input-modalities/>
> Try it with a mouse, then with touch (device toolbar), then with the Tab key only.

---

## Detect capabilities, never devices

| Query | Means |
|---|---|
| `(hover: hover)` | the **primary** input can hover |
| `(any-hover: hover)` | **some** input can hover — a touch laptop with a mouse |
| `(pointer: fine)` | a precise primary pointer |
| `(pointer: coarse)` | an imprecise one — finger, remote |
| `(any-pointer: coarse)` | touch is available at all |

A touchscreen laptop reports `pointer: fine` **and** `any-pointer: coarse`. A tablet with a keyboard
case changes its answers when you attach it. **A device is not one thing, and not one thing for the
whole session.**

The practical pattern: **media queries for layout** decisions (which need to be stable), **the last
observed input** for behavioural ones. This page sets `data-last-input` on every `pointerdown` and
`keydown` — move the mouse, then press Tab, and watch it change.

## The hover rule — the one that costs money

"Actions appear on hover" is a beautiful desktop pattern and a dead end on a phone: the actions are
unreachable and the user concludes the feature doesn't exist.

```css
.card .actions { opacity: 1; }                      /* default: visible */
@media (hover: hover) and (pointer: fine) {
  .card .actions { opacity: 0; }                    /* hide ONLY where hover exists */
  .card:hover .actions,
  .card:focus-within .actions { opacity: 1; }       /* and the keyboard equivalent */
}
```

**Note the direction: visible is the default, hiding is the enhancement.** Writing it the other way
is how the touch case gets forgotten.

## The event model

| Event | Use |
|---|---|
| `pointerdown/move/up` | **the default** — one API for mouse, touch and pen, with `pointerType` |
| `click` | **still right for activation** — it fires for keyboard Enter/Space too |
| `touchstart/move` | only for multi-touch details pointer events don't give you |
| `mouseenter/leave` | hover affordances, guarded by `(hover: hover)` |
| **`focusin/focusout`** | the keyboard equivalent of hover — **always pair them** |
| `dblclick`, `contextmenu` | no touch equivalent — always provide another route |
| `{passive: true}` | on scroll/touchmove/wheel, or you block the compositor |

**Keep using `click` for activation.** It isn't a mouse event any more. Replacing it with
`pointerdown` "to feel faster" silently removes keyboard and assistive-tech support — and fires
before the user has committed (they can still drag away and cancel).

**The 300ms tap delay is gone** given `<meta name="viewport" content="width=device-width,
initial-scale=1">`. That's the whole fix; fastclick libraries are long obsolete.

## Targets and thumbs

| Guideline | Size |
|---|---|
| WCAG 2.5.8 (AA) | 24 × 24 CSS px, **unless** there's 24px of spacing around it |
| WCAG 2.5.5 (AAA) | 44 × 44 |
| Material | 48 × 48 |
| TV / remote | much larger, plus a strong focus style |

**Spacing matters as much as size** — the real failure is a row of packed icon buttons, where a
mis-tap hits the wrong action rather than nothing. Fix with padding on the interactive element
(padding is part of the target; margin on a wrapper isn't), a `::before` with negative insets, or by
making the whole row the target.

Design for the **thumb**: on a one-handed phone the top corners are hardest and the bottom third is
easiest. Primary actions low, destructive actions away from where the thumb rests.

## Think about

- How do you support a hover-preview on a touch device?
- A user has a touchscreen laptop. Which input do you design for?
- Why is `:focus-within` so useful here?

<details>
<summary>Answers</summary>

**Hover preview on touch.** Give the information a second route rather than trying to emulate hover —
a long-press, a dedicated "preview" affordance, or simply showing it inline. Attempts to fake hover
with a first-tap-shows/second-tap-activates pattern are a well-known usability trap: the user's first
tap silently does something different from what they intended, and there's no visible cue about which
mode they're in.

**Touchscreen laptop.** Both, and neither exclusively. Layout for the *space* available (which is
generous), sizing for the *coarser* pointer (so targets stay finger-friendly), and behaviour for the
*last used* input. Hover enhancements are fine because hover exists; they just can't be the only
route to anything.

**`:focus-within`.** It gives you the keyboard equivalent of `:hover` on a *container* — so a card
whose actions appear on hover can reveal them when anything inside is focused, with one selector and
no JavaScript. It's the cheapest way to make a hover-reveal pattern keyboard-accessible, and it also
covers screen reader users navigating by element.
</details>

---

## 🏗️ Build challenge

1. Grep your CSS for `:hover` without a paired `:focus-visible` or `:focus-within`. Fix each.
2. Find functionality that only appears on hover. Make visible the default and hiding the
   enhancement.
3. Replace mouse+touch handler pairs with pointer events.
4. Audit target sizes and spacing:
   `$$('button, a').filter(el => { const r = el.getBoundingClientRect(); return Math.min(r.width, r.height) < 24 })`.
5. Add `{passive: true}` to scroll/touch/wheel listeners that never `preventDefault`.
6. Do the three passes: mouse unplugged, phone, keyboard only.

**Done when:** every action in your app is reachable by mouse, touch **and** keyboard.

---

## Interview questions

1. `hover` vs `any-hover` — why does the distinction exist?
2. Why keep `click` rather than `pointerdown`?
3. What's wrong with hiding actions behind hover, and what's the correct CSS direction?
4. What does a passive listener change?
5. Why is user-agent sniffing worse now than it was?
