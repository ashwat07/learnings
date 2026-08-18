# Lab 03 — Narrowing & exhaustiveness ⭐⭐⭐⭐⭐

**Goal:** make a forgotten case a compile error.

```sh
npm run check 03
```

---

## The single most valuable pattern

```ts
default: {
  const _exhaustive: never = state;   // add a variant → this line errors
  return _exhaustive;
}
```

After every case is handled, the value is `never`. Add a fifth variant to the union and **the
compiler finds every place that needs updating** — instead of you finding them in production.

That is, in practice, the largest benefit of using TypeScript at all. Everything else is
autocomplete.

## The four narrowing mechanisms

| Mechanism | Looks like | Use when |
|---|---|---|
| **discriminated union** | `switch (s.status)` | you control the data — always prefer this |
| `in` | `if ('r' in s)` | no discriminant field available |
| **type predicate** | `v is string` | a runtime check the compiler can't see |
| **assertion signature** | `asserts v is T` | narrowing that must persist after the call |

## Predicates are promises, not proofs

```ts
function isString(v: unknown): v is string { /* the compiler does NOT check this */ }
```

The compiler takes your word for it. That's why predicates belong at **trust boundaries** and should
be small enough to read in one glance — a wrong predicate is a lie that propagates silently.

The one you'll use most:

```ts
declare function isPresent<T>(v: T): v is NonNullable<T>;
values.filter(isPresent)   // string[] instead of (string | null)[]
```

Without the predicate, `filter` can't know your callback removed the nulls.

## Assertion signatures

```ts
declare function assertIsDefined<T>(v: T): asserts v is NonNullable<T>;
```

Narrows for the **rest of the scope** rather than inside a branch. One requirement that catches
everyone: an assertion function needs an **explicit type annotation at the declaration site** — you
can't infer one, and `const f = (x): asserts x is T => {}` is an error.

## Where narrowing is lost

Since TS 4.4, narrowing through a `const` boolean works (**aliased conditions**):

```ts
const isCircle = s.kind === 'circle';
if (isCircle) return s.r;               // ✅ narrows
```

It does **not** work through a `let`, through a function boundary, or through an object property.
Which is exactly why extracting `shape.isCircle()` as a helper loses the narrowing — and why the
helper needs to be a type predicate.

## Think about

- Why does narrowing get lost inside a callback?
- When is a predicate more appropriate than a `switch`?
- `never` vs `unknown` vs `void` — what does each mean in a return position?

<details>
<summary>Answers</summary>

**Narrowing inside a callback.** The compiler can't know *when* the callback runs. If a value was
narrowed to `string` and the callback might run later, something could have reassigned it in
between — so for `let` bindings captured in closures the narrowing is discarded. `const` bindings
keep their narrowing into callbacks, which is one more reason to default to `const`.

**Predicate over `switch`.** When the data isn't yours to shape — a third-party payload, an
`unknown` from the network, a DOM node you need to identify. A discriminated union is strictly
better when you control the type, because the compiler *verifies* the narrowing instead of trusting
you.

**`never` / `unknown` / `void`.** `never` means the function **doesn't return** — it throws or loops
forever — and is the type of the exhaustiveness variable. `unknown` means it returns something you
must narrow before using. `void` means the return value exists but should be ignored; notably, a
function returning something *is* assignable to a `void`-returning type, which is why
`arr.forEach(x => arr2.push(x))` compiles.
</details>

---

## Interview questions

1. Write the exhaustiveness check and explain what it buys you.
2. Does the compiler verify a type predicate?
3. What's the difference between `v is T` and `asserts v is T`?
4. Where does narrowing get lost?
5. Why is a discriminated union better than optional fields?
