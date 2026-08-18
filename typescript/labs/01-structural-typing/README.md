# Lab 01 — Structural typing ⭐⭐⭐⭐

**Goal:** know exactly when one type is assignable to another, and why.

```sh
npm run check 01
```

---

## A type is a shape, not a name

`Point` and `Vector` with identical members are the same type. This is the single biggest difference
from Java or C#, and it's why `interface X {}` accepts absolutely everything (every value has at
least no members).

## Excess property checking — the exception

```ts
const p: Point = point3d;                    // fine — point3d has another identity
const q: Point = { x: 1, y: 2, z: 3 };       // ERROR
```

A **fresh object literal** assigned directly to a typed target gets checked for excess properties,
because an extra property in a literal is almost always a typo — there's no other reference to the
object, so the extra data is simply lost. Assigning through a variable opts out.

## Unions and intersections aren't "or" and "and"

- from `A | B` you can only read the properties present in **every** member
- `keyof (A & B)` is the **union** of their keys
- `keyof (A | B)` is the **intersection** of their keys

That last one reads backwards until you say it out loud: the keys you can *definitely* access on
something that is either an A or a B are the ones both have.

## `interface` vs `type`

The real difference isn't style: **interfaces merge** (which is what makes module augmentation
possible — lab 07) and **type aliases can be unions**, which interfaces cannot. Interfaces are also
cheaper for the compiler on large shapes.

## Variance

```ts
type HandlerA = (e: {type: string}) => void;
type HandlerB = (e: {type: string; detail: number}) => void;
```

`HandlerA` **is** assignable to `HandlerB`: a function that needs *less* can stand in for one that
needs *more*, because callers will pass the richer event and it'll ignore the extra field. The
reverse is unsound. That's **contravariance** of parameters, and it's on under
`strictFunctionTypes` — except for **methods**, which stay bivariant for backwards compatibility
with the DOM and array types.

## The trap: `never` distributes

```ts
type Extends<A, B> = A extends B ? true : false;
Extends<never, string>   // never — NOT true
```

A conditional type over a **naked type parameter distributes over unions**, and `never` is the
**empty union**. Distributing over nothing produces nothing.

That's why every real-world `IsNever<T>` is written as `[T] extends [never]` — the tuple wrapper
**suppresses distribution**. You'll use that trick constantly in labs 02 and 04.

## Think about

- Why does `{}` accept almost every value?
- When is excess property checking a nuisance rather than a help?
- Why are method parameters bivariant when function parameters are contravariant?

<details>
<summary>Answers</summary>

**`{}` accepts everything.** Structurally it means "an object with at least no properties", which
every non-null, non-undefined value satisfies — including `42` and `"hi"`, since primitives have
methods. It's almost never what you mean; use `object` for "any object", `Record<string, unknown>`
for "an object with unknown properties", or `unknown` for "anything".

**Excess property checking as a nuisance.** When you're passing a superset deliberately — spreading
extra fields into a props object, or building a config that a plugin will read more of. The
established escape hatches: assign through a variable, use `satisfies` (lab 07), or add an index
signature. Reaching for `as` is the wrong one, because it also disables the checks you wanted.

**Bivariant methods.** For compatibility. `Array<Dog>` being usable as `Array<Animal>` requires
method bivariance (`push(x: Dog)` vs `push(x: Animal)`), and so do huge swathes of the DOM
lib and existing code. The team made function *type* positions strict under `strictFunctionTypes`
and left method-shorthand positions bivariant — a deliberate, documented unsoundness.
</details>

---

## Interview questions

1. What is structural typing, and where does it surprise people?
2. When does excess property checking apply?
3. `keyof (A | B)` — why is it the intersection?
4. Give the one real difference between `interface` and `type`.
5. Why is `Extends<never, string>` not `true`?
