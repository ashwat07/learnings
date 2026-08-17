# Lab 02 — Keyboard & focus ⭐⭐⭐⭐⭐⭐

**Goal:** always know where focus is, and put it there on purpose.

**Primary metric:** can you complete every task without a mouse, and always see where you are?

> <http://localhost:8080/accessibility/labs/02-keyboard-and-focus/>

---

## Focus is one shared point of attention

Keyboard users, screen readers, switch devices and voice control all use it. Every interaction either
moves it deliberately or loses it — and losing it is the most common serious accessibility bug in
SPAs.

## The modal

Open the **bad modal** and press Tab. Focus is still behind it, moving through content the user
can't see. A screen reader user has no idea a dialog opened, because nothing about their point of
attention changed.

Now open the **good modal**. `<dialog>.showModal()` gives you all five requirements:

- focus moved into the dialog (first focusable, or `[autofocus]`)
- a focus trap enforced by the **browser**, not your keydown handler
- the rest of the document made **inert** — not just unfocusable but invisible to assistive tech and
  unclickable, which `aria-hidden` alone doesn't achieve
- Escape to close (a cancelable `cancel` event)
- **focus returned** to the element that opened it
- plus `::backdrop`

The hand-rolled version needs a Tab handler enumerating focusable elements — a selector that's
famously wrong for `disabled`, `hidden`, `<details>`, iframes, shadow DOM and tabindex ordering —
plus `aria-modal`, manual restoration, and an inert polyfill. That's what every focus-trap package
exists to hold, and it's now a browser feature.

## `outline: none`

Toggle it and tab around. You're still moving focus; you just can't see it. WCAG 2.4.7 failure, and
by a wide margin the most common accessibility regression introduced by "remove that blue ring".

```css
:focus-visible { outline: 2px solid #6cf; outline-offset: 2px; }
```

`:focus-visible` is the browser's own heuristic for "this user is navigating by keyboard" — exactly
the behaviour people *wanted* when they reached for `outline: none`. Give it an offset, and make
sure it has 3:1 contrast against **both** the component and the background (WCAG 2.4.11).

## Roving tabindex

A toolbar of 12 buttons, each tabbable, means 12 presses to get past it. The APG pattern is: **Tab
enters the group, arrow keys move within it, Tab leaves.** Exactly one element in the group has
`tabindex="0"` at a time.

Try the tabs in the lab. Then note the corollary: a **menu** is not a **tablist** is not a
**listbox** is not a **toolbar** — each has a defined keyboard contract in the ARIA Authoring
Practices Guide, and picking the wrong role promises behaviour you haven't implemented. When unsure,
use links and buttons in a `<nav>`: boring, and correct.

## The SPA route-change recipe

A router changes content but not focus, title, or scroll — the browser does all three on a real
navigation. For a screen reader user, an SPA navigation with no focus management is **silent**.

1. update `document.title` — this is what most readers announce on navigation
2. move focus to the new page's `<h1>` with `tabindex="-1"`
3. reset scroll to the top
4. optionally announce the route name in a live region

`tabindex="-1"` means "focusable by script, not by Tab". `tabindex="0"` means "in the natural tab
order". A **positive** tabindex jumps the queue, breaks the DOM-order relationship everyone relies
on, and is essentially never correct.

## The rules

| Rule | Check |
|---|---|
| everything interactive is reachable by Tab | unplug the mouse |
| focus is always **visible** | `:focus-visible`, 3:1 contrast |
| tab order follows visual order | no positive tabindex; watch CSS `order`/grid reordering |
| dialogs trap focus and return it | `<dialog>.showModal()` |
| nothing steals focus unexpectedly | no `autofocus` on a long page; no `focus()` on a background update |
| composite widgets are **one** tab stop | roving tabindex |
| route changes move focus and title | the recipe above |
| Escape closes the topmost layer | and only the topmost |
| **no keyboard traps** | you can always Tab back out (WCAG 2.1.2) |

## Think about

- A dropdown opens on hover. What's the keyboard equivalent?
- Where should focus go after deleting a row from a table?
- Is `autofocus` good or bad?

<details>
<summary>Answers</summary>

**Hover dropdown.** Hover isn't an input method for keyboard, switch or touch users. Make the
trigger a `<button aria-expanded>` that opens on click/Enter/Space; keep hover as an *additional*
affordance if you like, with a delay so it doesn't fire on pass-through. And per WCAG 1.4.13, content
that appears on hover must be dismissible (Escape), hoverable (you can move the pointer into it), and
persistent (it doesn't vanish on its own).

**After deleting a row.** Never leave focus on a removed element — it falls to `<body>` and the user
loses their place entirely. Move it to the next row, or the previous one if you deleted the last, or
the container with a message if the list is now empty. And announce the deletion in a live region,
because the visual "it's gone" isn't available.

**`autofocus`.** Good on a page whose single purpose is that field (a login form, a search page,
inside a dialog you just opened). Bad on a content page — it dumps the user past your header and
navigation without warning, disorients screen reader users, and on mobile it opens the keyboard and
hides half the page.
</details>

---

## 🏗️ Build challenge

1. Complete your app's primary flow with the keyboard only. Write down every place you got stuck.
2. Replace every custom modal with `<dialog>`. Delete the focus-trap dependency.
3. Add the route-change recipe to your router, once, centrally.
4. Audit for `outline: none` and replace with `:focus-visible`.
5. Convert one toolbar or tab set to roving tabindex following the APG.
6. Write a Playwright test that tabs through a page and asserts the order matches the visual order.

**Done when:** every task is keyboard-completable, and a route change announces the new page.

---

## Interview questions

1. What does `<dialog>.showModal()` do that a hand-rolled modal usually doesn't?
2. `outline: none` — why is it a failure, and what's the fix?
3. `tabindex` values: 0, -1, positive. What does each mean?
4. Describe roving tabindex and why composite widgets need it.
5. What must happen on an SPA route change?
