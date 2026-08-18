# Lab 05 — Patterns ⭐⭐⭐⭐⭐

**Goal:** design a component API that survives its second and third requirement.

```sh
cd react-sandbox && npm run dev     # → #patterns
```
> Source: [`react-sandbox/src/routes/patterns.jsx`](../../../react-sandbox/src/routes/patterns.jsx)

---

## 1. Configuration vs composition

The configured card needs a new prop for every new requirement. The composed one needs nothing — a
caller who wants two footer buttons, or an icon in the title, just writes it.

> **If a prop exists only to be passed into a slot, make it a slot.**

Configuration is right when the option set is genuinely **closed** and you want to constrain callers
(a Button's `variant`). Composition is right when it's open.

The smell: a component with more than ~7 props, or any prop named `showX`, `xText`, `xAlign`,
`renderX`.

## 2. Compound components

```jsx
<Tabs defaultValue="a">
  <Tabs.List><Tabs.Tab value="a">First</Tabs.Tab></Tabs.List>
  <Tabs.Panel value="a">…</Tabs.Panel>
</Tabs>
```

Parts share state through context, so the caller wires nothing — and because the ids come from
`useId`, **the ARIA relationships are correct without the caller knowing they exist.**

That's the strongest argument for the pattern: accessibility is handled once, in the component, rather
than by every consumer ([accessibility lab 06](../../../accessibility/labs/06-testing-and-architecture/)).

Two implementation notes: memoise the context value (or every consumer re-renders on every parent
render), and **throw a named error** when a part is used outside its parent. A compound component with
an implicit contract needs a loud failure, or a misplaced `<Tabs.Tab>` is a blank screen and an hour of
debugging.

## 3. Controlled, uncontrolled, or both

```js
function useControllableState({ value, defaultValue, onChange }) {
  const [uncontrolled, setUncontrolled] = useState(defaultValue);
  const isControlled = value !== undefined;
  const current = isControlled ? value : uncontrolled;
  const set = (next) => { if (!isControlled) setUncontrolled(next); onChange?.(next); };
  return [current, set];
}
```

Ten lines, and it's what every serious component library ships. The rule it encodes:
**`undefined` means uncontrolled.**

Which is why you must never pass `value={undefined}` to mean "empty" — you've silently switched modes.
React's "a component is changing an uncontrolled input to be controlled" warning is almost always
`value={data?.field}` before the data arrives. Use `?? ''`.

## 4. Render props and HOCs, honestly

Hooks replaced both **for sharing logic** — that's what they were designed for.

What render props still do better: **sharing logic that must be tied to a piece of JSX** — a
virtualized list that gives you an index, a form field that gives you props to spread, a drop zone
that needs to own its element.

HOCs survive mostly at framework boundaries (`memo`, `forwardRef`, `connect`). Their costs: an extra
tree layer, lost static typing unless you work at it, a wrapper name in DevTools, and ref forwarding
you have to remember. Prefer a hook; reach for an HOC to wrap a component you don't control.

## 5. Headless components

```js
const d = useDisclosure();
<button {...d.getTriggerProps()}>Details</button>
<div {...d.getContentProps()}>…</div>
```

The hook owns **state, behaviour and accessibility**; the caller owns **markup and styles**. That
split is why Radix, Headless UI, TanStack Table and React Aria are shaped this way: the hard,
easily-got-wrong part is reusable, and the part every design system wants to control isn't.

The **prop-getter** convention exists so the library can add attributes later without a breaking
change, and so callers can merge their own handlers — a good getter *composes* user props rather than
overwriting them.

## Choosing

| Need | Pattern |
|---|---|
| share logic | a **hook** |
| a fixed set of visual variants | props |
| open-ended content | **composition** (slots / children) |
| several parts sharing implicit state | **compound components** |
| logic tied to a specific element | render prop |
| behaviour + a11y, styles fully free | **headless hook + prop getters** |
| wrap something you don't control | HOC |

## Think about

- Your `<Modal>` has 12 props. What do you do?
- Why memoise a compound component's context value?
- When is a render prop still the right answer?

<details>
<summary>Answers</summary>

**12 props.** Split it into slots: `<Modal><Modal.Header/><Modal.Body/><Modal.Footer/></Modal>`. Then
look at what remains — the genuinely closed options (`size`, `dismissible`) stay props, and anything
that was a `renderX` or an `xText` becomes children. Also check whether some props are *behaviour*
that belongs in a hook, so a caller who needs a completely different modal shell can reuse the logic.

**Memoising the context value.** Because a new object identity re-renders every consumer, even if the
contents are identical — and a compound component's provider re-renders whenever the *caller*
re-renders. Without `useMemo`, every parent render invalidates every part. It's the same context
granularity issue as [lab 04](../04-state-data-and-types/), just inside your own component.

**Render props today.** When the consumer needs to render something *and* the library needs to control
where and how many times: a virtualized list calling you per visible row, a table calling you per
cell, a drag source that must own its element and give you its state. A hook can't do that, because a
hook can't decide where your JSX goes.
</details>

---

## Interview questions

1. When is configuration better than composition?
2. What do compound components buy beyond ergonomics?
3. What does `undefined` mean for a controlled prop, and what bug does that cause?
4. Did hooks make render props obsolete?
5. What's a prop getter and why not just return an object of attributes?
