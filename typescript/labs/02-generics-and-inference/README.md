# Lab 02 — Generics & inference ⭐⭐⭐⭐⭐

**Goal:** stop guessing why something inferred `unknown`.

```sh
npm run check 02
```

---

## Literal inference is about *positions*, not generics

| Expression | Infers | Why |
|---|---|---|
| `identity('hello')` | `'hello'` | a naked `T` from a literal argument keeps the literal |
| `identity({k: 'hello'})` | `{k: string}` | the literal is in a **mutable position** — you could reassign `k` |
| `inArray(['hello'])` | `string[]` | same reason |
| `let d = 'hello'` | `string` | a mutable binding always widens |

The rule is **widening positions**: if the value could later be reassigned, the literal type would be
a lie, so it widens.

**`const` type parameters** (TS 5.0) opt out:

```ts
declare function preserve<const T>(value: T): T;
preserve({ k: 'hello' })   // { readonly k: 'hello' }
```

That's the right tool for config objects, route tables and tuple-shaped arguments — it's `as const`
applied at the *signature*, so callers don't have to remember.

## The `keyof` pattern

```ts
function get<O, K extends keyof O>(obj: O, key: K): O[K]
```

Two type parameters and an **indexed access type** give you exact per-key return types. This is the
single most reused generic shape in TypeScript, and it's the basis of lab 05's dotted-path getter.

## Distribution, again

```ts
type ToArray<T> = T extends unknown ? T[] : never;
ToArray<string | number>        // string[] | number[]
```

The conditional applies to each member separately, then re-unions. To get `(string | number)[]`,
wrap **both sides** in a tuple: `[T] extends [unknown] ? T[] : never`.

Distribution is a feature more often than a bug — it's how `Exclude`, `Extract` and `NonNullable`
work — but you have to know when you're getting it.

## `infer` is pattern matching

```ts
type ElementOf<T> = T extends readonly (infer U)[] ? U : never;
type Awaited2<T>  = T extends Promise<infer U> ? Awaited2<U> : T;   // recursion is allowed
```

Recursive conditional types are how the built-in `Awaited` is implemented, and they're the entry
point to lab 05.

## Unification: how `pipe` type-checks

```ts
declare function pipe2<A, B, C>(f: (a: A) => B, g: (b: B) => C): (a: A) => C;
```

`B` appears in both parameters, so the compiler **unifies** them. If `g` doesn't accept what `f`
returns, there's no valid `B` and the *call site* errors. That single trick is how every functional
composition library gets its type safety, and it generalises to variadic tuples for n-ary `pipe`.

## Think about

- Your generic function inferred `unknown`. What are the two usual causes?
- When should a type parameter have a default?
- Why constrain with `extends` at all if the body works anyway?

<details>
<summary>Answers</summary>

**Inferred `unknown`.** Either there was **no inference site** — the type parameter appears only in
the return type, so nothing constrains it (`function make<T>(): T`, which is really a disguised
`as`) — or inference was **blocked by a lower-priority position**, typically the parameter appearing
inside a callback return or behind a conditional type. The fix is to give the compiler an argument
whose type determines the parameter, or to accept an explicit type argument.

**Defaults.** When the parameter is genuinely optional for most callers and there's an obvious
common case — `Result<T, E = Error>`, `Emitter<E = Record<string, unknown>>`. Note defaults are
*positional*, so an unused-but-defaulted parameter before a used one forces callers to spell out
both. Order parameters by how often they're specified.

**Why constrain.** Three reasons: it lets you *use* the parameter in the body (`T extends {id:
string}` means you can read `.id`), it improves error messages at the call site (the error points at
the argument rather than deep inside), and it changes inference — as with `<T extends string>`,
where the constraint tells the compiler a narrow inference is meaningful.
</details>

---

## Interview questions

1. Why does `identity('a')` keep the literal but `identity({k:'a'})` doesn't?
2. What does `const T` do?
3. Write `get(obj, key)` with an exact return type.
4. What is distribution, and how do you suppress it?
5. How does `pipe(f, g)` catch a mismatch at compile time?
