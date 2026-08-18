# Lab 04 — Mapped & conditional types ⭐⭐⭐⭐⭐

**Goal:** rebuild every utility type from scratch, so none of them are magic.

```sh
npm run check 04
```

---

## Mapped types and the `-` modifier

```ts
type MyPartial<T>  = { [K in keyof T]?: T[K] };
type MyRequired<T> = { [K in keyof T]-?: T[K] };      // -? REMOVES optionality
type MyMutable<T>  = { -readonly [K in keyof T]: T[K] };
```

A mapped type over `keyof T` is **homomorphic**: it *preserves* `readonly` and `?` unless you change
them. That's why `MyRequired<{readonly a?: string}>` gives `{readonly a: string}` — the `?` went, the
`readonly` stayed.

## Key remapping with `as`

```ts
type Getters<T> = { [K in keyof T as `get${Capitalize<string & K>}`]-?: () => T[K] };
```

The `-?` is load-bearing: remapping is **still homomorphic**, so an optional `email?` would produce
an optional `getEmail?` — a getter that might not exist.

Remapping a key to `never` **drops** it, which is the standard filtering idiom:

```ts
type FunctionKeys<T> = { [K in keyof T]-?: T[K] extends Function ? K : never }[keyof T];
```

`Capitalize`/`Uppercase`/`Lowercase`/`Uncapitalize` are the four **intrinsic** string types the
compiler implements natively — you can't write them yourself.

## Template literal types distribute

```ts
type EventName = `${'user' | 'post'}:${'created' | 'deleted'}`   // 4 members
```

Both sides distribute, so it's a cross product. That's useful and it's also the main cause of a slow
editor: four ten-member unions is 10,000 types, and past ~100,000 the compiler refuses.

They also **parse**:

```ts
type VarName<S> = S extends `--${infer Name}` ? Name : never;
```

## The union-to-intersection trick

```ts
type UnionToIntersection<U> =
  (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;
```

Distribute the union into **parameter position** (contravariant — lab 01), then ask what single
function type all of them are assignable to. Inference produces the intersection. It's the most
elegant thing in the type system and worth understanding rather than copying.

## `DeepReadonly`, and why the function branch matters

```ts
type DeepReadonly<T> =
  T extends (...args: never[]) => unknown ? T
  : T extends readonly (infer U)[] ? readonly DeepReadonly<U>[]
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;
```

Without the first branch you recurse into a function's *properties* and get something unusable.
Recursion depth is finite too — TypeScript gives up around 50 levels of instantiation depth for
non-tail-recursive types.

## Think about

- When does a mapped type *stop* preserving modifiers?
- Why does `{[K in keyof T]: …}[keyof T]` give you a union of values?
- What makes a type "expensive"?

<details>
<summary>Answers</summary>

**Losing homomorphism.** A mapped type is homomorphic only when it maps over `keyof T` (or a type
parameter constrained to `keyof T`). Map over an explicit union of keys — `{[K in 'a' | 'b']: T[K]}`
— and you get a fresh object type with default modifiers, losing whatever `readonly`/`?` the source
had. Key remapping with `as` *keeps* homomorphism, which is why the `-?` in `Getters` is needed.

**The `[keyof T]` indexed access.** `{[K in keyof T]: X}` builds an object whose values are `X` per
key; indexing that object with `keyof T` asks for "the value at any of these keys", which is the
**union** of all of them. Combined with mapping unwanted keys to `never` (and `never` disappearing
from unions), it's the standard filter-and-collect idiom.

**Expensive types.** Large unions (cross-product template literals are the usual culprit), deep
recursion, and structural comparisons of big anonymous types repeated at many call sites. Measure
with `tsc --extendedDiagnostics` and watch the "Instantiations" count; `--generateTrace` plus
`@typescript/analyze-trace` will name the specific type. Replacing hot type aliases with interfaces
often helps, because interfaces are compared by identity where possible.
</details>

---

## Interview questions

1. What does `-?` do, and when do you need it?
2. How do you filter keys out of a mapped type?
3. Why is a cross-product template literal type risky?
4. Explain `UnionToIntersection`.
5. Why does a recursive `DeepReadonly` need a function branch?
