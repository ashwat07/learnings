# Lab 07 — Proxy & Reflect ⭐⭐⭐⭐⭐

**Goal:** build the two famous Proxy applications — reactivity and copy-on-write — then measure the
tax.

**Primary metric:** property-read time vs a plain object.

> <http://localhost:8080/javascript/labs/07-proxy-and-reflect/>

---

## Two things about traps

**One operation fires several traps.** `Object.keys(proxy)` fires `ownKeys` *and*
`getOwnPropertyDescriptor` once per key. Spread adds a `get` per key. `JSON.stringify` adds a `get`
for `"toJSON"`. If your trap does work, it does that work several times per apparently-simple
operation.

**Always use `Reflect` inside a trap:**

```js
get(t, k) { return t[k]; }                    // a getter sees `t` as this — WRONG
get(t, k, r) { return Reflect.get(t, k, r); } // the getter sees the PROXY — correct
```

Get that wrong and a getter that reads another property bypasses your proxy entirely — which in a
reactivity system means silently missing dependencies.

## Reactivity in 40 lines

Three functions, and this is genuinely how Vue 3 works:

```
track(target, key)     while an effect runs, record that it read this key
trigger(target, key)   when the key is written, re-run every effect that read it
effect(fn)             set a global "current effect", run fn, unset it
```

**The dependency graph is discovered by running the code.** Nobody declares dependencies; the proxy
observes them. That's why Vue and Solid have no dependency arrays and React does — React deliberately
doesn't proxy your data, so it *cannot* know what you read.

Details in the implementation that matter: the `targetMap` is a `WeakMap` (a discarded object takes
its subscriptions with it); `set` compares with `Object.is` and only triggers on a **real** change
(otherwise `state.x = state.x` loops forever); `get` wraps nested objects **lazily**, so deep
reactivity costs nothing until you read deep.

## `produce()` — copy-on-write

The key result is the third row of the table: **untouched subtrees keep their identity.**

That's why this beats a deep clone in a React/Redux codebase. `React.memo`, `useMemo` deps and
selectors compare with `===`. A deep clone changes every reference, so everything re-renders.
Structural sharing changes only the path you touched. And if the recipe changes nothing, you get the
**original object** back, so every downstream `===` short-circuits.

## The tax

Even a Proxy with **no traps at all** is several times slower to read than a plain object, because a
proxy can't participate in inline caches ([lab 08](../08-engine-intuition/)) — every access goes
through the meta-object protocol instead of a cached offset.

- **Never put a proxy in a hot loop.** Read values out, work on plain data, write back. Vue does
  exactly this internally.
- The absolute numbers are still small — millions of accesses per second is plenty for a UI, which is
  why Vue and MobX are fast in practice despite the multiplier.
- It's a per-**access** cost, not per-object.

**That's the trade React declined:** proxy reactivity gives automatic, precise dependency tracking at
the cost of making every property access slower and every value a proxy. React chose plain objects
and explicit updates. Neither is wrong.

## What Proxies are genuinely for

| Use | Who |
|---|---|
| reactivity | Vue 3, MobX, Valtio, Solid stores |
| copy-on-write drafts | Immer, Redux Toolkit |
| **a typed-looking RPC client** | Comlink, tRPC-style clients |
| mocking and spying | test libraries |
| lazy loading of relations | ORMs, GraphQL clients |
| **access control / typo detection** | config objects |

The RPC one is worth stealing — ~20 lines gives you `api.users.byId(42).posts.list()` with no
codegen: a `get` trap that returns another proxy with the key appended, and an `apply` trap that sends
the accumulated path. That's how Comlink makes a worker look like a local object.

The underrated one for application code: **a config proxy that throws on an unknown key** turns
`config.timout` from a silent `undefined` into an immediate located error.

The one to be sceptical about: negative array indices. It's in every tutorial, it makes an array that
isn't quite an array, and `arr.at(-1)` exists.

## The limits

1. **Invariants.** A proxy may not lie about a non-configurable, non-writable property — the engine
   throws. This is what keeps `Object.freeze` meaningful through a proxy.
2. **Internal slots.** `new Proxy(new Map(), {}).get(k)` throws, because `Map.prototype.get` reads a
   slot on the *target*. Binding methods to the target fixes it and then breaks reactivity for
   mutations — which is why Vue writes explicit collection handlers. Same for `#private` fields.
3. **Identity.** The proxy is a different object: `===` fails, `WeakMap` lookups by target miss. Every
   serious proxy library keeps a target↔proxy `WeakMap` in both directions.

`Proxy.revocable` is genuinely useful and little-known: hand out a proxy, revoke it when a component
unmounts, and every later access throws instead of silently working against stale state.

## Think about

- Why does React not use proxies for state?
- Why does `new Proxy(new Map(), {})` throw?
- When is the proxy tax irrelevant?

<details>
<summary>Answers</summary>

**React and proxies.** Three reasons. Performance: every property access in your app would pay the
tax. Predictability: React's model is "state is a plain immutable value; you tell me when it
changes", which makes rendering a pure function of props and state and makes time-travel, replay and
concurrent rendering tractable. And interop: proxies leak into everything they touch — identity
checks, `WeakMap` keys, third-party libraries that check internal slots — which is a large surface for
subtle bugs.

**`new Proxy(new Map(), {})`.** `Map.prototype.get` reads the `[[MapData]]` internal slot from its
`this`. When called on the proxy, `this` is the proxy, which has no such slot, so it throws. Binding
the method to the target fixes the call — and then mutations happen directly on the target, invisible
to your traps, which is why collection reactivity needs hand-written handlers.

**When the tax is irrelevant.** When accesses are counted in thousands rather than millions — which
is virtually all UI code. A form, a settings panel, a dashboard with a hundred bound values: the proxy
overhead is unmeasurable next to one layout pass. It becomes relevant in render loops, parsers,
comparators, and any code that reads the same property in a tight loop.
</details>

---

## 🏗️ Build challenge

1. Write `reactive()` and `effect()` from scratch. Then add: batching (collect triggers, flush once
   in a microtask), dependency cleanup between runs, and a recursion guard.
2. Build the RPC proxy and use it to talk to a Web Worker. Compare with hand-written message plumbing.
3. Add a config proxy that throws on unknown keys and put it in front of your app's settings object.
4. Measure the tax on your own hot path before adopting any proxy-based library.
5. Wrap a `Map` in a proxy and hit the internal-slot error deliberately, then fix it.

**Done when:** you can explain why `state.count++` re-renders exactly one component in Vue and why
React needs you to say so.

---

## Interview questions

1. Why must trap implementations use `Reflect`?
2. How does proxy-based reactivity discover dependencies?
3. What is structural sharing and why does React depend on it?
4. What does a Proxy cost, and why?
5. Name three things a Proxy cannot transparently wrap.
