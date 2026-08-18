# Lab 01 — Scope & closures ⭐⭐⭐⭐⭐

**Goal:** know what a closure *retains*, not just what it is.

**Primary metric:** MB retained by 20,000 closures.

> <http://localhost:8080/javascript/labs/01-scope-and-closures/>

---

## The loop variable, precisely

| Form | Result | Mechanism |
|---|---|---|
| `for (var i …)` | `3, 3, 3` | **one** binding, function-scoped |
| `for (let j …)` | `0, 1, 2` | a **new binding per iteration** (`CreatePerIterationEnvironment`) |
| `var` + IIFE | `0, 1, 2` | the pre-2015 fix: create a scope by calling a function |

> **A closure captures an environment record, not a value.**

Two consequences people miss: `let` in a loop **allocates per iteration** (usually irrelevant, but
it's why hoisting a variable out of a hot loop sometimes helps), and the per-iteration rule applies
to `for`/`for...of`/`for...in` but **not** to a plain `while`, where you have one binding regardless.

## The TDZ is not "let isn't hoisted"

`let` and `const` **are** hoisted — the binding is created when the scope is entered. It's
*uninitialised* until the declaration runs, and touching an uninitialised binding throws.

The proof is in the lab: `typeof x` is the one operation that's **safe on a completely undeclared
variable** (it returns `"undefined"`), and it **throws** in the TDZ. If `let` were simply
not-hoisted, the variable would be undeclared and `typeof` would be safe.

| Declaration | Hoisted | Before the declaration |
|---|---|---|
| `function foo() {}` | name **and** body | callable |
| `var x` | the binding only | `undefined` |
| `let` / `const` / `class` | the binding, uninitialised | **ReferenceError** |
| `import { x }` | fully — and it's a **live binding** | usable |

That last row is the surprising one: imports are hoisted *and live*. If the exporter reassigns, your
imported name changes value. `require()` copies a value; `import` binds to a cell — which is why ESM
isn't sugar over CommonJS, why circular imports behave differently, and why tree-shaking is possible
at all.

## What a closure retains — the measurement

Run **measure the retained heap**, then **the same code, scoped properly**.

| | retained |
|---|---|
| 20,000 closures over a scope containing a 500-element array | |
| 20,000 closures created by a factory whose scope holds one value | |

Each closure "only uses" an integer. In the first case each also keeps a 500-element array alive.

**The rule:** a closure references the **environment record** it was created in. V8 *does* analyse
which variables are actually used and can allocate a smaller context — but that analysis is defeated
more easily than people assume:

- if **any** closure in the same scope references the big variable, the shared context keeps it for
  **all** of them
- `eval` or `with` anywhere in the scope disables the analysis
- having DevTools open can keep the full scope alive
- the reference can be conditional and never executed — as it is in the lab — and still count

This is the actual mechanism behind most "mysterious" SPA leaks: a handler that closes over a scope
that also happens to contain a component, a response body, or a DOM node. See
[spa-memory-leaks lab 03](../../../spa-memory-leaks/labs/04-closures-and-caches/).

### The fix is structural

```js
const makeHandler = (id) => () => doSomething(id);   // scope = { id }, and nothing else
```

Three rules: create long-lived callbacks in a **narrow factory**; null out big locals before creating
a closure (this genuinely works and looks like superstition until you measure it); and when hunting a
leak, read the **Retainers** panel, because the answer is almost always "a closure's context".

## Think about

- Why does `let` in a loop allocate more than `var`?
- A React `useEffect` closes over a large response. When is it freed?
- Is the module pattern still worth using?

<details>
<summary>Answers</summary>

**`let` allocating more.** Each iteration gets a fresh environment record with a copy of the loop
variable, so a loop of a million iterations that creates closures creates a million contexts. Without
closures the engine can usually optimise the record away entirely — the allocation is only real when
something captures it. This is a genuine cost and almost never the one worth fixing.

**`useEffect` closing over a response.** Until the effect is replaced (deps changed) or the component
unmounts *and* nothing else holds the closure. The leak case is when the closure is handed to
something longer-lived than the component — an event listener you didn't remove, a subscription
without cleanup, a timer, a global cache. The response stays alive as long as that holder does, which
is why the cleanup function isn't optional.

**Module pattern today.** ES modules already give every file its own scope, so the IIFE is usually
redundant. It still earns its keep as a **factory** producing independent instances with private
state, and for capturing an expensive setup once (`const format = (() => { const f = new
Intl.NumberFormat(); return n => f.format(n); })()`). And the trap that survives from that era: a
module-level `let` is a **singleton** shared by every importer — in SSR, shared between *requests*,
which is one of the most severe bugs in server-rendered JavaScript.
</details>

---

## 🏗️ Build challenge

1. Take a heap snapshot of your app, sort by retained size, and find one object retained by a
   closure's context. Name the variable that keeps it alive.
2. Write a `createHandler` factory for your app's longest-lived callbacks and re-measure.
3. Find a `useEffect`/`addEventListener` in your codebase with no cleanup. Prove the leak with two
   snapshots.
4. Write the loop-variable bug deliberately in a codebase with `var` allowed, then fix it three ways
   and explain which you'd ship.
5. Audit for module-level mutable state. In an SSR app, every one is a potential cross-request leak.

**Done when:** you can point at a retainer chain in DevTools and say which closure owns it.

---

## Interview questions

1. What does a closure capture — a value or something else?
2. Why does `for (var i…)` print `3, 3, 3`, in spec terms?
3. Prove that `let` is hoisted.
4. How can a closure retain an object it never references?
5. Why is a module-level `let` dangerous in SSR?
