# Lab 10 — Event listener leaks ⭐⭐⭐⭐

**Goal:** understand exactly when a forgotten `removeEventListener` leaks and when it doesn't — and
learn the two patterns (delegation, `AbortController`) that make the question moot.

**Primary metric:** detached node count and listener count after 10 mount/unmount cycles of 1,000
buttons.

---

## The concept, including the part that's usually taught wrong

The common advice is "always call `removeEventListener` or you'll leak." That's a useful habit, but
it's not the mechanism, and believing the wrong mechanism means you'll fix the wrong things.

**The truth:** a listener on a node is retained *by that node*. If the node becomes unreachable, the
node, its listeners, and their closures are all collected together. So this does **not** leak:

```js
const btn = document.createElement('button');
btn.addEventListener('click', () => console.log('hi'));
container.appendChild(btn);
container.innerHTML = '';    // btn unreachable → btn + listener + closure all collected
```

It leaks when something *else* keeps a reference alive:

1. **The target is long-lived.** `window`, `document`, `document.body`, an app-root element. These
   are effectively GC roots for your purposes, so the handler — and everything its closure captures
   — lives forever.
2. **The closure captures something long-lived that points back.** A handler registered on a
   short-lived node, but pushed into a module-level `handlers[]` array.
3. **You keep the node.** Any array/Map/cache of DOM references (Lab 09's leak 2). Then the node's
   listeners come along for the ride.
4. **Cross-document / cross-frame references.** A handler on a node in an iframe that's been removed.

So the real rules are: *listeners on long-lived targets must be removed*, and *don't hold DOM
references you don't need*. `removeEventListener` on a node you're about to drop is harmless but
usually unnecessary — and if you're relying on it, note that you can't remove an arrow function you
didn't keep a reference to, which is how this bug gets shipped.

Also worth knowing: **1,000 listeners is a cost even when nothing leaks.** Registration time, memory
per listener, and dispatch cost through a deep tree. Delegation isn't only a leak fix.

## Break it

`index.html` mounts 1,000 buttons with per-button listeners, in four flavours:

1. **`perNodeClean`** — per-button listener, nothing else holds the nodes. Mount/unmount 10×.
   *Prediction time: does this leak? Write your answer down before you measure.*
2. **`perNodeRetained`** — same, but the handlers are pushed into a module array. Leaks.
3. **`documentLevel`** — each button also registers a `document`-level listener that closes over the
   button. Leaks badly.
4. **`delegated`** — one listener on the container. Your target.

## Measure it

1. **Performance monitor** — watch the "Listeners" and "DOM Nodes" counters. Mount/unmount 10× in
   each mode and record.
2. **Memory → Detached elements** — the purpose-built view. Mount/unmount, force GC, then look. For
   each detached node it shows the retaining object.
3. **Heap snapshot** — search for `Detached HTMLButtonElement`. Click one, read the retainer chain.
4. `getEventListeners($0)` in the console (Chrome only) — inspect the listeners on a selected node.
5. Also measure the *non-leak* cost: time to mount 1,000 buttons with per-node listeners vs
   delegated. And dispatch time for a click in each.

| Mode | Listeners after 10 cycles | Detached nodes | Heap Δ | Mount time | Leaks? |
|---|---|---|---|---|---|
| 1 perNodeClean | | | | | |
| 2 perNodeRetained | | | | | |
| 3 documentLevel | | | | | |
| 4 delegated | | | | | |

Row 1 is the interesting one. If your prediction was wrong, that's the most valuable thing you'll
learn in this lab.

## Why does it leak?

Write the retainer chain for modes 2 and 3. Then answer:

1. Why doesn't mode 1 leak, given that no `removeEventListener` was ever called?
2. In mode 3, the *button* is detached but the *document* listener still fires on every click. What
   does the handler do, and what does that tell you about the cost of a leak beyond memory?
3. Mode 4 has one listener for 1,000 buttons. What did you give up, if anything?

## Fix it yourself

- [ ] **`AbortController` teardown.** Rewrite modes 2 and 3 so a single `ac.abort()` removes every
      listener. Prove with the Performance monitor that the listener count returns to baseline.
- [ ] **Delegation.** Implement mode 4 properly: one listener on the container, `event.target.closest()`
      to find the button, data attributes for the payload. Handle the case where a click lands on a
      child element inside the button.
- [ ] **Delegation's edge cases.** Now find where delegation *doesn't* work, and document each:
      `focus`/`blur` (why? and what's the fix?), `mouseenter`/`mouseleave`, `scroll` on inner
      elements, events on nodes inside a shadow root, and `stopPropagation()` from a third-party
      script between your container and the target. This list is a better interview answer than
      "just use delegation".
- [ ] **Measure delegation's cost.** With 1,000 delegated buttons, how long does one click take to
      dispatch and handle versus a direct listener? Is delegation ever slower? (Yes — find the case:
      think about high-frequency events and deep trees.)
- [ ] **Build the audit tool.** Write a dev-only script that patches `EventTarget.prototype.addEventListener`
      and `removeEventListener` to keep a live registry: target, type, and a capture stack. Then a
      `listenerReport()` function that prints the counts by target and type, and flags:
      - listeners on `window`/`document` added more than N times with the same type
      - listeners whose target is currently detached from the document
      Leave it in your project behind a flag. This finds real bugs.

<details>
<summary>Hint — why focus/blur break delegation</summary>

`focus` and `blur` don't bubble. But `focusin` and `focusout` do — that's the fix. Similarly,
`mouseenter`/`mouseleave` don't bubble; `mouseover`/`mouseout` do, but they fire on child transitions
too, so you need `relatedTarget` checks. Knowing which events bubble is the actual prerequisite for
delegation, and the list is worth memorising.
</details>

<details>
<summary>Hint — detecting detached listeners</summary>

```js
const registry = new Set();
const origAdd = EventTarget.prototype.addEventListener;
EventTarget.prototype.addEventListener = function (type, fn, opts) {
  registry.add({ target: new WeakRef(this), type, stack: new Error().stack });
  return origAdd.call(this, type, fn, opts);
};

function listenerReport() {
  for (const rec of registry) {
    const t = rec.target.deref();
    if (!t) { registry.delete(rec); continue; }               // collected — fine
    if (t instanceof Element && !t.isConnected) {
      console.warn('listener on detached element', rec.type, t, rec.stack);
    }
  }
}
```
Note the `WeakRef` — your audit tool must not itself retain the nodes it's auditing, or you've
built a leak detector that leaks. That trap is the interesting part of this exercise.
</details>

---

## 🏗️ Build challenge: a delegation-based interaction layer

Build the event system that a real component library needs — one root listener per event type for
the whole app.

```js
const events = createEventLayer(document.body);

events.on('click', '[data-action="delete"]', (e, el) => { … });
events.on('input', 'input[data-field]', (e, el) => { … });
events.on('focusin', '.field', (e, el) => { … });
events.once('click', '#accept', handler);
const off = events.on('keydown', '[role="menuitem"]', handler);
off();
```

**Requirements:**

1. **One native listener per event type**, no matter how many handlers are registered. Assert it.
2. Selector matching via `closest()`, with the matched element passed to the handler.
3. Correct handling of non-bubbling events: transparently map `focus`→`focusin`,
   `blur`→`focusout`, `mouseenter`→`mouseover` + `relatedTarget` filtering. The caller shouldn't
   have to know.
4. `{ passive: true }` by default for `wheel`/`touch*`, opt-out available.
5. `{ once: true }`, `{ capture: true }`, and priority ordering.
6. `stopPropagation()` semantics that make sense *within* your layer (a handler can stop later
   handlers for the same event) — decide the semantics deliberately and document them.
7. Shadow DOM: handle `composedPath()` so a click inside a shadow root can still match a
   light-DOM selector, and document the limits.
8. Full teardown: `events.destroy()` removes every native listener and clears every registry, and
   after it the app has zero listeners on `document.body`. Prove it with your audit tool from above.
9. A dev mode that warns about a handler count above a threshold per selector, and about selectors
   that never match anything (a real source of dead code).

**Then benchmark it** against per-node listeners for: mounting 10,000 interactive rows, dispatching
1,000 clicks, and a `mousemove`-heavy interaction. Report where delegation wins and where it loses.
The losing case is the one that shows you understand it.

**Done when:** 10,000 interactive elements are backed by ≤10 native listeners, `destroy()` returns
the listener count to zero, and you have a benchmark table including at least one case where
delegation is the wrong choice.

---

## Interview questions

1. Does forgetting `removeEventListener` always leak? Explain precisely when it does.
2. What retains a listener's closure?
3. How does `AbortController` help, and why is it better than matching removals?
4. Which common events don't bubble, and how do you delegate them anyway?
5. When is event delegation slower than direct listeners?
6. How would you find listeners attached to detached DOM nodes in a running app?
7. 1,000 buttons, each needing a click handler. What do you write, and why?
