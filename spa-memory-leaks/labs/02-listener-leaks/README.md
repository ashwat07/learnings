# Lab 02 — Listener leaks ⭐⭐⭐⭐⭐

**Goal:** never write an un-removable listener again, and be able to prove in ten seconds whether
a page has any.

**Primary metric:** how many handlers run on a single scroll event after N mount/unmount cycles.

> Open <http://localhost:8080/spa-memory-leaks/labs/02-listener-leaks/>

---

## The concept

A listener registered on `window`, `document`, or any element that outlives your component is a
strong reference chain:

```
Window → EventListener → your handler → its closure → your component → its state + its DOM
```

Unlike a detached node, it also **keeps running**. After 50 mount/unmount cycles, one scroll event
runs 50 dead handlers. The page gets slower the longer the session lasts, which users report as
"it degrades over time" — and which nobody can reproduce in a fresh tab.

## Measure it

| Run | Handlers fired on one scroll | Heap |
|---|---|---|
| A. no cleanup | | |
| B. manual cleanup (one forgotten) | | |
| C. AbortController | | |

## The fix

```js
const ac = new AbortController();

window.addEventListener('resize', () => this.recompute(), { signal: ac.signal });
document.addEventListener('keydown', onKey, { signal: ac.signal });
el.addEventListener('click', onClick, { signal: ac.signal });
const res = await fetch(url, { signal: ac.signal });      // the same signal

// unmount:
ac.abort();
```

Why it's strictly better than `removeEventListener`:

- **You can't mismatch the reference.** Inline arrow functions are fine. `removeEventListener`
  with a different function silently removes nothing — no error, no return value, no way to
  notice.
- **You can't forget one.** They share the signal.
- **It composes**: `AbortSignal.any([parentSignal, ownSignal])` ties a child's lifetime to its
  parent's. `AbortSignal.timeout(5000)` gives you a deadline.
- **It's one token for the whole component** — listeners, fetches, observers (via your own
  wrapper), timers (via your own wrapper).

Make it the house rule: **every `addEventListener` on anything longer-lived than the element
itself takes a signal.**

## Why manual cleanup fails in practice

```js
// silently removes nothing — a new arrow function each time
el.addEventListener('click', () => this.go());
el.removeEventListener('click', () => this.go());

// silently removes nothing — .bind() returns a NEW function each call
el.addEventListener('click', this.go.bind(this));
el.removeEventListener('click', this.go.bind(this));

// doesn't match — capture must be the same
el.addEventListener('click', fn, { capture: true });
el.removeEventListener('click', fn);
```

Plus the organisational failure: cleanup lives in a different function from registration, so
somebody adds a fourth listener and updates one of the two lists. Run demo B and note that only
two of three were removed — that's the realistic case, not a strawman.

## Ten-second detection

- `getEventListeners(window)` in the console (DevTools-only). Look at `.scroll.length`,
  `.resize.length`. If it grows as you navigate, that's the leak.
- Elements panel → select a node → **Event Listeners** tab, with *Ancestors* ticked.
- In a heap snapshot, the retainer chain reads `… ← context ← EventListener ← Window`.

## `{ once: true }` and passive listeners

`{ once: true }` removes itself after firing — perfect for one-shot handlers and it can't leak.
`{ passive: true }` is about scroll performance, not leaks (see the critical-rendering-path
course), but it's the other option people confuse with a fix.

## Think about

- Why doesn't a listener on the element itself leak when the element is removed?
- Your framework removes DOM listeners for you. Which ones does it not remove?
- You inherit a codebase with hundreds of `addEventListener` calls. How do you find the leaks?

<details>
<summary>Answers</summary>

**Listeners on the element itself.** When a node becomes unreachable, its listeners go with it —
the node holds the listener, not the other way round. So `el.addEventListener('click', fn)` on a
node you're about to discard is fine. The leak is registering on something that *outlives* the
component: `window`, `document`, `body`, a portal root, a shared store.

**What frameworks don't remove.** They remove listeners *they* attached via their own binding
syntax (`onClick={…}`). They know nothing about listeners you attached imperatively in an effect
or a lifecycle hook to `window`/`document`, about observers, about timers, or about subscriptions
to a global bus. Everything you attach by hand, you clean up by hand — or with a signal.

**Auditing a codebase.** (1) Grep for `addEventListener` and check each against a
`removeEventListener` or a signal in the same module. (2) Add a dev-mode wrapper that patches
`EventTarget.prototype.addEventListener` and logs registrations without a signal on
`window`/`document`, with a stack. (3) Use the automated cycle test from lab 01 on each route.
The wrapper finds it fastest, and is lab 06's build challenge.
</details>

---

## 🏗️ Build challenge: a listener budget

Build `listener-guard.js` — a dev-mode tool that makes this class of bug impossible to ignore.

```js
installListenerGuard({
  warnOnUnsignalled: true,          // window/document listeners without an AbortSignal
  budget: { window: 20, document: 30 },
  onExceeded: (report) => console.error(report),
});
```

Requirements:

1. Patch `EventTarget.prototype.addEventListener`/`removeEventListener` in dev only, keeping a
   registry: target, type, whether a signal was passed, and a captured stack.
2. Warn when a `window`/`document` listener is added **without** a signal — that's the rule
   violation, and the stack tells you exactly where.
3. Track counts per target per type; when a count exceeds its budget, report the **top registration
   stacks** so the culprit is named rather than counted.
4. Detect duplicate registrations of *equivalent* handlers (same function source at the same
   stack) — that's the "mounted twice, cleaned once" pattern.
5. `report()` returning current counts, and a diff against a saved baseline so you can run it
   around a navigation: `const before = snapshot(); await navigate(); diff(before)`.
6. Zero overhead when disabled, and no interference with `once`, `capture`, `passive` or signals.
   **Test that** — a guard that breaks listener semantics gets ripped out on day two.

**Done when:** navigating your app between two routes ten times produces a clean report, and
deliberately removing one cleanup produces a report naming the file and line.

---

## Interview questions

1. Why does a `window` listener keep a whole component alive?
2. What's wrong with `el.removeEventListener('click', () => this.go())`?
3. What does `AbortController` give you that `removeEventListener` doesn't — name four things.
4. Which listeners does your framework clean up, and which does it not?
5. What's the fastest way to check a page for listener leaks?
6. A page gets slower the longer it's open, but memory looks flat-ish. What's your hypothesis?
