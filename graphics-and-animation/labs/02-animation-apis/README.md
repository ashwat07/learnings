# Lab 02 — Animation APIs ⭐⭐⭐⭐

**Goal:** pick the API from who needs to own the timeline.

> <http://localhost:8080/graphics-and-animation/labs/02-animation-apis/>

---

## The comparison

| API | Control | Thread | Use for |
|---|---|---|---|
| CSS transition | none | compositor | state changes: hover, focus, open, selected |
| CSS `@keyframes` | little | compositor | looping, state-driven animation |
| **Web Animations API** | full — pause/seek/reverse/promise | compositor | **the default for JS-driven animation** |
| `requestAnimationFrame` | total | **main** | per-frame computation, canvas, pointer-following |
| View Transitions | declarative + CSS | compositor | animating between two DOM states |
| `animation-timeline` | declarative | compositor | anything tied to scroll |
| a spring library | full | usually main | interruptible, velocity-aware motion |

### The decision, one line each

```
Follows a state change?           → CSS transition
Loops or has keyframes?           → CSS animation
Need pause/seek/reverse?          → Web Animations API
Tied to scroll?                   → animation-timeline
Swapping DOM states?              → View Transitions
Need a value computed per frame?  → requestAnimationFrame
Drawing pixels?                   → canvas (labs 04–05)
```

## Web Animations API

Same compositor performance as CSS, plus an object:

```js
const anim = el.animate([{transform: 'translateX(0)'}, {transform: 'translateX(620px)'}],
                        {duration: 1600, easing: 'ease-in-out'});
anim.pause(); anim.reverse(); anim.currentTime = 800; anim.playbackRate = 2;
await anim.finished;
anim.commitStyles();
```

`document.getAnimations()` returns every running animation — which is how you implement "pause
everything" for `prefers-reduced-motion`, or wait for animations before a screenshot test.

## The two transition gotchas

- **A transition needs two states the browser can see.** Setting the property in the same frame as
  the transition does nothing — hence the `requestAnimationFrame` wrapper. (Forcing a reflow by
  reading `offsetWidth` also works, and is a forced layout you shouldn't need.)
- **Transitioning from `display: none`** historically didn't work. The modern fix is
  `transition-behavior: allow-discrete` plus `@starting-style`, which finally makes enter/exit
  animation possible in pure CSS.

## View Transitions

```js
document.startViewTransition(() => { updateTheDom(); });
```

The browser screenshots the old state, runs your callback, screenshots the new, and cross-fades —
and any element with a matching `view-transition-name` **morphs** from its old position and size to
its new one. That's FLIP, built in and done correctly, including for elements that were removed and
re-created. Style with `::view-transition-old(name)` / `::view-transition-new(name)`.

Cross-document (`@view-transition { navigation: auto }`) does the same across a real navigation —
which gives an MPA the transition quality people built SPAs to get.

Caveats: the callback should be synchronous and fast (the page is frozen during it), names must be
**unique at any moment**, and support isn't universal — the fallback is an instant update, so treat
it as progressive enhancement.

## Scroll-driven animations

```css
#progress { animation: grow linear; animation-timeline: scroll(nearest); }
```

The point isn't the effect — it's **where it runs**. A scroll handler runs on the main thread and
always lags the scroll (which happens on the compositor). `animation-timeline` runs on the
compositor, perfectly synchronised, with no JavaScript. `view()` drives an animation from an
element's progress through the viewport, replacing `IntersectionObserver` for reveal effects.

## Why springs exist

Duration-based easing looks wrong when an animation is **interrupted**: the new animation starts from
a standstill even though the element was moving. A spring carries velocity across the interruption —
which is why drag-and-release UI built with springs feels physical and the same UI with a 300ms
ease-out doesn't. That's what Motion and React Spring are for; the cost is that they usually run on
the main thread.

## Think about

- Why does the rAF version stop when the main thread is blocked, but the CSS one doesn't?
- When is a duration-based animation the wrong model?
- What can View Transitions do that FLIP by hand can't?

<details>
<summary>Answers</summary>

**rAF vs CSS under load.** A rAF animation needs your callback to run each frame, and your callback
queues behind every other task on the main thread. A CSS/WAAPI animation of `transform`/`opacity` is
handed to the compositor once, with its keyframes and timing, and the compositor advances it
independently — no main-thread involvement per frame at all.

**When duration is wrong.** Anything interruptible or gesture-driven. If the user can grab a sheet
mid-animation and fling it, a duration model has no concept of the velocity it had, so the motion
resets and feels dead. Springs (or any velocity-preserving model) are the right abstraction there.
Duration is fine for discrete, uninterruptible state changes.

**View Transitions over hand-rolled FLIP.** It works across elements that are *removed and
re-created* (a card in a list becoming a detail page), which hand-rolled FLIP can't do without
keeping the old element alive; it handles the whole page as a snapshot, so unrelated content
cross-fades sensibly; and it works across *documents*, which no JavaScript technique can. It also
sidesteps the forced-layout reads FLIP requires.
</details>

---

## 🏗️ Build challenge

1. Inventory your animations and classify them by the decision list.
2. Replace rAF animations that are just "A to B" with WAAPI.
3. Replace scroll-handler animations with `animation-timeline`. Measure main-thread work before and
   after.
4. Add View Transitions to one route change, as progressive enhancement.
5. Add a global reduced-motion handler using `document.getAnimations()`.
6. Take a gesture-driven interaction and rebuild it with a spring. Compare interrupting both.

**Done when:** no animation in your app is driven by a scroll or resize handler.

---

## Interview questions

1. CSS animation vs WAAPI vs rAF — what does each cost and buy?
2. Why is a scroll-driven CSS animation better than a scroll listener?
3. What does `startViewTransition` actually do?
4. Why do springs feel better for interruptible motion?
5. How do you pause every animation on a page?
