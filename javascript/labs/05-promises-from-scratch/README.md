# Lab 05 — Promises from scratch ⭐⭐⭐⭐⭐⭐

**Goal:** write a Promises/A+ implementation, pass a conformance suite, then desugar `async/await`
into it.

**Primary metric:** 14 spec rules passing.

> <http://localhost:8080/javascript/labs/05-promises-from-scratch/>
> Read `MyPromise` in `app.js` — ~90 lines, with the spec clause cited on each rule.

---

## The three rules that carry the weight

1. **A promise settles once.** Every later `resolve`/`reject` is ignored. This is what makes a
   promise safe to hand to code you don't control.
2. **Handlers never run synchronously**, even on an already-settled promise. Without this, whether
   your callback ran before or after the next line would depend on timing — the "releasing Zalgo"
   problem callback APIs had.
3. **Resolving with a thenable adopts its state.** That one rule is why `return fetch(...)` inside
   `.then` flattens instead of nesting, and why any object with `.then` is interchangeable with a
   real promise.

Rule 3's sharp edge: **you cannot resolve a promise *with* a promise as a value.**
`Promise.resolve(p)` returns `p`. If you need to store one, wrap it: `{ promise }`.

## Assimilation, and what it costs you

Anything with a `.then` **method** is treated as a promise. Consequences that arrive as bugs:

- an object deserialised from user data with a `then` function will be **assimilated** and probably
  hang forever
- `.then` is read as a **property**, once — a throwing getter rejects the promise
- a thenable that calls back and then throws is ignored after the first call, because a promise
  settles once
- a class with a `then` method can never be returned from an async function intact

## `async/await` is a generator plus a driver

The lab implements `drive()` in 15 lines and runs the same logic both ways — including `try/catch`
across an `await`. The mapping is exact:

| async | generator |
|---|---|
| `async function` | a generator wrapped in a driver |
| `await x` | `yield x` — the driver resumes with the resolved value |
| a rejection | `it.throw(e)` — **which is why `try/catch` works across awaits** |
| `return v` | the driver resolves with `v` |

Two things this explains:

- **why an async function returns at the first `await`** — a generator suspends at `yield` and
  returns control; the rest is a continuation
- **why `await` in a loop is sequential** — each `yield` waits for the driver. Collecting promises
  and awaiting once isn't a style preference; it's *n* round trips vs one

## The combinators

| | Semantics | Use for |
|---|---|---|
| `all` | all must succeed; rejects on the **first** failure | dependent work |
| **`allSettled`** | never rejects | **the right default in a UI** |
| `race` | first to **settle**, success or failure | timeouts |
| `any` | first to **succeed**; `AggregateError` if all fail | redundant sources |

**`all`'s trap: rejection is not cancellation.** When it rejects, the others are still in flight,
their handlers still run, and their errors become unhandled rejections. For real cancellation, pass an
`AbortSignal` and abort the rest in the failure path.

## The traps

| Trap | Symptom | Fix |
|---|---|---|
| `await` inside `forEach` | the loop finishes before anything is done | `for...of`, or `Promise.all(map(...))` |
| `await` in a loop | n × latency | start them all, then await |
| attaching `.catch` late | reported as an unhandled rejection first | attach in the same tick |
| **`return` vs `return await` in `try`** | the rejection **escapes** the `try` | use `return await` inside `try` |

That last one is why `no-return-await` has an exception for `try` blocks: `return somePromise` returns
*before* the promise settles, so the rejection escapes the enclosing `try/catch` entirely. Everywhere
else `return await` is redundant.

## Think about

- Why must handlers be asynchronous even for a settled promise?
- What happens if you resolve a promise with itself?
- Why do you get "unhandled rejection" for a promise you eventually catch?

<details>
<summary>Answers</summary>

**Always-async handlers.** So that a function taking a callback has *one* behaviour instead of two.
If `.then` ran synchronously for an already-settled promise, whether your callback ran before or
after the next statement would depend on cache state, timing, or which branch produced the promise —
"releasing Zalgo". Guaranteed asynchrony means the call stack is always in a known state when your
handler runs.

**Resolving with itself.** The spec requires a `TypeError` — a chaining cycle. The lab implements it
(clause 2.3.1). Without the check you'd get infinite recursion in the resolution procedure, since
adopting a thenable means waiting for it, and it's waiting for itself.

**Unhandled rejection then caught.** The unhandled-rejection check runs at the end of the current
microtask checkpoint. If a promise is rejected and no handler is attached by then, the browser reports
it — even if you attach one a tick later. The fix is to attach handlers in the same tick you create
the promise; if you're storing a promise to await later, attach a no-op `.catch(() => {})` immediately
and handle the real error at the await.
</details>

---

## 🏗️ Build challenge

1. Implement `MyPromise` yourself from the spec, without looking. Run this lab's suite against it.
2. Add `Promise.withResolvers()` and a `deferred()` helper, and find a place in your code where the
   explicit-resolver pattern would be clearer than the executor.
3. Grep for `await` inside `forEach` and inside `for` loops. Classify each: genuinely sequential, or
   an accidental waterfall?
4. Add a shared timeout helper built on `AbortSignal.timeout` and delete every ad-hoc
   `Promise.race([p, sleep()])`.
5. Add an `unhandledrejection` listener that reports to your monitoring
   ([quality-and-delivery lab 03](../../../quality-and-delivery/labs/03-observability/)).

**Done when:** your suite passes and you can explain each rule from memory.

---

## Interview questions

1. Why can a promise only settle once?
2. What is thenable assimilation and what can go wrong with it?
3. Desugar `async/await` into generators.
4. `all` vs `allSettled` vs `race` vs `any` — and which is the UI default?
5. Why does `return await` matter inside a `try`?
