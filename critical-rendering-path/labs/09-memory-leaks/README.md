# Lab 09 — Memory leaks ⭐⭐⭐⭐⭐

**Goal:** get fluent with heap snapshots and retainer chains. A leak is not "memory went up" — it's
"memory that will never come down, and here is the reference chain proving why."

**Primary metric:** JS heap size and DOM node count after 60s, and whether they return to baseline
after a forced GC.

---

## The concept

JavaScript is garbage-collected: an object is freed when it's unreachable from a root (globals, the
stack, live DOM). A "leak" is therefore always a **reachability bug** — something is still holding a
reference you forgot about.

The five shapes that account for nearly every real leak:

| Shape | Example | Why it retains |
|---|---|---|
| Unbounded growth | appending nodes forever, an ever-growing array or `Map` cache | it's all still reachable, by design |
| Timers & intervals | `setInterval` whose callback closes over a component | the timer is a root; its closure keeps everything alive |
| Detached DOM | you removed a node but JS still holds it | the node — *and its entire subtree, plus its listeners* — stays alive |
| Listeners on long-lived targets | `window.addEventListener` in a component that unmounts | `window` is a root; the handler closure retains the component |
| Observers & subscriptions | `IntersectionObserver`, `ResizeObserver`, store subscriptions, `EventSource`, RxJS | the observer holds targets; the store holds the callback |

Also worth knowing: closures capture *variables in scope*, and engines are only sometimes smart
enough to trim unused ones. A closure that uses one small field of a huge object can retain the
whole object.

## Break it

`index.html` has six leaks you can turn on independently. Each one is a realistic pattern:

1. **`nodeFlood`** — the naive one from every tutorial: append a div every 100ms, forever.
2. **`detachedTree`** — build a 5,000-node subtree, remove it from the document, but keep it in an
   array. This is the leak that surprises people, because "I removed it".
3. **`intervalClosure`** — a "component" that starts an interval and is then thrown away without
   clearing it. Its closure retains a big buffer.
4. **`windowListener`** — a component that adds a `resize` listener and never removes it.
5. **`unboundedCache`** — a memo `Map` keyed by object, no eviction.
6. **`observerLeak`** — a `ResizeObserver`/`IntersectionObserver` that's never disconnected.

## Measure it

This is a snapshot-comparison drill. Learn this sequence; it's the actual professional workflow.

**The three-snapshot technique:**

1. Memory tab → Heap snapshot. Call it **Baseline**. (Taking a snapshot forces a GC first, which is
   why we use it as the reference point.)
2. Do the suspicious thing — turn a leak on, let it run 15s, turn it off.
3. Heap snapshot → **After**.
4. Do it again, then snapshot → **After 2**.
5. In **After 2**, switch the dropdown to **"Objects allocated between Baseline and After"** (or
   compare snapshots). Anything still alive that was allocated in step 2 is a leak candidate.
6. Click a candidate → **Retainers** pane at the bottom. Read the chain from the object up to a
   GC root. That chain *is* the bug. The variable name at the top of it is usually the fix.

**Other tools:**

- **Performance monitor** (⌘⇧P → "Performance monitor") — live JS heap, DOM nodes, listeners,
  detached nodes. Leave it open; the *shape* of the line tells you a lot (sawtooth = healthy GC;
  staircase = leak).
- **Performance panel** with "Memory" checked — heap over a recording, correlated with your code.
- **Memory → Allocation instrumentation on timeline** — shows allocations as bars; bars that stay
  grey-blue after GC are retained. Best for "which function allocated the thing that leaked".
- **Detached elements** view (Memory tab) — a purpose-built list of detached DOM nodes and what
  retains them. Use it for leaks 2 and 4.
- `performance.measureUserAgentSpecificMemory()` — for real-world monitoring, if available.

| Metric | Baseline | After 60s | After GC | Leaked? |
|---|---|---|---|---|
| JS heap (MB) | | | | |
| DOM nodes | | | | |
| Detached nodes | | | | |
| Listeners | | | | |

Fill this in **per leak**. Six rows. The point is that they look different: `nodeFlood` shows in DOM
nodes, `intervalClosure` only in the heap, `windowListener` only in detached nodes + listeners.

## Why does it leak?

For each of the six, write the **retainer chain** in words, from the leaked object to a GC root.
For example:

> `HTMLDivElement` ← `elements[]` array ← closure of `startDetachedLeak` ← `window.leakHandles`

If you can't write the chain, you haven't found the leak — you've found a symptom.

Then answer the sharp question: **in leak 2, why does keeping one reference to the root node retain
5,000 nodes rather than 1?**

