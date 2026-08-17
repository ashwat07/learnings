# Lab 01 — Semantics & the accessibility tree ⭐⭐⭐⭐⭐

**Goal:** stop reaching for `<div>`, and know exactly what it costs when you do.

**Primary metric:** how many interactive things you can reach with the Tab key.

> <http://localhost:8080/accessibility/labs/01-semantics/>
> DevTools → Elements → **Accessibility** pane. Select each element and read its computed role and
> name.

---

## The second tree

The browser builds an **accessibility tree** from your DOM, and that's what screen readers, switch
devices and voice control actually receive. Elements decide what ends up in it.

| You write | Role | Focusable | Keyboard |
|---|---|---|---|
| `<div onclick>` | generic | **no** | nothing |
| `<div role="button">` | button | **no** (needs `tabindex="0"`) | you write Enter *and* Space |
| `<button>` | button | yes | Enter + Space, free |
| `<span>` styled large | generic | no | — |
| `<h3>` | heading, level 3 | no (by design) | reachable by the `H` key |
| three `<div>`s | generic ×3 | no | — |
| `<ul><li>` | list, listitem | no | announced as **"list, 3 items"** |
| `<a href>` | link | yes | Enter, free |

**ARIA changes what an element is *called*, never what it *does*.** That's the whole reason for the
first rule of ARIA: a `div role="button"` announces itself as a button and then does nothing when
you press Space — worse than one that never claimed to be one.

Two things the tree gives you free that div soup can't express at any price:

- **the count** — "list, 3 items" means a user knows how long the list is before reading it
- **headings as a navigable outline** — most screen reader users navigate by heading *first*, which
  is why a page of styled spans is unusable even when every word is present

## The itemised cost of `<div role="button" tabindex="0" onClick>`

- `keydown` for Enter **and** Space (Space also scrolls — `preventDefault`)
- a visible `:focus-visible` style, because you lost the UA one
- disabled state: `aria-disabled` + blocking the handler + tab-order decisions
- **form participation: none.** It will never submit a form
- Windows High Contrast Mode: native controls adapt, your div doesn't
- **voice control**: "click Save" works on a real button because the accessible name matches the
  visible label; it fails on an unnamed div

That's ~20 lines and four bugs to reproduce what one word gives you. The reason people do it is
styling, for which the answer is `button { all: unset }` and then style deliberately. **A button can
look like anything.**

## Landmarks and headings

| Element | Role | Use |
|---|---|---|
| `<header>` | banner | the page header (one per page) |
| `<nav>` | navigation | each nav; label them if there's more than one |
| `<main>` | main | **the most valuable one** — "skip to content" targets it |
| `<aside>` | complementary | sidebars |
| `<footer>` | contentinfo | the page footer |
| `<article>` | article | a self-contained item |

**Headings are an outline, not a size.** `h1 → h2 → h3`, no skipped levels, one `h1` naming the
page. If a heading is the wrong size, that's CSS. **The most common real-world accessibility bug is
a heading level chosen for its font size.**

## The five-minute structural audit

1. Turn off CSS entirely. Does the page still read in a sensible order?
2. `$$('h1,h2,h3,h4').map(h => h.tagName + ' ' + h.textContent)` — is that a coherent table of
   contents?
3. Is there exactly one `<main>`, with a skip link pointing at it?
4. Tab through. Can you reach everything, and can you *see* where you are?

## Think about

- When is a `<div>` actually correct?
- Why is `role="application"` almost always wrong?
- You need a button that looks like a link. Which element?

<details>
<summary>Answers</summary>

**When a div is right.** When the thing genuinely isn't a button, link or control — a layout
wrapper, a decorative container, a grouping with no semantic meaning. Semantics describe *meaning*,
and inventing meaning that isn't there is its own bug.

**`role="application"`.** It tells screen readers to stop intercepting keys and pass everything to
your app — which disables the browse-mode navigation (headings, landmarks, links, arrow-key reading)
that users depend on. You've taken away their entire toolkit in exchange for capturing arrow keys.
Legitimate only for something genuinely like a desktop app (a spreadsheet grid, a canvas editor),
and even then scoped to that widget, never the page.

**Button that looks like a link.** `<button>` with link styling. The element is chosen by *behaviour*
— does it navigate (link) or perform an action (button)? — and the appearance is CSS. Getting this
backwards breaks real things: middle-click, "open in new tab", and copy-link-address all work on
links and not on buttons, and screen reader users navigate links and buttons with different keys.
</details>

---

## 🏗️ Build challenge

1. Run `$$('div[onclick], span[onclick], [role="button"]')` on your app. That list is your backlog.
2. Convert each to a native element. Measure the CSS you had to add (usually less than you fear).
3. Add `eslint-plugin-jsx-a11y` with `no-static-element-interactions` and `click-events-have-key-events`
   as errors. Baseline the existing ones; fail on new ones.
4. Audit your heading structure per route and fix the levels chosen for size.
5. Add landmarks and a skip link. Test the skip link with a keyboard — most are broken because the
   target isn't focusable (`tabindex="-1"`).

**Done when:** you can complete your app's primary task with the keyboard only, and your heading
outline reads like a table of contents.

---

## Interview questions

1. What's the accessibility tree, and how does it differ from the DOM?
2. List what `<button>` gives you that `<div role="button">` doesn't.
3. Why are headings an outline rather than a style?
4. What do landmarks do for a screen reader user?
5. When is ARIA the right answer?
