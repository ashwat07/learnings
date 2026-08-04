# 02 — What triggers what

Two lookup tables. Learn the shape, not the whole list — and verify anything you're unsure of by
recording a trace rather than trusting a table (including this one; engines change, and
`csstriggers.com` is a useful but dated reference).

## Writes: property → cheapest stage it can get away with

| Property | Style | Layout | Paint | Composite |
|---|:--:|:--:|:--:|:--:|
| `width`, `height`, `padding`, `margin`, `border-width` | ✓ | ✓ | ✓ | ✓ |
| `top`/`left`/`right`/`bottom`, `position` | ✓ | ✓ | ✓ | ✓ |
| `display`, `float`, `flex`, `grid-*`, `align-*` | ✓ | ✓ | ✓ | ✓ |
| `font-size`, `font-family`, `font-weight`, `line-height`, `letter-spacing` | ✓ | ✓ | ✓ | ✓ |
| `white-space`, `overflow`, `vertical-align` | ✓ | ✓ | ✓ | ✓ |
| `color`, `background`, `background-image` | ✓ | | ✓ | ✓ |
| `border-radius`, `border-style`, `box-shadow`, `outline` | ✓ | | ✓ | ✓ |
| `visibility`, `text-decoration`, `filter`* | ✓ | | ✓ | ✓ |
| `transform`, `opacity` (on a composited layer) | ✓ | | | ✓ |
| `will-change`, `scroll-behavior`, `cursor`, `pointer-events` | ✓ | | | |

\* `filter` and `opacity` can be composite-only when the element already has its own layer;
otherwise they force a repaint of the layer they live in.

Rules of thumb that survive engine changes:

1. **Does it change the size or position of a box?** → Layout.
2. **Does it change any pixel inside a box without moving boxes?** → Paint.
3. **Can the GPU do it as a per-layer matrix or alpha operation?** → Composite only. That's
   exactly two things: `transform` and `opacity`.

### The animation shortlist

You only ever get composite-only animation from: `transform` (translate/scale/rotate/skew),
`opacity`, and — where supported and correctly used — `filter` on an already-composited layer.
Everything else costs at least paint, per frame.

## Reads: the forced-layout list

Reading any of these while the DOM is dirty forces a synchronous layout (or style recalc):

**Element geometry**
```
offsetTop  offsetLeft  offsetWidth  offsetHeight  offsetParent
clientTop  clientLeft  clientWidth  clientHeight
scrollTop  scrollLeft  scrollWidth  scrollHeight
getBoundingClientRect()  getClientRects()
innerText   (yes — it's layout-aware, unlike textContent)
checkVisibility()  computedStyleMap()
focus()    (can scroll → needs layout)
```

**Window / document**
```
window.innerWidth/innerHeight      window.scrollX/scrollY
window.getComputedStyle(el)        (forces style; forces layout for layout-dependent values)
document.scrollingElement.scrollTop
document.elementFromPoint()
```

**APIs that flush**
```
el.scrollIntoView()      el.scrollBy()/scrollTo()
range.getBoundingClientRect()
svg.getBBox()  svg.getComputedTextLength()
```

**Notably safe**
```
textContent (not innerText)   dataset   className   classList
element.style.width           ← reading the *inline* style string is not a computed read
```

`getComputedStyle` deserves special mention: it always forces style recalc if styles are dirty,
and forces layout if you read a layout-dependent value (`width`, `height`, `top`, ...). Reading
`color` may only cost style.

## Reads that don't block: the async escape hatches

| Instead of | Use | Why |
|---|---|---|
| `getBoundingClientRect()` in a scroll handler to test visibility | `IntersectionObserver` | computed off the main thread, delivered as a callback |
| `offsetWidth` polling to detect resize | `ResizeObserver` | fires after layout, no forced flush |
| Reading positions to animate | `Element.animate()` / CSS animation | runs on the compositor |
| Measuring in a loop | batch: read all → write all, or `requestAnimationFrame` for the writes | one layout per frame |

`ResizeObserver` and `IntersectionObserver` callbacks run *after* layout, so reading geometry
inside them is already cheap — but writing then reading inside them re-dirties the tree, so the
same discipline applies.

## The one-liner to remember

> Writes are lazy, reads are impatient. Group them.
