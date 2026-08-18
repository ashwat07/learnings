# TypeScript — the type system as a language ⭐⭐⭐⭐⭐⭐

Every lab here is a set of **compile-time assertions that currently fail**. Your job is to make
`tsc` accept them. There is no runtime, no browser, and no output — if it compiles, you were right.

```sh
cd typescript
npm install                 # typescript only, ~70MB, gitignored
npm run check               # your exercises — all failing, which is the starting state
npm run check 05            # one lab
npm run check:solutions     # the reference answers — all passing
```

Open the files in your editor as you go. Hovering a type is the whole feedback loop.

---

## Curriculum

| # | Lab | What it makes automatic | ⭐ |
|---|---|---|---|
| 01 | [Structural typing](labs/01-structural-typing/) | assignability, excess property checks, variance, the `never` distribution trap | ⭐⭐⭐⭐ |
| 02 | [Generics & inference](labs/02-generics-and-inference/) | where inference comes from, `const` type params, `infer`, distribution | ⭐⭐⭐⭐⭐ |
| 03 | [Narrowing & exhaustiveness](labs/03-narrowing-and-exhaustiveness/) | predicates, assertion signatures, and making a missing case a compile error | ⭐⭐⭐⭐⭐ |
| 04 | [Mapped & conditional types](labs/04-mapped-and-conditional/) | rebuild every utility type from scratch, key remapping, template literals | ⭐⭐⭐⭐⭐ |
| 05 | [Type-level programming](labs/05-type-level-programming/) | a typed router, dotted paths, type-level arithmetic, a typed emitter | ⭐⭐⭐⭐⭐⭐ |
| 06 | [Branded types & boundaries](labs/06-branded-types-and-boundaries/) | nominal typing, parse-don't-validate, making illegal states unrepresentable | ⭐⭐⭐⭐⭐ |
| 07 | [Declarations & config](labs/07-declarations-and-config/) | the flags that change what you can ship, `.d.ts`, `satisfies`, type performance |⭐⭐⭐⭐ |

## The assertion toolkit

[`src/expect.ts`](src/expect.ts) — read `Equal` twice:

```ts
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;
```

It's the most-copied type in the ecosystem and it's genuinely strange: two conditional types are
assignable to each other only if their check types are *identical* under the compiler's internal
relation — stricter than mutual assignability. That strictness is exactly what lets it distinguish
`any` from `unknown`, and `{a: string}` from `{a: string} & {}`.

## The flags this project turns on, and why

| Flag | Catches |
|---|---|
| `strict` | the baseline. Non-negotiable |
| **`noUncheckedIndexedAccess`** | `arr[0]` is `string \| undefined` — because it **is**, and without this TypeScript lies |
| **`exactOptionalPropertyTypes`** | distinguishes "absent" from "present and undefined" |
| `noFallthroughCasesInSwitch` | the missing `break` |
| `noPropertyAccessFromIndexSignature` | `config.tiemout` on a `Record<string, T>` |
| `verbatimModuleSyntax` | import elision surprises at runtime |

The first two are the ones most projects don't enable and should. They're noisy on day one and they
close a real class of production crashes.

## The four ideas worth taking away

1. **Types are a language.** Labs 04 and 05 are programs — recursion, pattern matching, arithmetic.
   Once you see that, `Parameters<T>` and friends stop being magic.
2. **Parse, don't validate.** Do the checking once, at the boundary, and return a type that
   *proves* it happened (lab 06). Everything downstream is then guaranteed rather than hoped.
3. **Make illegal states unrepresentable.** `{loading, data?, error?}` is 8 combinations of which 4
   are nonsense. A discriminated union is 4 states, all legal.
4. **The compiler finds the callers.** Exhaustiveness checking (lab 03) means adding a variant
   produces an error at every place that needs updating — which is the single largest practical
   benefit of the whole language.

Related: [javascript](../javascript/) (this course assumes the runtime semantics) and
[react](../react/) lab 04, which applies all of this to props, hooks and events.
