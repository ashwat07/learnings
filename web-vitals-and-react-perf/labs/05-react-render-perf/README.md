# Lab 05 — React render performance ⭐⭐⭐⭐⭐

**Goal:** answer "why did that click render 400 components?" with a number, and know when
memoisation is costing more than it saves.

**Primary metric:** the render tally in the sandbox header.

```sh
cd react-sandbox && npm install && npm run dev
# then http://localhost:5173/#render-perf
```

> Source: [`react-sandbox/src/routes/render-perf.jsx`](../../../react-sandbox/src/routes/render-perf.jsx).
> **StrictMode is on deliberately** — renders and effects are double-invoked in dev. If the numbers
> look doubled, that's why, and it's the honest number to think about.

---

## The four questions, in order

| # | Question | Tool |
|---|---|---|
| 1 | Is it rendering more than it needs to? | `memo`, keys, context shape |
| 2 | Is each render expensive? | `useMemo`, virtualization, less work |
| 3 | Is the work blocking input? | `useTransition`, `useDeferredValue` |
| 4 | **Is memoising costing more than it saves?** | measure — it often is |

Question 4 is the one that gets skipped. `memo` isn't free: it stores previous props and runs a
shallow comparison on every render. For a component that renders in 0.05ms, the comparison costs
more than the render.

## Experiment 1 — `memo` with an unstable prop

Turn **memo() the rows** on. Turn **stable onSelect** off. Type in the filter.

Every row re-renders on every keystroke. `memo` compared props, found a new function identity, and
re-rendered anyway — **`memo` paying its full cost and buying nothing.** This is the most common way
React memoisation is wasted in real codebases.

```jsx
const stable = useCallback((id) => setSelected(id), []);   // one identity, forever
const unstable = (id) => setSelected(id);                  // new identity every render
```

**The rule:** `memo` on the child requires stable props from the parent. `memo` without
`useCallback`/`useMemo` on the props above it is decoration. And the converse — `useCallback`
without a memoised consumer — is pure overhead.

> **React Compiler changes the economics, not the model.** It inserts memoisation automatically and
> correctly, which removes most hand-written `memo`/`useCallback`/`useMemo`. It does not remove the
> need to understand *why* a component re-rendered — and everything in this lab is still how you
> diagnose it.

## Experiment 2 — count vs cost

Set **ms per row** to 1 and rows to 2000. Now turn **virtualize** on.

Rendering 2,000 rows and rendering 40 rows produce the same screen. Virtualization is the fix that
scales, and it's the one people reach for last, after exhausting memoisation that can't help — a
memoised component that's actually mounted still costs layout, paint, and memory.

**Reach for virtualization when the list is long. Reach for `memo` when the list is short but
re-renders a lot.** They solve different problems.

## Experiment 3 — keys are a correctness bug

Scroll to the **keys** panel. Type into a row's input, then **prepend a row**.

With index keys the text stays with the *position*; with stable ids it follows the *row*. React
matched children by key, decided the component at index 0 was the same component, and just patched
the props it thought changed.

**Index keys are safe only when the list is append-only and never reordered, filtered, or
prepended.** Otherwise they cause state to attach to the wrong item — a data-corruption bug that
looks like a rendering glitch. The mount counter in the panel shows components being *reused* rather
than remounted.

## Experiment 4 — responsiveness under load

Set rows to 5000 with a per-row cost, then type. Now turn on **useDeferredValue**.

The input stays responsive because React renders the urgent update (the input value) immediately and
the expensive one at lower priority, interrupting it if you type again.

| Hook | Use when |
|---|---|
| `useTransition` | you own the state setter — wrap the *update* |
| `useDeferredValue` | you receive a value as a prop — defer the *value* |

Neither makes anything faster. They change *what the user waits for*, which is what INP measures.

## Diagnosing in real code

| Tool | Answers |
|---|---|
| React DevTools Profiler → "why did this render?" (enable in settings) | props / state / context / parent |
| Highlight updates on render | what re-renders when you didn't expect it |
| `<Profiler onRender>` | actualDuration vs baseDuration — how much memoisation is buying |
| Performance panel, User Timings | where React's work sits among everything else |

## The context invalidation rule

A Context provider re-renders **every** consumer when its value changes, however small the change —
see [architecture-and-state lab 02](../../../architecture-and-state/labs/02-state-strategy/) and the
`#state-strategy` route, where a theme toggle re-renders a component that only reads `query`.

**One context = one invalidation unit.** Split contexts by change frequency, or use a store with
selectors.

## Think about

- When is `memo` a pessimisation?
- Is `useMemo(() => x * 2, [x])` worth it?
- Your component re-renders on every parent render despite `memo`. Name three causes.

<details>
<summary>Answers</summary>

**`memo` as pessimisation.** When the component is cheap to render (the comparison costs more than
the render), when its props change on every render anyway (the comparison always fails), or when it
has many props (a shallow compare over 15 keys, every render, forever). The measurement that settles
it is `<Profiler>`: compare `actualDuration` with and without.

**`useMemo` for arithmetic.** No. You've added a dependency array, an allocation, and a comparison
to save a multiply. `useMemo` earns its keep for expensive computation *or* for referential
stability that something downstream depends on — and in the second case the value's cost is
irrelevant; you're memoising the identity, not the work. Be explicit about which reason applies,
because they have different rules for when you can remove it.

**Three causes of `memo` not working.** (1) An unstable prop — a new object/array/function literal
in the parent's JSX. (2) `children` — JSX creates new element objects every render, so
`memo(Wrapper)` around `{children}` almost never hits. (3) Context — `memo` doesn't stop a re-render
triggered by a context the component consumes; that path bypasses props entirely.
</details>

---

## 🏗️ Build challenge

1. Instrument your slowest real screen with `<Profiler>` and log `id, phase, actualDuration,
   baseDuration` for a typical interaction.
2. Find the component with the worst `actualDuration × render count`. That's your target — not the
   one that "feels" slow.
3. Apply the correct fix: fewer renders (`memo` + stable props, or split the context), cheaper
   renders (virtualization), or deferred renders (`useTransition`).
4. Re-measure with the **same** interaction and CPU throttle.
5. Add a regression test: React Testing Library plus a render counter, asserting that typing one
   character renders the list component at most N times.

**Done when:** you can state, per fix, how many renders you removed and how many milliseconds that
was worth.

---

## Interview questions

1. What does `React.memo` compare, and what breaks it?
2. Why is `useCallback` pointless without a memoised consumer?
3. What actually goes wrong with index keys?
4. `useTransition` vs `useDeferredValue`.
5. Why does a Context update re-render consumers that don't read the changed field?
6. When does virtualization beat memoisation?
