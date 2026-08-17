# Memory leaks in SPAs ⭐⭐⭐⭐⭐

A leak is not "memory is high". A leak is **memory that grows with usage and never comes back**.
In a single-page app the usage is route changes, list re-renders, modals opened and closed — so
the leak is measured in "megabytes per navigation", and it shows up as a page that is fine for
ten minutes and unusable after an hour.

```sh
./serve.sh    # then http://localhost:8080/spa-memory-leaks/labs/01-detached-nodes/
```

> The critical-rendering-path course has two related labs (09 memory leaks, 10 listener leaks).
> This course is about the SPA-specific shapes and, most of all, the **workflow** for finding them.

---

## The model

JavaScript is garbage collected: an object is freed when it is **unreachable from a GC root**
(the global object, the stack, active DOM). Everything about leaks reduces to one question:

> **What is still holding a reference to this?**

The five things that hold references in an SPA, in the order you'll meet them:

| Retainer | Shape |
|---|---|
| The DOM | A detached subtree kept alive by one JS reference to any node in it |
| Listeners | `addEventListener` on `window`/`document`/a long-lived element, never removed |
| Timers & observers | `setInterval`, `IntersectionObserver`, `ResizeObserver`, `MutationObserver` never cleared |
| Closures | A callback that captures a large scope and outlives it |
| Caches & registries | A `Map` that only ever grows; an event bus with no unsubscribe |

And the two things that make them *SPA* problems specifically: **nothing ever reloads the page**,
so every leak accumulates for the session; and **components mount and unmount constantly**, so
every missing cleanup runs hundreds of times.

## The measurement discipline

You cannot debug a leak without a repeatable cycle. Every lab here uses the same shape:

```
1. Do the action once   (warm up: lazy init, JIT, first-render allocations)
2. Take a heap snapshot (this forces a GC)
3. Do the action N times
4. Take another snapshot
5. Compare: did the object count grow by ~N?
```

The **three-snapshot technique** is the standard: snapshot → action → snapshot → action →
snapshot, then look at objects allocated between 1 and 2 that are **still alive** at 3. DevTools
does this for you with the "Objects allocated between snapshots" filter.

The two numbers that matter:

- **Retained size** — how much would be freed if this object were released. This is the number
  you care about; "shallow size" almost never is.
- **Distance** — how many references from a GC root. A large object at distance 2 is usually
  something global you forgot.

## Curriculum

| # | Lab | Shape | ⭐ |
|---|---|---|---|
| 01 | [Detached DOM nodes](labs/01-detached-nodes/) | The most common SPA leak, and the easiest to see | ⭐⭐⭐⭐⭐ |
| 02 | [Listener leaks](labs/02-listener-leaks/) | `addEventListener` without a matching remove, and the `AbortController` fix | ⭐⭐⭐⭐⭐ |
| 03 | [Timers & observers](labs/03-timers-and-observers/) | The ones that keep *running*, not just keep memory | ⭐⭐⭐⭐ |
| 04 | [Closures & caches](labs/04-closures-and-caches/) | Unbounded Maps, and what `WeakMap`/`WeakRef` actually solve | ⭐⭐⭐⭐⭐ |
| 05 | [Framework leaks](labs/05-framework-leaks/) | Effects, subscriptions, stale refs, a leaking router | ⭐⭐⭐⭐⭐ |
| 06 | [The detection workflow](labs/06-detection-workflow/) | Snapshots, allocation timelines, and a leak detector you can ship | ⭐⭐⭐⭐⭐⭐ |

## DevTools setup

- **Memory panel** → *Heap snapshot* (what's retained) and *Allocation instrumentation on
  timeline* (what's being allocated, and by which stack).
- The **Detached** filter in a heap snapshot's class list — Chrome now groups detached nodes
  explicitly, which turned lab 01 from an afternoon into a minute.
- **Performance monitor** (⋮ → More tools) — live JS heap size and DOM node count. The DOM node
  count going up and never down is the fastest possible leak signal.
- **Incognito, no extensions.** Extensions leak, and their leaks appear in your snapshots.
- `performance.measureUserAgentSpecificMemory()` for field measurement (requires cross-origin
  isolation — the lab server adds the headers with `?isolate=1`).
