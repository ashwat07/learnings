# Lab 02 — Hooks in depth ⭐⭐⭐⭐⭐

**Goal:** the six things people get wrong, each with the number that proves it.

```sh
cd react-sandbox && npm run dev     # → #hooks
```
> Source: [`react-sandbox/src/routes/hooks.jsx`](../../../react-sandbox/src/routes/hooks.jsx)

---

## 1. Batching and functional updates

```js
setCount(count + 1); setCount(count + 1); setCount(count + 1);   // +1
setCount(c => c + 1); setCount(c => c + 1); setCount(c => c + 1); // +3
```

Three calls closing over the same stale `count` all say "set it to `count + 1`". Three **updaters**
each receive the pending value.

Both cause **one render**. Since React 18 batching is automatic everywhere — timeouts, promises,
native handlers — where React 17 only batched inside its own event handlers.

**The rule:** if the new value depends on the old one, use an updater. Always.

## 2. Effect timing

```
React mutates the DOM → useLayoutEffect (sync, blocks paint) → browser paints → useEffect
```

Use a layout effect only to **measure or fix up the DOM before it's seen** — everything else belongs
in `useEffect`, because a layout effect blocks the frame. In SSR it doesn't run at all and warns,
which is why measurement-dependent code needs a fallback.

## 3. The stale closure

The interval with `[]` deps is stuck at the first render's `count`, forever. This is the same
mechanism as [javascript lab 01](../../../javascript/labs/01-scope-and-closures/): a closure captures
its environment, and **each render has a different one**.

Three fixes, in order:

1. **a functional update** — when you only need the previous value
2. **a ref** — when a long-lived callback must read the *latest* value
3. **correct dependencies** and re-creating the effect — when the effect genuinely depends on it

## 4. `useReducer`

Four related fields in **one atomic update**. With four `useState`s you can express "loading and
error and data" simultaneously — a state that shouldn't exist
([typescript lab 06](../../../typescript/labs/06-branded-types-and-boundaries/)).

It also makes transitions testable without React, and gives you one place to log every change.

## 5. `useSyncExternalStore` and `useId`

The correct way to read anything outside React — a browser API, a store, a socket. The third argument
is the **server snapshot** for SSR. Doing it with `useState` + `useEffect` produces **tearing** under
concurrent rendering ([lab 06](../06-concurrent/)).

`useId` gives an id **stable across server and client**, which is what makes `htmlFor` and
`aria-describedby` work in SSR. `Math.random()` there is a guaranteed hydration mismatch.

## 6. The dependency array

Deps are compared with `Object.is`, one by one. An **object literal** in the array is a new reference
every render, so the effect runs every time — and if it sets state, that's an infinite loop. This is
the number-one cause of "my effect runs forever".

**The fix is almost never `useMemo`.** Depend on the **primitive fields you actually use**
(`[user.id]`, not `[user]`), move the object creation inside the effect, or lift it out of the
component.

## The effect question worth asking first

**Does this need to be an effect at all?** The React docs' "You Might Not Need an Effect" is the
highest-value page in the documentation. Common non-effects:

| Instead of an effect | Do |
|---|---|
| deriving state from props | compute it during render |
| resetting state when a prop changes | change the **`key`** so the component remounts |
| updating state in response to state | one state, or a reducer |
| an effect that only runs on an event | do it in the event handler |

Effects are for **synchronising with something outside React**. That's the whole list.

## Think about

- Why does `setState` in a `useEffect` with no deps loop forever?
- When is a ref the right answer instead of state?
- Why does `useId` exist?

<details>
<summary>Answers</summary>

**The infinite loop.** No dependency array means "run after every render". Setting state causes a
render, which runs the effect, which sets state. With `[]` it runs once; with `[someObject]` it loops
too, because the object is new each render. The fix is to ask whether the value can be derived during
render instead.

**Ref over state.** When changing it should **not** cause a re-render, and when nothing renders from
it: a timer id, a "has this mounted before" flag, the previous value of something, a DOM node, the
latest value for a long-lived callback. The test: if the UI must update when it changes, it's state;
if it's bookkeeping, it's a ref. Note reading `ref.current` during render is a purity violation for
values that could differ between the server and the client.

**`useId`.** SSR needs the same id on the server and the client, or hydration mismatches and ARIA
relationships break. A counter isn't safe either, because concurrent rendering means components don't
render in a predictable order and the ids wouldn't line up. `useId` derives the id from the
component's **position in the tree**, which is stable across both environments.
</details>

---

## Interview questions

1. Why does `setCount(count + 1)` three times add 1?
2. `useEffect` vs `useLayoutEffect` — the ordering, and when each is right.
3. What's a stale closure and what are the three fixes?
4. Why can an object in the dependency array cause an infinite loop?
5. Why is `useSyncExternalStore` necessary rather than `useState` + `useEffect`?
6. Name three things people use effects for that shouldn't be effects.
