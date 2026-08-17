# Accessibility architecture ⭐⭐⭐⭐⭐

Accessibility is not a checklist you run at the end. It is a set of structural decisions — what
elements you use, where focus goes, what gets announced — that are cheap when made early and
expensive to retrofit.

```sh
./serve.sh    # then http://localhost:8080/accessibility/labs/01-semantics/
```

**Turn on a screen reader for these labs.** Reading about announcements is not the same as hearing
one.

| Platform | Reader | Start / stop | Essentials |
|---|---|---|---|
| macOS | VoiceOver | `⌘F5` | `VO = Ctrl+⌥`. `VO+→` next item, `VO+U` rotor, `Ctrl` to shut it up |
| Windows | NVDA (free) | `Ctrl+Alt+N` | `Insert+↓` read all, `H` headings, `D` landmarks, `Ctrl` to stop |
| Any | keyboard only | unplug your mouse | the cheapest test there is, and it finds most of it |

---

## The four principles (POUR), as questions

| | Question |
|---|---|
| **Perceivable** | can they receive the information at all — visually, audibly, by touch? |
| **Operable** | can they drive it with a keyboard, a switch, a voice, one thumb? |
| **Understandable** | is it predictable, and are errors explained? |
| **Robust** | does it survive assistive tech, zoom, and a browser you didn't test? |

WCAG 2.2 AA is the level most legislation references (the EU Accessibility Act, the US ADA case law,
the UK Equality Act). Level A is the floor; AAA is aspirational and not expected wholesale.

## Curriculum

| # | Lab | Question it answers | ⭐ |
|---|---|---|---|
| 01 | [Semantics](labs/01-semantics/) | What does a `<div>` cost you? | ⭐⭐⭐⭐⭐ |
| 02 | [Keyboard & focus](labs/02-keyboard-and-focus/) | Where did focus go? | ⭐⭐⭐⭐⭐⭐ |
| 03 | [ARIA & live regions](labs/03-aria-and-live-regions/) | How does anyone know something changed? | ⭐⭐⭐⭐⭐ |
| 04 | [Forms & errors](labs/04-forms-and-errors/) | Can they fix what they got wrong? | ⭐⭐⭐⭐⭐ |
| 05 | [Visual & motion](labs/05-visual-and-motion/) | Contrast, zoom, target size, motion | ⭐⭐⭐⭐ |
| 06 | [Testing & architecture](labs/06-testing-and-architecture/) | How do I keep it accessible? | ⭐⭐⭐⭐⭐ |

## The first rule of ARIA

> **No ARIA is better than bad ARIA.**

A `<button>` is already a button: focusable, activatable by Enter *and* Space, announced as a
button, and in the tab order. `<div role="button">` gives you the *announcement* and none of the
behaviour — so you now owe `tabindex`, two key handlers, and a focus style, and you will get one of
them wrong.

The second rule follows: **use the native element**. Almost everything in this course is a
consequence of that one decision.
