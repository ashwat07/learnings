# Lab 03 — TV & the 10-foot UI ⭐⭐⭐⭐⭐

**Goal:** design for four arrow keys, a slow chipset, and a screen three metres away.

> <http://localhost:8080/multi-device/labs/03-tv-and-10-foot/>
> Press "start navigating" and use the arrow keys.

---

## Four keys and OK

That's the entire input vocabulary, and it forces a shape:

- **Everything is a grid or a rail.** If the user can't get from A to B with four directions, the
  control is unreachable. A free-form layout that's fine with a mouse can be impossible.
- **Focus is the only cursor.** Always visible, obvious from three metres, and never lost — if focus
  falls to `<body>` the remote does nothing and the app appears frozen.
- **Scrolling follows focus.** There's no scrollbar; the container moves so the focused item stays in
  view.
- **The back button is sacred.** It's the only way out of anything.

CSS spatial navigation exists as a proposal and some TV browsers navigate with arrow keys natively,
but coverage is inconsistent enough that **every serious TV app ships its own focus engine** — like
the one in this lab's `app.js`.

## The constraints, and what each forces

| Constraint | Consequence |
|---|---|
| 4 arrows + OK + back | grid/rail layouts, a hand-written focus engine |
| viewed from ~3m | text ≥ 24px at 1080p, huge focus styles, high contrast |
| **overscan** | ~5% safe-area padding on every edge |
| slow CPU (often 2016-era ARM) | small bundles, virtualize everything |
| limited GPU/memory | few compositor layers, careful with large images |
| **old browser engines** | Chromium 60-something is common; transpile and polyfill |
| no hover, no pointer | nothing behind hover, no tooltips |
| lean-back context | **no typing** — pair with a phone instead of a login form |

**Overscan** is why TV UIs look so much emptier than web pages. Many TVs crop the edges — a CRT-era
tolerance that never fully went away — so all text and controls sit inside a ~5% inset. It's not a
style choice.

Also: TVs report 1920×1080 CSS pixels regardless of panel size, thin fonts and low-contrast greys
disappear at three metres, and pure white on pure black smears on some panels (slightly off-white on
very dark grey is the house style).

**The login problem** is the most underestimated. Typing an email and password with an on-screen
keyboard and a remote takes minutes and fails often. Every serious TV app uses **device pairing**:
show a short code, the user enters it on their phone, you poll for authorisation. That's the OAuth
2.0 Device Authorization Grant, and it exists for exactly this.

## Performance budgets

| | Web | TV |
|---|---|---|
| JS bundle | 150–300KB | **< 100KB**, parsed on a slow CPU |
| time to interactive | < 3s | aim < 5s, expect worse |
| list rendering | virtualize over ~1,000 | **virtualize over ~50** |
| images | responsive `srcset` | one size (1080p), pre-sized, cached |
| animation | 60fps | often 30fps; prefer opacity fades |
| memory | generous | a few hundred MB, shared with the OS |

**Preload along the focus path.** You know the user can only move four ways, so fetch the images for
neighbouring tiles and nothing else — the one place where prefetching is genuinely predictable.

**Measure on the actual device.** A 6× CPU throttle is a rough proxy at best; TV chipsets are slow in
ways that don't map onto a linear multiplier, and GPU and memory limits bite first.

**Keep a constant memory profile.** Long lean-back sessions mean a slow leak invisible in a ten-minute
web session crashes a TV app after two hours ([spa-memory-leaks](../../../spa-memory-leaks/)).

## Why this matters even if you never ship to a TV

A TV is the **extreme case of constraints you already have**:

| TV constraint | The everyday version |
|---|---|
| keyboard-only navigation | [accessibility lab 02](../../../accessibility/labs/02-keyboard-and-focus/), with no Tab key |
| always-visible focus | the same requirement, but now nobody can use the app without it |
| no hover | touch, permanently |
| slow CPU | a low-end Android, but worse and non-negotiable |
| long sessions | the same memory discipline, with less headroom |
| large targets, high contrast | [accessibility lab 05](../../../accessibility/labs/05-visual-and-motion/), from three metres |

Teams that build a TV version usually find the focus management and virtualization work pays back on
phone and desktop too — because those were never optional, only easy to skip.

## Think about

- Focus is on a tile that gets removed by a data refresh. What happens?
- How do you handle a long list of 500 tiles?
- Why can't you use a modal dialog the way you would on the web?

<details>
<summary>Answers</summary>

**Focus on a removed element.** Focus falls to `<body>`, the remote stops doing anything, and to the
user the app has frozen — with no cursor to show them why. This is *the* classic TV bug. Before any
list update, record the focused item's identity; after it, restore focus to the same item, or the
nearest surviving neighbour, or a sensible default. Never let a data refresh decide where focus goes.

**500 tiles.** Virtualize with a small window (say 10–15 rendered) and drive it from the focus index
rather than scroll position — you always know exactly where the user is, which makes it far simpler
than scroll-driven virtualization. Preload images only for immediate neighbours, and release those
outside the window so memory stays flat.

**Modals on TV.** They work, but the rules are stricter: focus must move into the dialog and be
trapped (a remote has no Tab to escape with), the back button must close it, and it must be big and
high-contrast enough to read from three metres. What doesn't translate is a modal that relies on
clicking outside to dismiss, or one that stacks — there's no pointer, and nested traps are how you
lose the user entirely.
</details>

---

## 🏗️ Build challenge

1. Build a focus engine: a focusable grid model, arrow-key movement, focus restoration after data
   updates, and a back stack.
2. Add the 5% safe area and check text sizes from three metres — literally, on a TV.
3. Virtualize a rail to ~10 rendered tiles driven by the focus index.
4. Preload only the neighbours of the focused tile.
5. Implement device-pairing login.
6. Run for two hours and take heap snapshots at the start and end.

**Done when:** the app is fully operable with only arrow keys, OK and back, and memory is flat after
two hours.

---

## Interview questions

1. What does having only four directional keys force about your layout?
2. What is overscan and what do you do about it?
3. What happens when focus lands on a removed element, and how do you prevent it?
4. How do you log in on a TV?
5. Which TV constraints are really the constraints you already have?
