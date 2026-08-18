# Lab 07 — Write a mini React ⭐⭐⭐⭐⭐⭐

**Goal:** implement enough React that every earlier question has a mechanical answer.

**Primary metric:** the test suite — `node test.mjs` → 10 passing.

> <http://localhost:8080/react/labs/07-mini-react/>
> No React, no build step, no dependencies. Read
> [`mini-react.js`](mini-react.js) (260 lines) alongside the page.

---

## What's real in it

- `createElement` and a virtual DOM of plain objects
- a **fiber tree** kept between renders (`alternate`/`current`), so state has somewhere to live
- **reconciliation by type and key**, with placement, update, **move** and deletion
- a **two-phase commit**: build the whole tree, then touch the DOM once
- hooks stored as a **list on the fiber**, which is why order matters
- `useState`, `useReducer`, `useEffect` (with cleanup), `useRef`, `useMemo`, `useCallback`
- batching — several `setState` calls in one tick produce one render

And a working todo app running on it, with per-item state so reconciliation mistakes are *visible*.

## The five things it makes obvious

### 1. `useState` **is** `useReducer`

```js
export function useState(initial) {
  return useReducer((state, action) =>
    (action instanceof Function ? action(state) : action), initial);
}
```

That's not a simplification for the lab — it's how React implements it. Which explains why
`setCount(c => c + 1)` works: the "action" is a function and the reducer applies it.

### 2. Hooks are a list, and that's the whole rules-of-hooks story

```js
const old = wipFiber.alternate?.hooks?.[hookIndex];   // read slot N
wipFiber.hooks.push(hook);                            // write slot N
hookIndex++;
```

**Nothing associates a hook with a variable — only its position.** A conditional hook shifts every
later slot, so `useState` reads what `useEffect` stored. Real React detects the count changing and
throws "Rendered fewer hooks than expected"; this implementation would corrupt silently, which is a
good demonstration of why that error message exists.

It also explains why custom hooks compose for free (their slots are allocated inline in the caller's
list) and why you can't call a hook from an event handler (`wipFiber` is only set during a render).

### 3. Keys decide identity

```js
if (element.key != null) match = oldByKey.get(element.key);   // matched by KEY
else if (oldFiber?.key == null) match = oldFiber;             // matched by POSITION
```

Four lines, and they're behind every keys bug you've seen. Run the app: type a note into a row,
reverse the list, and toggle "use index as key".

`test.mjs` asserts both outcomes:

```
keyed by id     → 'b:ba:a'    state followed its item
keyed by index  → 'b:aa:b'    the label changed and the state did not
```

Note the mount counter never increments on reorder in either mode — the component is **reused**, not
remounted. That's why index keys *corrupt* state rather than resetting it, which is far harder to
notice.

### 4. Effect ordering, including cleanup

```
1. render   every component function runs; NOTHING is written to the DOM; effects are queued
2. commit   deletions, then placements, moves and updates
3. effects  for each changed effect: run the PREVIOUS cleanup, then the new effect
```

**Cleanup runs before the next effect, not only on unmount.** An effect with `[query]` in its deps
tears down the old subscription before subscribing to the new one — which is why returning a cleanup
is how you avoid a race, not an optional tidiness. And `commitDeletion` walks the removed subtree
running every cleanup in it.

### 5. Placement is what makes reorder work

```js
const expected = anchor ? anchor.nextSibling : parentDom.firstChild;
if (fiber.dom !== expected) parentDom.insertBefore(fiber.dom, expected);
```

`insertBefore` **moves** an existing node. A function component has no DOM node of its own, so its
children commit into the same parent and share the anchor — React calls this searching for the "host
sibling". Getting this wrong is how I first wrote it, and the symptom was exact: state moved
correctly and the DOM didn't.

## What real React adds

| | mini | real |
|---|---|---|
| two-phase render/commit | ✅ | ✅ — and this is what enables the rest |
| **interruptible rendering** | ❌ `while (next)` runs to completion | the scheduler yields between units of work |
| priorities / transitions | ❌ | lanes: urgent, transition, idle |
| Suspense, streaming SSR | ❌ | ✅ |
| context, portals, error boundaries | ❌ | ✅ |
| `memo` / bailout on unchanged props | ❌ everything re-renders | ✅ |
| synthetic events | raw `addEventListener` | one root listener |

**Interruptible rendering is the row that matters**, because everything else in modern React follows
from it: keeping the page responsive while rendering a large tree, *abandoning* a half-built tree when
something more urgent arrives (that's a transition), and rendering at different priorities in one
tick.

It's also the source of the one genuinely new bug — **tearing** — which is why
`useSyncExternalStore` exists ([lab 06](../06-concurrent/)).

## Think about

- Why is the render phase separate from the commit phase?
- Why can't a hook be called conditionally?
- What would you have to add to make rendering interruptible?

<details>
<summary>Answers</summary>

**Two phases.** So the tree can be built without side effects, which makes it **discardable**. If
rendering wrote to the DOM as it went, you couldn't abandon a half-finished render — the user would
see a partial update. Separating them is what makes concurrency possible at all, and it's also why
render functions must be pure: React may call yours and throw the result away.

**Conditional hooks.** The state is stored in an array indexed by call order, with no names. If a
hook is skipped, every later hook reads the previous render's state for a *different* hook. The
alternative design — keyed hooks, `useState('count', 0)` — was considered and rejected because it's
noisier at every call site and makes custom hooks require key namespacing.

**Making it interruptible.** Three things. (1) Turn the `while` loop into a callback the scheduler
drives, checking a deadline between units of work (`requestIdleCallback`, or a `MessageChannel` as
React actually uses). (2) Make the work-in-progress tree fully separate from the committed tree so an
abandoned render leaves nothing behind — the `alternate` pointer already does most of this. (3) Add
priorities, so a high-priority update can restart the loop from the root instead of finishing the
low-priority one. That third part is where most of React's real complexity lives.
</details>

---

## 🏗️ Build challenge

Extend the mini React. In rough order of difficulty:

1. **`React.memo`** — a bailout: if the props are shallowly equal and there's no pending state, reuse
   the previous fiber's children without calling the function.
2. **Context** — a provider fiber that pushes a value, and a `useContext` that walks up to find it.
   Then notice why *every* consumer re-renders when the value changes.
3. **`useLayoutEffect`** — run it inside the commit phase, before returning, and confirm it blocks
   paint where `useEffect` doesn't.
4. **Error boundaries** — a try/catch around `fiber.type(props)` and a search up the tree for the
   nearest boundary.
5. **Fragments** — a `type` of `Symbol.for('fragment')` that commits its children into the parent.
6. **Interruptible rendering** — the three steps in the answer above. This is a weekend, and it's the
   one that teaches the most.

Write a test in `test.mjs` for each before you implement it.

**Done when:** you can explain any React behaviour by pointing at a line in your own renderer.

---

## Interview questions

1. What is an element, what is a fiber, and how do they differ?
2. Why is `useState` implementable in terms of `useReducer`?
3. Explain the rules of hooks from the implementation.
4. What exactly does a key change?
5. Why are render and commit separate phases?
6. What does interruptible rendering enable, and what bug does it introduce?
