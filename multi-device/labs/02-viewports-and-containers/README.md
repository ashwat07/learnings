# Lab 02 — Viewports & containers ⭐⭐⭐⭐

**Goal:** stop asking "how wide is the window" when you mean "how much room does this component
have".

> <http://localhost:8080/multi-device/labs/02-viewports-and-containers/>
> Drag the bottom-right corner of the box.

---

## The `100vh` bug, precisely

On mobile, `vh` has always meant the viewport height **with the browser bars hidden**. So a
`height: 100vh` hero is taller than the visible area whenever the bars show, and its bottom is cut
off — that's where "my button is under the URL bar" comes from.

| Unit | Is |
|---|---|
| `vh` / `lvh` | the **large** viewport — bars hidden |
| **`svh`** | the **small** viewport — bars visible. **The safe default** |
| `dvh` | the **dynamic** viewport — correct, but resizes during scroll, so it triggers layout |
| `vi` / `vb` | the writing-mode-aware logical versions |

**The on-screen keyboard is a separate problem no unit solves.** When it opens, the *visual* viewport
shrinks but the layout viewport usually doesn't, so a `position: fixed` footer sits behind it:

```js
visualViewport.addEventListener('resize', () => {
  const inset = innerHeight - visualViewport.height - visualViewport.offsetTop;
  document.documentElement.style.setProperty('--kb', inset + 'px');
});
```

## Container queries

Drag the box: the card switches from stacked to side-by-side **without the viewport changing**.

This fixes the oldest problem in component design. A card in the main column and the same card in a
300px sidebar need different layouts, and a media query can't tell them apart — so component
libraries grew size *props* (`variant="compact"`), which pushed a layout decision up into every
caller and made components impossible to move.

With `@container`, the component knows its own size and decides for itself. That's an architectural
change, not a convenience: it makes components genuinely portable, which design systems have always
claimed and rarely delivered ([architecture-and-state lab 06](../../../architecture-and-state/labs/06-design-system/)).

```css
.card { container-type: inline-size; }
@container (min-width: 380px) { .card .inner { grid-template-columns: 120px 1fr; } }
```

Two notes: `container-type: inline-size` **contains** the element in the inline direction, which can
change layout by itself — apply it to a wrapper. And media queries are still right for *page-level*
decisions; the two are complementary.

Related: **style queries** (`@container style(--variant: compact)`) and **`:has()`**, which is the
other half — styling a parent based on its children.

## Safe areas

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```
```css
.app {
  padding-top:    max(16px, env(safe-area-inset-top));
  padding-bottom: max(16px, env(safe-area-inset-bottom));
  padding-inline: max(16px, env(safe-area-inset-left));
}
```

`max()` because the inset is 0 on most devices and you still want normal padding. **Without
`viewport-fit=cover` the `env()` values are all zero**, which is the usual reason "safe areas don't
work".

It matters most in an installed PWA (no browser chrome between your header and the notch) and in
landscape, where left/right insets suddenly matter and almost nobody tests.

## Fluid type and space

```css
font-size: clamp(1rem, 0.9rem + 0.5vw, 1.5rem);
width:     min(100%, 65ch);
gap:       clamp(8px, 2vw, 24px);
```

**The middle term must include a `rem`.** A bare `vw` doesn't respond to the user's browser font-size
setting, so pure-`vw` type is unzoomable — a WCAG 1.4.4 failure.

And the two layout primitives that remove most breakpoints:

```css
grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
flex-wrap: wrap;   /* with flex-basis */
```

Both reflow continuously instead of jumping at arbitrary widths — which is the point, since there are
no standard device widths and never really were.

## Think about

- When is a media query still the right tool?
- Why does `dvh` cause layout during scroll?
- Your component needs a different layout in a sidebar. Props or container query?

<details>
<summary>Answers</summary>

**Media queries still.** For page-level decisions — how many columns the overall grid has, whether
the nav is a sidebar or a bottom bar, print styles — and for user preferences (`prefers-reduced-motion`,
`prefers-color-scheme`, `forced-colors`), which aren't about size at all. The rule of thumb: media
queries for the *page*, container queries for the *component*.

**`dvh` during scroll.** It's defined as the viewport height *right now*, so as the browser bars
retract it changes continuously — and anything sized in `dvh` is re-laid-out on each change, mid
scroll, which is the one moment you least want layout work. Use `svh` for stable layout and `dvh`
only where the resize is the point.

**Props or container query.** Container query, if the difference is genuinely about available space —
it keeps the decision inside the component, so it works anywhere without the caller knowing. Keep a
prop when the difference is *semantic* rather than spatial ("this is a compact summary variant"),
because that's a decision the caller genuinely owns and shouldn't depend on pixel width.
</details>

---

## 🏗️ Build challenge

1. Replace `100vh` with `100svh` and check every full-height layout on a phone.
2. Handle the keyboard inset with `visualViewport` on your most important form.
3. Convert one prop-driven responsive component to container queries. Then drop it in a sidebar.
4. Add `viewport-fit=cover` and safe-area padding; test in landscape and as an installed PWA.
5. Replace breakpoint-stepped font sizes with `clamp()` including a `rem` term. Verify browser zoom
   still works.
6. Replace one hand-written breakpoint grid with `auto-fit`/`minmax`.

**Done when:** your components lay out correctly by their own width, and no layout depends on a
device-width assumption.

---

## Interview questions

1. Why is `100vh` wrong on mobile, and what replaces it?
2. What can container queries do that media queries can't?
3. What does `viewport-fit=cover` enable?
4. Why must fluid type include a `rem` term?
5. How do you handle the on-screen keyboard?
