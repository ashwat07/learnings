# Lab 06 — Iterators & generators ⭐⭐⭐⭐⭐

**Goal:** use the only thing in JavaScript that can pause a function.

**Primary metric:** FPS while 30,000,000 units of work run.

> <http://localhost:8080/javascript/labs/06-iterators-and-generators/>

---

## The protocol is two methods

An **iterable** has `[Symbol.iterator]()` returning an **iterator**; an iterator has `next()`
returning `{ value, done }`. Implementing that makes your object work with `for...of`, spread,
destructuring, `Array.from`, `Map`, `Set`, `yield*` and `Promise.all`.

The third method, **`return()`**, is where cleanup belongs — it's called when a consumer stops early
(a `break`, a `throw`, destructuring fewer elements). In a generator it's what makes `finally` run:

```js
function* readLines(file) {
  try { while (…) yield line; }
  finally { file.close(); }        // runs even if the consumer breaks out
}
```

That's a genuinely strong guarantee, and the reason generators are the right tool for anything
holding a resource.

## Laziness

The lazy pipeline in the lab produces only the elements it needs, over an **infinite** source, with
no intermediate arrays. The eager one builds three full arrays to return five elements.

Two properties the eager version can't have at any price: it works over an infinite source, and it
**interleaves** — each element flows through the whole pipeline individually, so the first result is
available immediately.

**When it pays:** paginated APIs, large files, tree traversal where you want the first match, any
pipeline over data too big to materialise.
**When it doesn't:** small arrays. Generator resumption has real per-element overhead — a pipeline
over 10 items is *slower* than three array passes. Laziness pays for **size** and for **infinity**,
not for style.

(Iterator Helpers — `.map`/`.filter`/`.take` directly on iterators — are shipping now, which makes
this ergonomic without hand-written combinators.)

## Two-way communication makes it a coroutine

| Call | Effect |
|---|---|
| `yield x` | sends `x` out, suspends |
| `it.next(v)` | resumes; the **`yield` expression evaluates to `v`** |
| `it.throw(e)` | resumes by throwing **at the yield** — the generator's own `try/catch` runs |
| `it.return(v)` | resumes by returning — its `finally` blocks run |

`it.throw()` is exactly the mechanism `async/await` uses for a rejected promise
([lab 05](../05-promises-from-scratch/)). It's also why generators are the substrate for effect
systems (redux-saga, Effection): the generator **describes** what it wants, a driver decides how to
do it, and can inject values, errors, cancellation and mocks. That separation is what makes saga code
testable without any I/O.

## The cooperative scheduler

| | wall time | FPS | cancellable | progress |
|---|---|---|---|---|
| blocking `for` loop | | **zero — frozen** | no | impossible |
| generator + 5ms slices | *longer* | ~60 | yes | yes |

The cooperative version takes **longer** and the page stayed responsive. That trade is almost always
right — nobody perceives 900ms vs 1100ms; everybody perceives a frozen page.

What the generator buys over a hand-chunked loop: the work is **one linear function** (no index
bookkeeping, no state machine), it's cancellable at any yield point, progress is free, and the slice
size is **time-based** so it adapts to a slow device.

The caveat: if the work doesn't touch the DOM, a **worker** is better — it uses a different core
entirely ([web-workers lab 01](../../../web-workers/labs/01-main-thread-blocking/)). Use cooperative
scheduling when the work must be on the main thread.

## Async iteration and backpressure

`for await (const item of paginate())` turns a paginated API into a flat stream — and because
iteration is lazy, breaking out early means the next page is **never requested**. The laziness reaches
all the way to the network.

`response.body` is async-iterable, which is how you parse a 200MB NDJSON file in a tab with 100MB of
headroom.

| Strategy | In flight | Memory |
|---|---|---|
| `for await` (sequential) | 1 | constant — **backpressure by construction** |
| **a bounded pool** | N | bounded by N — the right default |
| `Promise.all(map(fn))` | **all** | **unbounded — the trap** |

The third is the fastest, the most commonly written, and the one that opens 10,000 connections when
the array has 10,000 items. Read `pooled()` in the lab — fifteen lines.

## Think about

- When is a generator slower than an array method?
- Why does `for await` give you backpressure for free?
- What does `it.return()` have to do with `finally`?

<details>
<summary>Answers</summary>

**Slower than array methods.** For small collections, always. Each `next()` is a function call that
suspends and resumes a stack frame, while `Array.prototype.map` is a tight optimised loop over a
contiguous buffer. The crossover depends on the pipeline, but as a rule: under a few hundred elements
with a couple of stages, arrays win. Generators win when the source is huge, infinite, asynchronous,
or when you need to stop early.

**Backpressure for free.** `for await` calls `next()` and *awaits it* before asking for the next
value, so the producer is only resumed when the consumer is ready. There's no queue to grow, because
there's no queue — the producer is suspended, not buffering. That's the structural difference from
"produce everything into an array, then consume it".

**`it.return()` and `finally`.** When a consumer stops early, the language calls `iterator.return()`,
and in a generator that resumes execution as if a `return` statement ran at the yield point — which
means every enclosing `finally` block executes. That's the only reason a `for...of` with a `break`
can release a file handle, close a socket, or clear a subscription held by a generator.
</details>

---

## 🏗️ Build challenge

1. Convert a paginated API client into an async generator. Verify that breaking out early stops the
   fetching.
2. Take your longest main-thread task and make it cooperative with a generator + time slices. Measure
   FPS before and after — then ask whether it should be a worker instead.
3. Write a `pooled(source, limit, fn)` helper and replace every unbounded `Promise.all(map(...))`
   over a variable-length list.
4. Stream a large response with `for await (const chunk of res.body)` and a `TextDecoderStream`.
5. Add a generator that holds a resource and prove the `finally` runs on `break`.

**Done when:** no pipeline in your app starts an unbounded number of concurrent operations.

---

## Interview questions

1. What are the three iterator methods and what is the third for?
2. When is laziness worth the overhead?
3. How does `it.throw()` relate to `try/catch` across an `await`?
4. Why does a cooperative scheduler take longer and feel faster?
5. What's backpressure, and which of the three concurrency strategies has it?
