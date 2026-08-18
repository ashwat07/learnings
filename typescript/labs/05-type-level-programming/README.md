# Lab 05 — Type-level programming ⭐⭐⭐⭐⭐⭐

**Goal:** the techniques behind every "magically typed" library you've used.

```sh
npm run check 05
```

---

## Four things you'll build

| | What it demonstrates |
|---|---|
| **`PathParams<'/users/:id'>`** → `{id: string}` | recursive template-literal parsing |
| **`Paths<Config>`** → `'server.tls.enabled' \| …` | recursive key collection with a dotted accumulator |
| **`Add<3, 4>`** → `7` | type-level arithmetic via tuple lengths |
| **a typed `Emitter`** | variadic tuples that make an argument required *or forbidden* |

None of these is a party trick. `params.id` being typed without a generic argument is the difference
between a route table you trust and one you grep.

## The route parser

```ts
type PathParams<P extends string> =
  P extends `${string}:${infer Param}/${infer Rest}` ? { [K in Param]: string } & PathParams<`/${Rest}`>
  : P extends `${string}:${infer Param}` ? { [K in Param]: string }
  : {};
```

Two patterns matched in order: a parameter followed by more path, then a parameter at the end.

**You'll need `Simplify`:**

```ts
type Simplify<T> = { [K in keyof T]: T[K] } & {};
```

`A & B` and `{...A, ...B}` are mutually assignable but **not `Equal`**, so type tests fail without
flattening. This trips up everyone writing type tests for the first time, and it's also what makes
hover tooltips readable instead of showing a chain of intersections.

## Dotted paths

`Paths<T>` plus `ValueAt<T, P>` gives you:

```ts
declare function getIn<T, P extends Paths<T>>(obj: T, path: P): ValueAt<T, P>;
getIn(config, 'server.port')    // number
getIn(config, 'server.prot')    // compile error, with autocomplete on the string
```

Constraining `P` to `Paths<T>` is what produces both the error *and* editor autocomplete inside a
string literal. It's the same mechanism behind typed i18n keys, typed form field paths, and typed
object-path utilities.

`& string` appears in these types because `keyof` can include `number` and `symbol`, which can't be
interpolated into a template literal.

## Type-level arithmetic

The compiler has no number arithmetic, so you count with **tuple lengths**:

```ts
type Tuple<N extends number, Acc extends unknown[] = []> =
  Acc['length'] extends N ? Acc : Tuple<N, [...Acc, unknown]>;
type Add<A extends number, B extends number> = [...Tuple<A>, ...Tuple<B>]['length'];
```

Genuinely useful for fixed-length tuples and bounded recursion, and genuinely limited: the recursion
limit is around 1,000 (higher for tail-recursive conditional types, which TS optimises), and every
step costs compile time. **If you're doing arithmetic in types, ask what you're actually solving.**

## The typed emitter — the one worth shipping

```ts
emit<K extends keyof E>(event: K, ...args: E[K] extends undefined ? [] : [payload: E[K]]): void;
```

A conditional **variadic tuple** makes `emit('close')` legal and `emit('keypress')` an error. Note
the labelled tuple element `[payload: E[K]]` — that label shows up in the editor's parameter hints,
which is a small thing that makes a typed API feel finished.

## Think about

- When is type-level programming worth it, and when is it a liability?
- Why do type tests need `Simplify`?
- What limits recursion depth?

<details>
<summary>Answers</summary>

**Worth it vs liability.** Worth it at an **API boundary many people use** — a router, a query
builder, an emitter, an i18n key checker — where the type does work for every caller and you pay the
complexity once. A liability inside application code, where the next person to touch it has to
understand it before they can change a feature, and where the error messages when it goes wrong are
genuinely awful. Rule of thumb: if a type is more than ~10 lines and isn't in a library boundary,
question it.

**`Simplify` in tests.** `Equal<X, Y>` is stricter than mutual assignability — it compares the types
as the compiler represents them. `{a: string} & {b: number}` is represented as an *intersection*,
not as a single object type, so it isn't `Equal` to `{a: string; b: number}` even though the two
accept exactly the same values. Mapping over the keys forces the compiler to materialise a single
object type.

**Recursion depth.** TypeScript caps instantiation depth (historically ~50 for general recursive
conditional types, ~1,000 for tail-recursive ones it can optimise into a loop). Hitting it gives
"Type instantiation is excessively deep and possibly infinite". The fixes: restructure to be
tail-recursive (accumulate in a parameter rather than composing on the way out), reduce the input,
or accept a less precise type.
</details>

---

## Interview questions

1. How would you type a router so `params` is inferred from the path string?
2. What does `Simplify` do and why is it needed?
3. How do you do arithmetic in the type system, and what limits it?
4. How do you make an argument required for some keys and forbidden for others?
5. When would you *not* write a type like these?
