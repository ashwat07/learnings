# Lab 03 — ARIA & live regions ⭐⭐⭐⭐⭐

**Goal:** announce what changed, name everything, and write as little ARIA as possible.

**Primary metric:** does a screen reader say anything when the UI updates?

> <http://localhost:8080/accessibility/labs/03-aria-and-live-regions/>
> **Turn a screen reader on.** This is the one lab where you can't verify anything without one.

---

## The five rules of ARIA (the W3C's own)

1. **Use a native element instead, if one exists** — you get role, state, focus and keyboard free.
2. **Don't change native semantics.** `<button role="heading">` means you now owe the button
   behaviour to nobody.
3. **All interactive ARIA controls must be keyboard-operable.**
4. **Don't use `aria-hidden` or `role="presentation"` on a focusable element** — you create a
   reachable, unnamed control.
5. **Every interactive element needs an accessible name.**

They compress to: **a role is a promise about behaviour that you must then keep.** `role="tablist"`
promises arrow keys. `role="menu"` promises the menu keyboard contract (and `menu` is for
*application* menus — a nav is a nav). Claiming the role without the contract is worse than a plain
list, because you've told the user to expect something.

Which is why surveys of the top million home pages consistently find that pages **using** ARIA
average **more** detected errors than pages using none. Not because ARIA is bad — because it's used
to paper over the wrong element.

## Live regions — the part with no native equivalent

Every asynchronous update in your app is **silent** by default: a toast, a validation message, a
"saved" indicator, a filtered result count, an item added to a cart.

| Mechanism | Behaviour | Use for |
|---|---|---|
| `aria-live="polite"` | queued until the reader finishes | ~95% of updates |
| `aria-live="assertive"` | **interrupts mid-word** | session expiry, payment failure, data loss |
| `role="status"` | implicit polite; also visible | toasts, "saved", result counts |
| `role="alert"` | implicit assertive | errors |
| `role="log"` | polite, appends | chat, console |

### The four mechanics that make them actually work

- **The region must exist in the DOM before the change, and be empty.** Inserting a div that already
  contains the text is usually *not* announced — the reader watches an existing node for mutations.
- **`aria-atomic="true"`** reads the whole region; without it only the changed node is read, so
  "3 items" can announce a bare "3".
- **Announcing the same text twice needs a clear-then-set**, or the second is dropped as "no change".
- **Hide it with the `.visually-hidden` pattern**, never `display: none` or `visibility: hidden` —
  both remove it from the accessibility tree.

### Announce the outcome, not the process

"7 results found" is useful; "loading, loading, loading" is noise.

- under ~1s: announce only the result
- longer: one "Searching…", then the result, with `aria-busy="true"` on the region being replaced
- real progress: `role="progressbar"` with `aria-valuenow` at sensible intervals

And check any type-ahead list: **does it announce the count?** That single announcement is often the
difference between a usable autocomplete and one that gets abandoned.

## Accessible names, in precedence order

| Source | Wins |
|---|---|
| `aria-labelledby` | 1st |
| `aria-label` | 2nd |
| the element's own content | 3rd |
| `<label for>` | for form controls |
| `title` | last resort — not shown on touch, poorly supported |
| `placeholder` | **not a name** |

**`aria-label` overrides the visible text** — and if they disagree, voice control breaks. A button
reading "Save" with `aria-label="Submit form"` can't be activated by saying "click Save". WCAG 2.5.3
requires the accessible name to *contain* the visible text.

Prefer visible text as the name; use `aria-labelledby` to point at existing text; use `aria-label`
only when there's genuinely no visible text.

## State and property attributes

| Attribute | Goes on | Note |
|---|---|---|
| **`aria-expanded`** | the **trigger**, not the panel | the most commonly missed attribute in existence |
| `aria-selected` | tabs, options | |
| `aria-current="page"` | the active nav link | better than `aria-selected` for navigation |
| `aria-disabled` | anything you want focusable but inert | unlike `[disabled]`, it stays reachable — often better |
| `aria-describedby` | the control | hint text or an error message |
| `aria-hidden="true"` | decorative content | **never** on anything focusable |

Every disclosure, accordion, dropdown, hamburger and combobox needs `aria-expanded` on the trigger,
updated when it changes. Without it a screen reader user can't tell whether the thing is open.

## Think about

- Your toast disappears after 4 seconds. Any problems?
- When would you use `aria-label` over a visible label?
- A modal is open. Do you need `aria-hidden` on the background?

<details>
<summary>Answers</summary>

**Disappearing toast.** Several. A screen reader user may still be listening; someone with a
cognitive or motor disability may not have finished reading; and if the toast carries an action
("Undo") it must be reachable, which a vanishing toast isn't. WCAG 2.2.1 wants it dismissible,
pausable, or persistent. Practical compromise: persist until dismissed if it has an action, extend
the timeout on hover/focus, and never put critical information *only* in a toast.

**`aria-label` over a visible label.** When there's genuinely no visible text — an icon-only button,
a close "×", a landmark that needs distinguishing (`<nav aria-label="Breadcrumb">`). Not as a way to
give a *different* name to something that already has visible text; that breaks voice control and
confuses anyone using both speech and sight.

**`aria-hidden` on the background.** With `<dialog>.showModal()`, no — the browser makes the rest of
the document inert, which is strictly better (it removes focusability too). Hand-rolled, you need
`inert` on the background (or `aria-hidden` plus your own focus trap), and you must remember to
remove it — a stuck `aria-hidden` on `#root` is a spectacular bug that makes the entire app invisible
to assistive tech while looking perfect.
</details>

---

## 🏗️ Build challenge

1. Add one global live region to your app shell (polite, atomic, visually hidden) and an
   `announce(text)` helper with clear-then-set.
2. Route through it: form submission results, async operation outcomes, filter result counts, items
   added/removed, and route changes.
3. Audit every disclosure for `aria-expanded` on the trigger.
4. Check every icon-only button has an accessible name that matches what a user would *call* it.
5. Test each with a screen reader. Most live-region bugs are invisible to automated tools.

**Done when:** every async state change in your primary flow is announced, once, in the right tone.

---

## Interview questions

1. Name the five rules of ARIA and the one that subsumes the rest.
2. Why do pages using ARIA average more errors than pages without?
3. `polite` vs `assertive` — when is each right?
4. Three reasons a live region doesn't announce.
5. Why can `aria-label` break voice control?
