# Lab 02 — `this` & prototypes ⭐⭐⭐⭐⭐

**Goal:** the binding rules cold, and the memory cost of the prototype chain measured.

**Primary metric:** heap for 100,000 instances, prototype methods vs class fields.

> <http://localhost:8080/javascript/labs/02-this-and-prototypes/>

---

## The four rules, in precedence order

```
new  →  explicit (call/apply/bind)  →  implicit (the dot)  →  default
```

Rule 3 is the one that matters, and the precise wording is what people get wrong:

> **`this` is the object before the dot *at the call site*.**

Not where it was defined, not what it's a property of — where it was **called**.

Arrows aren't a fifth rule. An arrow has **no `this` binding at all**, so `this` inside it resolves
lexically like any variable — which also means `call`/`apply`/`bind` can't change it.

## Every "lost this" bug is the same shape

```js
onClick={this.handleClick}       // extracted → lost
addEventListener('x', obj.m)     // extracted → lost
const { map } = arr              // extracted → lost
promise.then(obj.handle)         // extracted → lost
```

| Fix | Cost |
|---|---|
| **`() => obj.method()`** — the dot survives | nothing. Usually the best answer |
| a class-field arrow `handle = () => …` | **a function object per instance** — measured below |
| `bind` in the constructor | the same cost, older syntax |
| don't write a method that needs `this` | free |

In modules (always strict) a lost `this` is `undefined`, so you get "Cannot read properties of
undefined" rather than a silent write to `window`. The loud version is a large improvement.

## The measurement

| | 100k instances | per instance | 2M calls |
|---|---|---|---|
| 3 prototype methods | | | |
| 3 arrow class fields | | | |

**A prototype method is one function object shared by every instance.** A class field holding an
arrow is a **new function object with its own closure, per instance** — so three auto-bound handlers
on 100,000 instances is 300,000 function objects and 300,000 contexts.

It matters for large collections (list items, graph nodes, particles, grid cells, records) and for
anything created per frame. It doesn't matter for a handful of long-lived objects, which is most
application code — don't contort a codebase over 40 bytes.

**The general rule: fields are per instance, prototype members are shared.** That's also why
`#private` + a prototype method is the memory-efficient way to get privacy, and why the closure-based
module pattern from lab 01 has exactly the same cost profile as class fields.

## Depth is cheap; shape instability is expensive

Run **measure: lookup depth**. A property ten prototypes deep is *not* ten times slower, because of
**inline caches**: after the first lookup at a site, V8 remembers the shape and the offset.

So "flatten your prototype chains for speed" is mostly obsolete advice. What costs you is defeating
the cache — different shapes at one site, properties added after construction, `delete`, mutating a
prototype at runtime. That's [lab 08](../08-engine-intuition/).

Never use `Object.setPrototypeOf` or assign to `__proto__` on a live object: it invalidates every
inline cache that touched it, and V8 explicitly warns about it.

## Property descriptors

Defaults differ by how you created the property, which catches everyone:

```js
obj.x = 1                 // writable, enumerable, configurable — all TRUE
Object.defineProperty(…)  // all FALSE unless you say otherwise
```

- **non-enumerable is how the platform hides its methods** — that's why `for...in` over an array
  doesn't give you `map`, and why spreading a class instance gives you fields but no methods
- **`Object.freeze` is shallow.** Freezing a config object with nested objects protects nothing
  meaningful
- **getters look like data and are code** — they run on every access, including the ones your
  framework makes while diffing and the one the debugger makes while you hover

## Think about

- Why does `setTimeout(obj.method)` lose `this` when `obj.method()` doesn't?
- When is a class-field arrow worth its memory?
- Why is `Object.setPrototypeOf` discouraged?

<details>
<summary>Answers</summary>

**`setTimeout(obj.method)`.** Passing a method as an argument *extracts the function from the
object*. `setTimeout` later calls it with no receiver, so the implicit-binding rule has nothing to
work with. In Python or Ruby extracting a method gives you a *bound* method; in JavaScript methods
are just properties holding functions, and functions get their receiver from the call site.

**When class-field arrows are worth it.** When there are few instances and the ergonomics matter —
which is most UI code. They stop being worth it when instances are numerous (lists, grids, graphs,
particles) or created per frame. The middle ground that costs nothing: keep the method on the
prototype and wrap at the call site with an arrow.

**`setPrototypeOf`.** Changing an object's prototype after creation invalidates every inline cache
that has ever observed that object's shape, and can force the object into a slower representation.
V8's own documentation calls it out. Set the prototype at creation time — `Object.create(proto)`,
`class extends`, or an object literal with `__proto__:` — where it's free.
</details>

---

## 🏗️ Build challenge

1. Grep for `.bind(this)` and class-field arrows in your codebase. For each, ask how many instances
   exist. Convert the numerous ones.
2. Measure the heap of your largest collection of class instances, both ways.
3. Find one "lost this" bug in your history and classify which of the four fixes was applied.
4. Audit for `Object.freeze` used as if it were deep.
5. Write a class with `#private` fields and prototype methods, and compare its per-instance size with
   a closure-based factory.

**Done when:** you can state the per-instance cost of your hottest class, in bytes.

---

## Interview questions

1. State the four binding rules in precedence order.
2. Why does extracting a method lose `this`?
3. What's the memory difference between a prototype method and a class-field arrow?
4. Is a deep prototype chain slow? Why not?
5. What does `enumerable: false` change, and where does the platform use it?
