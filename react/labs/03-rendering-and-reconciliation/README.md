# Lab 03 — Rendering & reconciliation ⭐⭐⭐⭐⭐

**Goal:** answer "why did this re-render?" and "why is my state wrong?" mechanically.

```sh
cd react-sandbox && npm run dev     # → #render
./serve.sh                          # and react/labs/07-mini-react/ for the implementation
```

---

## "Re-render" means "the function ran"

It does not mean the DOM changed. [Lab 07](../07-mini-react/) shows the gap directly: a state change
re-runs every child, and reconciliation then decides almost nothing needs writing.

That distinction organises everything else. Most React "performance work" targets *how many functions
ran*; most of the *cost* is in what the commit phase then has to do.

## The four things that trigger a re-render

1. its own state changed
2. its **parent** re-rendered (and it isn't memoised with equal props)
3. a **context** it consumes changed
4. a store it subscribes to changed

Note #2: **a child re-renders because its parent did, not because its props changed.** Props are only
consulted when the component is memoised. This is why "I only changed one prop" doesn't explain
anything by itself.

React DevTools → Profiler → enable "Record why each component rendered" answers this per commit, and
it's the first thing to reach for.

## Keys are identity

```js
if (element.key != null) match = oldByKey.get(element.key);   // matched by KEY
else if (oldFiber?.key == null) match = oldFiber;             // matched by POSITION
```

That's the whole mechanism, from the mini implementation. A key decides **which fiber** — and
therefore which hook state and which DOM node — the element continues.

Index keys are safe only for a list that is **append-only and never reordered, filtered or
prepended**. Otherwise state attaches to the wrong item — a data-corruption bug wearing a rendering
bug's clothes. And note the component is **reused**, not remounted, which is why nothing resets and
nothing looks obviously broken.

**Keys as a feature:** changing a component's `key` deliberately **remounts** it, resetting all its
state. That's the idiomatic way to reset a form when the edited record changes:

```jsx
<EditForm key={recordId} record={record} />
```

Cleaner than an effect that resets six pieces of state, and it's what the docs recommend.

## Reconciliation's two heuristics

React's diff is O(n) rather than the O(n³) a general tree diff would need, because it assumes:

1. **different element types produce different trees** — a `<div>` becoming a `<span>` throws the
   whole subtree away, state and DOM included
2. **keys identify children across renders**

Consequence worth knowing: conditionally rendering *the same component* through two different
branches of JSX can unmount and remount it, because its position in the tree changed. If you see
state resetting unexpectedly, look for a changed element type or a changed position — including a
wrapper that only sometimes appears.

## When memoisation helps and when it costs

Run the sandbox with **memo on** and **stable `onSelect` off**: every row re-renders on every
keystroke, because the callback prop is a new function each render. That's `memo` paying its full cost
and buying nothing — the most common way React memoisation is wasted.

| Reach for | When |
|---|---|
| `memo` + stable props | the list is short but re-renders often |
| **virtualization** | the list is long |
| `useTransition` / `useDeferredValue` | the work is blocking input |
| **nothing** | the component is cheap — the comparison can cost more than the render |

**The React Compiler changes the economics, not the model.** It inserts memoisation automatically and
correctly, removing most hand-written `memo`/`useCallback`/`useMemo`. It does not remove the need to
understand *why* something re-rendered.

Full treatment with numbers:
[web-vitals-and-react-perf lab 05](../../../web-vitals-and-react-perf/labs/05-react-render-perf/).

## Think about

- A component re-renders despite `memo`. Name three causes.
- When would you deliberately change a key?
- Why is React's diff O(n)?

<details>
<summary>Answers</summary>

**`memo` not working.** (1) An unstable prop — an object, array or function literal in the parent's
JSX. (2) `children` — JSX creates new element objects every render, so the comparison always fails.
(3) **Context** — `memo` compares props, and a context update bypasses props entirely. A fourth, less
common: a prop that's `NaN`, since `Object.is(NaN, NaN)` is true but many hand-written comparators get
it wrong.

**Deliberate key change.** To reset state on purpose: a form when the edited entity changes, a chart
when the dataset changes, a media player when the source changes, a component whose internal state is
meaningless after a prop change. It's the recommended alternative to an effect that resets state, and
it's one line.

**O(n) diff.** Because React doesn't attempt a general tree diff. It compares two trees level by
level, and assumes that a changed element type means a changed subtree (so it stops descending) and
that keys identify children (so reordering is a lookup rather than a search). Those two heuristics
turn an O(n³) problem into a single pass, at the cost of the two behaviours you have to know about:
type changes destroy state, and missing keys make reorders wrong.
</details>

---

## Interview questions

1. What are the four triggers for a re-render?
2. Does a child re-render because its props changed?
3. What exactly does a key decide?
4. When is changing a key the right tool?
5. Why is React's reconciliation O(n), and what do you give up for that?
