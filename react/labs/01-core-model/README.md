# Lab 01 — The core model ⭐⭐⭐⭐

**Goal:** know what you're actually creating when you write JSX.

```sh
cd react-sandbox && npm run dev     # any route; open the console
# and read react/labs/07-mini-react/mini-react.js §1
```

---

## Three things people conflate

| | Is | Lives |
|---|---|---|
| **element** | a plain object: `{type, props, key}` | created and thrown away every render |
| **component** | a function that returns elements | your code |
| **instance** | the **fiber** — the thing that holds state and the DOM node | React's internals |

```jsx
<Button size="lg">Save</Button>
// compiles to (classic runtime):
React.createElement(Button, { size: 'lg' }, 'Save')
// → { type: Button, props: { size: 'lg', children: 'Save' }, key: null }
```

**An element is a description, not a thing.** It's immutable, it's cheap, and creating one does not
render anything — which is why you can pass elements around as props and store them in arrays.

Under the **automatic runtime** (the default since React 17) JSX compiles to `_jsx(...)` imported
from `react/jsx-runtime`, which is why you no longer need `import React`. The shape of the element is
the same.

## What this explains

**`{children}` is just a prop.** `<Card><p>hi</p></Card>` puts the `<p>` element in
`props.children`. So a component that takes `children` is taking data, and
[lab 05](../05-patterns/)'s composition-over-configuration argument is really "prefer passing
elements over passing flags".

**Why `memo` around `{children}` rarely hits.** JSX creates **new element objects every render**, so
`props.children` is a new reference each time and the shallow comparison fails. That's not a bug in
`memo`; it's what an element is.

**Why conditional rendering with `&&` can print `0`.** `{count && <List/>}` renders `0` when count is
zero, because `0` is a valid React child (it's not `false`, `null` or `undefined`, which are the
values React skips). Use `count > 0 &&` or a ternary.

**Why `key` isn't in `props`.** `key` and `ref` are extracted by `createElement` onto the element
itself — they're instructions to React, not data for your component. Reading `props.key` gives
`undefined`.

## Events and StrictMode

**Synthetic events**: React attaches **one listener per event type at the root container** and
dispatches from there. Consequences: `e.stopPropagation()` stops React's propagation, not necessarily
a native listener you added yourself; events on portaled content still bubble through the React tree
(not the DOM tree); and event pooling — the thing you had to call `e.persist()` for — was removed in
React 17.

**StrictMode double-invokes** renders, effects and state updaters in development. It's not noise:
it's a deliberate check that your render is pure and your effect has a cleanup. A component that
breaks under StrictMode has a bug that will surface under concurrent rendering anyway.

## Think about

- Why can you store an element in a variable and render it twice?
- What's the difference between `<Foo/>` and `Foo`?
- Why does `memo` not help a component whose only prop is `children`?

<details>
<summary>Answers</summary>

**Storing and reusing an element.** Because it's an immutable description, not an instance. Rendering
the same element object in two places creates **two fibers** with independent state — the element is
the recipe, the fiber is the cake. This is what makes `const icon = <Icon/>` and then `{icon}` in
three places work, and why it doesn't share state between them.

**`<Foo/>` vs `Foo`.** `Foo` is the function. `<Foo/>` is an *element* whose `type` is that function
— React will call it. That distinction is why `<Component />` as a prop and `Component` as a prop are
different APIs (`renderIcon={<Icon/>}` vs `icon={Icon}`), and why passing the wrong one gives you
"Objects are not valid as a React child" or a component that never renders.

**`memo` and `children`.** JSX allocates a fresh element object for the children on every parent
render, so the `children` prop is never referentially equal and the shallow comparison always fails.
The fix isn't `useMemo` on the JSX — it's to move the memo boundary so the expensive part receives
*stable* props, or to render the children from inside the memoised component.
</details>

---

## Interview questions

1. What does JSX compile to, and what's in an element?
2. Element vs component vs instance.
3. Why isn't `key` available in `props`?
4. How does React's event system differ from native listeners?
5. Why does StrictMode double-invoke, and what does it catch?
