# Lab 01 — Detached DOM nodes ⭐⭐⭐⭐⭐

**Goal:** find a detached-node leak in a heap snapshot in under a minute, and name the exact
variable holding it.

**Primary metric:** detached node count and retained size after N cycles.

> Open <http://localhost:8080/spa-memory-leaks/labs/01-detached-nodes/> in **incognito** with the
> Memory panel open.

---

## The concept

Removing a node from the document does not free it. It's freed when nothing in JavaScript
references it *or any node in its subtree* — because every node points at its parent, its
children and its siblings.

```
view.textContent = '';          // 500 rows removed from the document
rows.push(...nodes);            // …and all 500 still referenced. Detached, immortal.

selected = nodes[0];            // ONE node kept
                                // → its parentNode → all 500 siblings. Same leak.
```

That second case is the one people get wrong. **Retained size is what matters**: a 200-byte node
can retain 8MB.

## The workflow (do it now, on this page)

1. Memory panel → **Take heap snapshot**. (Snapshotting forces a full GC first — which is why "the
   leak went away when I snapshotted" means it was never a leak.)
2. Run **A. leak: keep nodes in an array** with 20 cycles.
3. Take another snapshot.
4. In the second snapshot, set the dropdown to **Objects allocated between snapshot 1 and 2**.
5. Type `Detached` in the class filter.
6. Click a node. Read the **Retainers** pane at the bottom: it shows the chain from a GC root to
   this node.

The retainer chain is the answer. It will read something like
`Detached HTMLDivElement ← elements[3] in Array ← leaked in Object ← Window`. That names the
variable.

| Run | Detached nodes | Retained size | Retainer chain |
|---|---|---|---|
| A. array | | | |
| B. cache Map | | | |
| C. one child | | | |
| D. closure | | | |
| E. clean | | | |

## The four shapes

**A — "keep the rendered rows so we can update them later."** Written for a good reason, never
cleaned on unmount.

**B — "cache the element by id so lookups are fast."** A `Map` holds keys *and* values strongly.
`WeakMap` keyed *by the node* would be safe; a `Map<string, Node>` is not, and that's the shape
people write. Lab 04 goes deeper.

**C — "we only keep the selected row."** One node retains its parent, therefore the whole tree.
Also true of a stored `Event` object (`event.target` → node → tree).

**D — a closure over a container.** The array holds functions of a few hundred bytes; each closes
over a whole detached tree. The hardest to see, because the retainer looks trivial. In a snapshot
the chain runs through a `context` object — that's the closure scope, and expanding it shows every
captured variable.

## Faster signals than a heap snapshot

- **Performance monitor** (⋮ → More tools → Performance monitor): live *DOM Nodes* and *JS heap
  size*. If DOM node count rises during navigation and never comes down, you have this leak. It
  takes ten seconds to check and it's the first thing to do.
- **`getEventListeners($0)`** in the console (DevTools-only) — lists listeners on the selected
  element, which is lab 02's signal.
- In a test: `performance.memory.usedJSHeapSize` before/after N cycles. Coarse, Chrome-only, fine
  for a trend.

## Think about

- Why does keeping one child retain the whole tree, and what would you keep instead?
- Your framework "unmounts" a component but memory still grows. Where do you look first?
- Why does a heap snapshot sometimes make the leak disappear?

<details>
<summary>Answers</summary>

**One child.** `node.parentNode` is a strong reference upwards, and the parent references every
child. If you need to remember a selection, store the **id** (a string) and look the node up when
you need it — a primitive can't retain anything. That single habit prevents most of this lab.

**Unmounted but growing.** Look for something *outside* the component holding a reference into it:
a global event bus subscription, a module-level cache, a `window`/`document` listener, an observer,
a timer, or a promise chain that hasn't settled. The framework can only clean up what it owns; a
reference you handed to a global is not something it owns.

**Snapshot makes it disappear.** Because snapshotting forces a full GC. If memory drops to
baseline afterwards, the objects were garbage awaiting collection — high memory, not a leak. A
real leak survives the GC by definition; that's what makes it a leak.
</details>

---

## 🏗️ Build challenge: a leak test you can run in CI

Manual snapshot comparison doesn't scale. Automate it.

Build `leak-test.mjs` using Puppeteer/Playwright + the Chrome DevTools Protocol:

```js
await expectNoLeak(page, {
  action: () => page.click('#open-modal').then(() => page.click('#close-modal')),
  cycles: 30,
  warmup: 3,
  tolerance: { nodes: 5, bytes: 200_000 },
});
```

Requirements:

1. Use CDP (`HeapProfiler.collectGarbage`, `Runtime.getHeapUsage`, `Performance.getMetrics`) to
   force a real GC and read node count + heap size. Warm up first — the first few cycles allocate
   lazily-initialised things that never repeat, and counting them produces false positives.
2. Assert on **growth per cycle**, not absolute size, using a linear fit over N cycles. A slope
   near zero is fine; a slope of 300 nodes/cycle is a leak. This is much more robust than
   comparing two numbers.
3. On failure, capture a heap snapshot artifact **and** parse it to report the top retainer paths
   automatically — a failing test that just says "memory grew" gets ignored.
4. Run it against a real page of your app for: open/close a modal, navigate between two routes,
   open/close a dropdown 50 times, and mount/unmount a list.
5. Keep it fast enough to run on every PR (under ~30s), or it won't run at all.

**Done when:** it fails on this lab's leaky buttons, passes on the clean one, and finds at least
one real leak in an app you didn't write for this exercise.

---

## Interview questions

1. What makes a DOM node "detached", and when is it freed?
2. You keep one row of a 1,000-row list. How much memory is retained?
3. What's the difference between shallow size and retained size?
4. How do you find what's holding a detached node?
5. Memory drops to baseline after you take a snapshot. Is that a leak?
6. What's the fastest signal that an SPA is leaking DOM nodes?
