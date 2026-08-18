# Lab 04 — References & cloning ⭐⭐⭐⭐⭐

**Goal:** pick a cloning strategy from a correctness matrix, not a habit.

**Primary metric:** which method survives a `Date`, a `Map`, a cycle, an `undefined`.

> <http://localhost:8080/javascript/labs/04-references-and-cloning/>

---

## The correctness matrix

Run it. `JSON.parse(JSON.stringify(x))` is the most widely used deep clone in JavaScript and it
silently destroys almost everything:

| What | JSON round-trip |
|---|---|
| `Date` | becomes a **string**, then compares wrong forever |
| `Map` / `Set` | become `{}` — **with no error** |
| `undefined` keys, functions, symbols | **vanish** |
| `NaN` / `Infinity` | become `null` |
| `BigInt` | throws |
| a cycle | throws |
| getters | flattened to their value at clone time |

**`structuredClone` is the correct default in 2026.** Built into every modern browser and Node 17+,
it handles all of the above except functions, symbols, DOM nodes and property descriptors — and it
**throws loudly** instead of silently corrupting. Most codebases still have a hand-rolled clone or a
lodash import that predates it.

The hand-rolled column shows what you'd have to write: cycles via a `WeakMap`, per-type branches,
descriptor preservation. Read `deepClone()` in the lab — 20 lines, and still incomplete (`Error`,
`Blob`, `File`, class instances with private fields).

## Speed, and the real lesson

JSON is often **faster** than `structuredClone` for plain data — the serialiser is hand-tuned C++ for
a much simpler format. So the trade is speed against correctness.

But the real lesson is that **most deep clones shouldn't exist**. If you're cloning to avoid mutating
shared state, the fix is to stop sharing mutable state:

```js
const next = {
  ...state,
  user: { ...state.user, prefs: { ...state.user.prefs, theme: 'light' } },
};
```

Everything you didn't touch is **shared** — which is faster *and* gives you the property React, Redux
and every memoisation depend on: an unchanged subtree keeps its identity, so `prev.items ===
next.items` is a valid "nothing changed" check.

That path-copying is exactly what **Immer** generates via a Proxy ([lab 07](../07-proxy-and-reflect/)).
Deep-cloning the whole state destroys the identity checks *and* the performance, which is why "just
deep clone it" is the wrong instinct in a React codebase.

## Which equality do you need?

| Comparison | Used by | Cost |
|---|---|---|
| `===` | `React.memo`, `useMemo` deps, store selectors | free |
| `shallowEqual` | `useSelector`-style comparisons | one level |
| `deepEqual` | correctness | **O(size)** — can cost more than the render you're avoiding |
| `JSON.stringify` comparison | quick test assertions | depends on **key order**; inherits every JSON limitation |

**The design rule: preserve identity instead of comparing structure.** If unchanged subtrees keep
their references, `===` is sufficient everywhere.

## Immutability, ranked honestly

1. **TypeScript `readonly`** — free at runtime, catches the mistake where it's made
2. **path copying** for updates — preserves identity
3. **Immer** when the spread pyramid becomes unreadable
4. `Object.freeze` in development only, if at all — it's shallow, costs on every write, and in sloppy
   mode fails **silently**

## The array traps

**A hole is not `undefined`.** The methods split into two camps:

- **skip holes:** `forEach`, `map`, `filter`, `some`, `every`, `reduce`, `Object.keys`, `JSON.stringify`
- **visit holes:** `for...of`, spread, `Array.from`, `fill`, `find`, `includes`, `join`, `sort`

```js
new Array(3).map((_, i) => i)          // [ <3 empty items> ] — map skipped every hole
Array.from({length: 3}, (_, i) => i)   // [0, 1, 2]
[...Array(3)].map((_, i) => i)         // also fine — spread fills the holes first
```

Holes come from `new Array(n)`, `arr.length = 10`, `delete arr[i]`, and assigning past the end.
**`delete` on an array is the one to avoid outright** — it leaves a hole *and* can push the array
into dictionary mode ([lab 08](../08-engine-intuition/)).

## Think about

- When is `structuredClone` the wrong choice?
- Why does deep-cloning state hurt a React app?
- Why is `JSON.stringify(a) === JSON.stringify(b)` a bad equality check?

<details>
<summary>Answers</summary>

**When `structuredClone` is wrong.** When you need functions, symbols, DOM nodes, class prototypes or
property descriptors preserved — it throws or flattens. Also when you're cloning something enormous
on the critical path, since it's a full copy; and when you didn't actually need a clone, which is the
common case. It's also worth knowing it's the *same* algorithm as `postMessage`, so anything it can't
clone can't cross a worker boundary either.

**Deep clone in React.** Every reference changes, so every `===` check fails: `React.memo` doesn't
bail out, `useMemo` recomputes, selectors think everything changed, and the whole tree re-renders.
You've simultaneously paid to copy data you didn't change *and* removed the mechanism that would have
skipped the work.

**JSON equality.** It depends on key insertion order, so `{a:1,b:2}` and `{b:2,a:1}` compare unequal
despite being identical. It also inherits every JSON limitation — `Date`s stringify to the same value
as their string form, `undefined` keys disappear, `NaN` becomes `null` — so two genuinely different
objects can compare equal. Fine as a quick assertion in a test; wrong in application code.
</details>

---

## 🏗️ Build challenge

1. Grep for `JSON.parse(JSON.stringify` in your codebase. For each, check whether the data contains a
   `Date`, `Map`, `Set` or `undefined`. Some of those are live bugs.
2. Replace the survivors with `structuredClone` and delete any hand-rolled deep clone.
3. Find a reducer or state update that deep-clones and convert it to path copying. Measure the
   re-render count before and after.
4. Audit for `delete arr[i]` and `new Array(n).map(...)`.
5. Add `readonly`/`Readonly<T>` to your state types and fix what the compiler finds.

**Done when:** no deep clone in your app exists for a reason that path-copying would solve.

---

## Interview questions

1. Name four things `JSON.parse(JSON.stringify(x))` loses.
2. What does `structuredClone` handle that it doesn't, and what does it still miss?
3. Why is path copying better than deep cloning in a React app?
4. What's the difference between a hole and `undefined` in an array?
5. Which array methods skip holes?