## Fix it yourself

- [ ] Fix all six. Each fix should be small; if it isn't, you've misdiagnosed.
- [ ] For each fix, re-run the three-snapshot drill and prove the heap returns to baseline.
- [ ] **Build a teardown convention.** Write a `Disposable` helper — a thing that collects
      cleanup functions (`addEventListener` with an `AbortController` signal, timers, observers,
      subscriptions) and releases them all at once. Then refactor all six leaks to use it. This is
      the pattern that actually prevents leaks in a codebase; the individual fixes don't scale.
- [ ] **Explore `WeakMap`/`WeakRef`.** Rewrite leak 5's cache with a `WeakMap`. Then explain why
      `WeakMap` fixes it and why a `Map` with object keys cannot. Then explain why `WeakMap` is
      *not* a general leak fix (what happens when the key is a string?).
- [ ] **Try `FinalizationRegistry`** to log when your leaked objects are finally collected. Use it
      as a debugging tool, and then read why you must never use it for cleanup logic in production.
- [ ] **Write a regression test.** In a headless browser, take heap sizes before and after mounting
      + unmounting a component 100 times, force GC (`--js-flags=--expose-gc` or CDP
      `HeapProfiler.collectGarbage`), and fail if the heap grew more than a threshold. This is
      genuinely hard to make non-flaky — that difficulty is part of the lesson.

<details>
<summary>Hint — why detached nodes are so expensive</summary>

A DOM node holds references to its children, its attributes, its event listeners, and (in the C++
layer) its style and layout objects. Retaining the root of a detached subtree therefore retains all
of it. Worse: a detached node's listeners keep their closures alive, so a detached tree can retain
application state, network responses, and images.
</details>

<details>
<summary>Hint — AbortController for listeners</summary>

```js
const ac = new AbortController();
window.addEventListener('resize', onResize, { signal: ac.signal });
element.addEventListener('click', onClick, { signal: ac.signal });
observer.observe(el);                      // observers still need explicit disconnect
// teardown:
ac.abort();                                 // removes every listener registered with this signal
observer.disconnect();
```
One `abort()` removes them all. No matching `removeEventListener` calls with identical function
references — which is where the traditional approach fails, because people pass a bound or arrow
function and can't remove it.
</details>

<details>
<summary>Hint — the closure-capture subtlety</summary>

```js
function makeHandler(hugeResponse) {
  const id = hugeResponse.id;               // only this is needed
  return () => console.log(id);             // …but does the closure still retain hugeResponse?
}
```
Try it. Take a snapshot and look. Engines do escape-analysis on closure environments, but the
behaviour differs between V8 versions and between optimised and unoptimised code. The safe habit:
extract what you need before creating the closure, and don't rely on the optimiser.
</details>

---

## 🏗️ Build challenge: a leak-hunting harness for a real SPA

Leaks don't show up in a lab; they show up after 40 minutes of a user clicking around. So build the
thing that finds them automatically.

**Part 1 — the leaky app.** Build a small SPA with 5 routes, using no framework: a dashboard with
polling, a chart that subscribes to a WebSocket (or a fake one), a list with `IntersectionObserver`
lazy loading, a modal that adds document-level listeners, and a settings page with a `ResizeObserver`.
Write it the way a rushed team would — leak in at least four places, and *don't* write down where.

**Part 2 — the harness.** Using Playwright/Puppeteer + CDP:
1. Navigate a loop: route A → B → C → D → E → A, 50 times.
2. After each cycle: `HeapProfiler.collectGarbage`, then read `JSHeapUsedSize`, DOM node count,
   listener count, and detached node count.
3. Plot the series. A healthy app is flat-with-sawtooth; a leaky one is a staircase.
4. When a leak is detected, take a heap snapshot and **automatically extract the retainer chains**
   for the top N growing constructors. Print them as a report.
5. Fail CI with a report that names the retaining variable.

**Part 3 — now find your own leaks with it**, then fix them, then confirm the harness goes green.
Come back a week later and see if you can still read the report.

**Done when:** the harness detects all four of your planted leaks without you telling it where they
are, and its output is specific enough that someone else on your team could fix them from the report
alone.

---

## Interview questions

1. What is a memory leak in a garbage-collected language, precisely?
2. Walk me through the three-snapshot technique.
3. What's a retainer chain and why is it the answer rather than a clue?
4. Why does `setInterval` leak, and does `setTimeout`?
5. `WeakMap` vs `Map` — when does the weak version actually help?
6. I removed a DOM node and memory didn't drop. What are the possibilities?
7. How would you catch leaks in CI, and why is that test prone to flaking?
