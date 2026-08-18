# Lab 06 — Concurrent React ⭐⭐⭐⭐⭐⭐

**Goal:** understand what changed when rendering became interruptible — including the one genuinely
new bug.

```sh
cd react-sandbox && npm run dev     # → #concurrent
```
> Source: [`react-sandbox/src/routes/concurrent.jsx`](../../../react-sandbox/src/routes/concurrent.jsx)

---

## The one sentence

> **React can render a tree and throw it away.**

Everything below follows: transitions, Suspense fallbacks, `useSyncExternalStore`, the purity
requirement, and StrictMode's double invocation.

## Transitions and deferred values

Type quickly in each mode. **Nothing here is faster** — the list still costs 12ms. What changes is
*what the user waits for*: the input value paints immediately, and the expensive render happens at
lower priority, interrupted and restarted if you keep typing.

| | Use when |
|---|---|
| `useTransition` | you own the setter — wrap the **update** |
| `useDeferredValue` | you receive a value as a prop — defer the **value** |

Both need the expensive child **memoised**, or React re-renders it anyway. And `isPending` is what
lets you show a subtle indicator instead of a spinner over content you already have.

This is the React-side answer to the INP work in
[web-vitals-and-react-perf lab 04](../../../web-vitals-and-react-perf/labs/04-inp/): the urgent update
paints within the interaction, and the rest is off the critical path.

## Suspense

A boundary catches anything below it that isn't ready — a lazy chunk, or a promise thrown by a data
library. **Placement is the design**: a boundary around the page means the page blanks; a boundary per
widget means each shows its own skeleton — the same tiering decision as
[resilience lab 03](../../../resilience/labs/03-degradation/).

**The trap:** a fallback appears whenever a boundary **suspends again**, so an already-visible list can
be replaced by a spinner on the next fetch. `useTransition` prevents exactly that — an update marked
as a transition keeps the old UI visible instead of falling back.

Pair every Suspense boundary with an **error boundary**: "not ready" and "failed" are different
states and users need to tell them apart ([resilience lab 01](../../../resilience/labs/01-error-boundaries/)).

## Tearing

**Two components rendering different values of the same source in one commit.**

It became possible when rendering became interruptible: React can render half a tree, yield to the
browser, and finish later — and if the external source changed in between, the halves disagree. The
naive readers in the lab (`useState` + subscribe in an effect) can show it; the
`useSyncExternalStore` readers cannot.

`useSyncExternalStore` forces a synchronous re-render when the store changes mid-pass, so every
consumer in a commit sees one value. **Every store library rewrote its subscription layer for this** —
which is why "just use `useState` + `useEffect` to subscribe" is wrong in React 18+.

Note that tearing is only possible for state **outside** React. React's own state is versioned per
render pass, so it can't tear.

## Why your render must be pure

Because React may call it and discard the result, call it twice, or call it out of order. So:

- no side effects during render — no mutation of anything outside the function, no `ref.current`
  writes, no subscriptions
- no reading a mutable external value without `useSyncExternalStore`
- no assuming the render will commit

**StrictMode double-invokes to surface exactly these**, and a component that misbehaves under it has a
bug that would surface under concurrency anyway.

## What ships on top

| Feature | Depends on |
|---|---|
| `useTransition` / `useDeferredValue` | priorities |
| Suspense for data | throwing to a boundary |
| **streaming SSR + selective hydration** | interruptibility ([hydration-strategies](../../../hydration-strategies/)) |
| Server Components | the RSC payload format ([rendering-strategies lab 05](../../../rendering-strategies/labs/05-rsc-model/)) |
| `useOptimistic`, `useActionState`, `<form action>` | transitions ([architecture-and-state lab 04](../../../architecture-and-state/labs/04-consistency-and-sync/)) |

## Think about

- Why can React's own state never tear?
- When does a Suspense fallback appear on an update, and how do you stop it?
- Is `useTransition` making anything faster?

<details>
<summary>Answers</summary>

**React state can't tear.** Because it's stored on the fiber tree, and a render pass reads from a
consistent snapshot of that tree — the work-in-progress tree is separate from the committed one, and
updates are queued into lanes rather than mutating what's being read. Tearing needs a source that can
change *between* two reads in the same pass, which is only possible for state React doesn't own.

**Fallback on update.** Whenever a boundary suspends again after having rendered content — a new
`lazy` import below it, or a data read that isn't cached. The fix is to mark the update as a
transition (`startTransition`), which tells React to keep showing the previous UI while the new one
prepares, surfacing progress through `isPending` instead of a fallback.

**Is `useTransition` faster?** No — the same work happens and the total time is the same or slightly
longer. It changes *scheduling*: the urgent part of the update commits immediately and the expensive
part is interruptible, so the interaction feels instant. It's the same trade as the cooperative
scheduler in [javascript lab 06](../../../javascript/labs/06-iterators-and-generators/) — longer wall
clock, better responsiveness, and that's the one users perceive.
</details>

---

## Interview questions

1. What does "interruptible rendering" enable?
2. `useTransition` vs `useDeferredValue`.
3. What is tearing, and why did it not exist before React 18?
4. Why must a render function be pure, specifically?
5. When does a Suspense fallback replace visible content, and how do you avoid it?
