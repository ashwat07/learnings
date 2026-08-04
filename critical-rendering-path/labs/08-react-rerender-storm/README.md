# Lab 08 — Re-render 10,000 components ⭐⭐⭐⭐⭐

**Goal:** connect framework-level work to the browser pipeline. A React re-render isn't slow
because React is slow — it's slow because it hands the browser a pile of style, layout, and paint
work, on the main thread, on every keystroke.

**Primary metric:** keystroke → next paint (this is INP, and it's the metric that matters).

> Loads React 18 from a CDN, so the first run needs internet. No build step and no JSX — the
> components use `React.createElement` (aliased to `h`) so there's no Babel transform in the way of
> your traces. If you'd rather work in JSX, port it to Vite; the exercise is identical.

---

## The concept

React's job per update: run your components, diff, and commit DOM mutations. Then the *browser's*
job begins: style, layout, paint, composite — for everything React touched.

So a "React performance problem" is usually two problems stacked:

1. **React work**: 10,000 component functions called, 10,000 elements diffed. Pure JS, shows up as
   one long yellow task.
2. **Browser work**: whatever DOM changes the commit produced. If React sets a style or a class on
   10,000 nodes, you're now in Labs 04 and 05.

The React Profiler shows you (1). The Performance panel shows you (1) *and* (2). You need both, and
the interesting bugs live in the gap between them: a component that re-renders 10,000 times but
whose commit is empty (pure JS waste, invisible to Paint flashing), versus one that renders once but
commits a layout-invalidating change to a huge subtree.

## Break it

`app.js` renders 10,000 cards. The search input's value lives in the **top-level component**, so
every keystroke re-renders the entire tree. There are also three deliberate memoization-defeating
patterns hidden in it:

- an inline object prop (`style={{...}}`) recreated every render
- an inline arrow function prop recreated every render
- an expensive derived value (a sort) recomputed every render

Type in the search box. Feel the lag between your keystroke and the character appearing.

## Measure it

**React Profiler** (React DevTools → Profiler → gear → check "Record why each component rendered"):

1. Record. Type 5 characters. Stop.
2 . Read: number of commits, duration of each, and the flamegraph. Note how many components
   rendered per keystroke.
3. Use the **Ranked** view to find the most expensive components.
4. Click a component → "Why did this render?" This is the single most useful feature in the tool.

**Performance panel** (CPU 4×):

1. Record. Type 5 characters. Stop.
2. For one keystroke, measure: task duration, and within it — Scripting (React) vs Recalculate
   Style vs Layout vs Paint. Percentages.
3. Check the **Interactions** track — it shows input → paint latency directly. That's your INP.

| Metric | Broken | Fixed | Target |
|---|---|---|---|
| Components rendered per keystroke | 10,000+ | | < 10 |
| React commit duration | | | < 5ms |
| Keystroke → paint (Interactions track) | | | < 100ms |
| Scripting / Style / Layout / Paint split | | | |
| Longest task | | | < 50ms |

## Why is it slow?

Be precise, because the two halves have different fixes:

1. How much of the keystroke cost is React (component functions + diff) versus the browser (style,
   layout, paint of the committed changes)?
2. Which of the three memoization-defeating patterns costs the most? Fix them one at a time and
   measure — don't guess.
3. Here's the question that separates seniors: after you `React.memo` all 10,000 cards, is the
   keystroke fast? Measure it. If not, *why not* — what work remains when zero cards re-render?

## Fix it yourself

Work through these in order and record the metric after each. Resist doing them all at once; the
marginal-gain data is the learning.

- [ ] **Stable props.** Hoist the inline style object; wrap the callback in `useCallback`. Measure.
- [ ] **`useMemo` the derived value.** The sort shouldn't re-run on keystrokes that don't change the
      sorted data. Measure.
- [ ] **`React.memo` the card.** Measure. Then verify with the Profiler that cards actually stopped
      rendering — `memo` silently does nothing if a prop is still unstable, and this is the most
      common way people "add memo" and get no benefit.
- [ ] **State splitting** — the real fix. Move the input's state into its own component so the
      keystroke re-renders a subtree of one, not the whole app. Measure. Compare against the
      memoization approach: which gave you more, and which is less code?
- [ ] **Render fewer things.** Combine with Lab 05: virtualize the card list. Now you have 20 cards
      in the DOM instead of 10,000. Measure. Ask whether you still need the memoization at all.
- [ ] **`useDeferredValue` / `startTransition`.** Keep the input instant while the filtered list
      lags a frame behind. Measure the input latency specifically, and explain what concurrent
      rendering did and did not change (hint: it didn't make the work smaller).
- [ ] **The anti-pattern check.** Now go back and *remove* every memoization that turned out not to
      matter. Write down what you removed. "Memoize everything" is itself a performance bug —
      `useMemo` has a cost, and a codebase full of pointless `useCallback` is harder to read and
      slower to render.

<details>
<summary>Hint — why memo didn't help</summary>

`React.memo` does a shallow prop comparison. If you pass `style={{ color }}` or
`onClick={() => …}`, the prop is a fresh reference every render and the comparison always fails.
Check with the Profiler's "why did this render" — it will say "props changed: style".

Also: `memo` doesn't stop a re-render caused by `useContext` in the component, or by a state
change inside it.
</details>

<details>
<summary>Hint — state splitting</summary>

```js
// Before: one keystroke re-renders App and everything under it
function App() {
  const [query, setQuery] = useState('');
  return h('div', null, h('input', { value: query, onChange: … }), h(CardList, { query }));
}

// After: the input owns its own state; the list subscribes to a debounced/deferred copy
function SearchBox({ onCommit }) {
  const [local, setLocal] = useState('');
  …
}
```
The general principle: **state lives as low in the tree as the set of components that need it.**
Lifting state up is the default advice and it's how most of these bugs get created.
</details>

<details>
<summary>Hint — the honest answer about the remaining cost</summary>

Even with zero cards re-rendering, React still has to render `App` and reconcile its children
list — that's 10,000 element comparisons, cheap per item but not free. And if your filter changes
which cards are *mounted*, you're paying mount/unmount plus browser layout for the whole list.
That's why virtualization beats memoization here: it makes the work small instead of making the
work skippable.
</details>

---

## 🏗️ Build challenge: a spreadsheet in React that doesn't lag

Build a 200×26 grid (5,200 cells) with formulas. This is the classic "React can't do this" problem,
and it absolutely can.

**Features:**
- Click a cell to edit; type; Enter commits and moves down; Tab moves right; Escape cancels.
- Formulas: `=A1+B2*2`, `=SUM(A1:A10)`, `=AVG(...)`, with a real dependency graph.
- Editing a cell recalculates **only** its dependents (topological order), not the sheet.
- A cycle (`A1 = B1`, `B1 = A1`) shows `#CYCLE!` and doesn't hang.
- Shift-click range selection, copy/paste of a range as TSV.
- Undo/redo.
- A live "cells recalculated" and "components re-rendered" counter on screen.

**Hard constraints:**
1. Typing a character into a cell re-renders **at most 3 components**. Prove it with the Profiler
   and assert it in a test.
2. Keystroke → paint under 50ms at 4× CPU throttle.
3. The dependency graph lives outside React state (a plain module, a class, or a store) — React
   subscribes to slices of it. Consider `useSyncExternalStore`.
4. No `useMemo`/`useCallback` that you cannot justify with a before/after measurement. Every single
   one must have earned its place.
5. 5,200 cells rendered, but only visible rows in the DOM — combine with Lab 05's virtualization.

**Then the write-up**, which is the real deliverable: for each optimisation, the measurement that
justified it. And one section titled "things I tried that didn't help", with numbers. Engineers who
can produce that section get hired.

**Done when:** the counter shows ≤3 re-renders per keystroke, a `=SUM(A1:A200)` edit recalculates
only its dependents, and you can explain the difference between "React re-rendered" and "the
browser re-laid-out" while pointing at a trace.

---

## Interview questions

1. What are the two distinct costs of a React re-render? Which does the React Profiler show?
2. `React.memo` is added and nothing improves. Give three reasons.
3. Explain state colocation and why "lift state up" creates performance bugs.
4. What does `useDeferredValue` actually do to the work — does it make it smaller?
5. You have 10,000 rows and a filter input. Rank memoization, virtualization, and debouncing by
   impact, and explain the ranking.
6. When is `useMemo` a net negative?
7. A colleague says "React is slow, we should use Svelte." How do you respond with evidence?
