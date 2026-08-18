# JavaScript — the parts that separate people ⭐⭐⭐⭐⭐⭐

Most JavaScript courses stop at "here is how closures work". This one asks the next question every
time: **what does it cost, what does it retain, and what does the engine actually do?**

Every lab here produces a number. Not because performance is the point, but because a number is the
difference between *knowing about* a mechanism and *understanding* it.

```sh
./serve.sh    # then http://localhost:8080/javascript/labs/01-scope-and-closures/
```

> **Run Chrome with `--js-flags="--allow-natives-syntax"` for labs 02 and 08** if you want the
> engine internals (hidden class inspection). Everything works without it; you just get fewer
> details.
>
> ```sh
> open -a "Google Chrome" --args --js-flags="--allow-natives-syntax"
> ```

---

## Curriculum

| # | Lab | The question it answers | ⭐ |
|---|---|---|---|
| 01 | [Scope & closures](labs/01-scope-and-closures/) | What does a closure **retain**, and what does that cost? | ⭐⭐⭐⭐⭐ |
| 02 | [`this` & prototypes](labs/02-this-and-prototypes/) | Why do class fields make 100k instances 3× bigger? | ⭐⭐⭐⭐⭐ |
| 03 | [Coercion & equality](labs/03-coercion-and-equality/) | Run the spec algorithm and stop guessing | ⭐⭐⭐⭐ |
| 04 | [References & cloning](labs/04-references-and-cloning/) | Which clone is correct, and which is fast? | ⭐⭐⭐⭐⭐ |
| 05 | [Promises from scratch](labs/05-promises-from-scratch/) | Build one that passes the spec's own tests | ⭐⭐⭐⭐⭐⭐ |
| 06 | [Iterators & generators](labs/06-iterators-and-generators/) | Coroutines, lazy sequences, backpressure | ⭐⭐⭐⭐⭐ |
| 07 | [Proxy & Reflect](labs/07-proxy-and-reflect/) | Build Vue's reactivity in 40 lines, then measure the tax | ⭐⭐⭐⭐⭐ |
| 08 | [Engine intuition](labs/08-engine-intuition/) | Why the same function runs 10× slower | ⭐⭐⭐⭐⭐⭐ |

Prerequisite: [event-loop](../event-loop/) — this course assumes you know task vs microtask
ordering cold, and lab 05 builds the machinery underneath it.

## What makes these different

| Ordinary version | This version |
|---|---|
| "closures capture variables" | closures capture the **whole scope object** — measure the retained heap |
| "arrow functions bind `this`" | class fields are **per-instance** — measure 100k instances both ways |
| "`==` does coercion" | implement `ToPrimitive` and trace every step of the comparison |
| "spread does a shallow copy" | a correctness matrix over `Date`/`Map`/cycles/`undefined`, then a speed one |
| "promises are microtasks" | write one that passes Promises/A+, then desugar `async/await` into it |
| "generators pause" | build a cooperative scheduler and a backpressured pipeline with them |
| "Proxy intercepts" | build reactivity, then measure the 5–50× property-access tax |
| "V8 optimises hot code" | make the same function 10× slower by changing the *shape* of its input |

## The one habit

**Never accept a mechanism you cannot demonstrate.** If you believe closures are cheap, measure the
heap. If you believe `structuredClone` is slow, time it. Every claim in these labs has a button
next to it.
