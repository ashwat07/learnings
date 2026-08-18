# Lab 07 — Declarations & config ⭐⭐⭐⭐

**Goal:** the flags, files and operators that decide what your types are worth in practice.

```sh
npm run check 07
```

---

## The two flags most projects don't enable and should

**`noUncheckedIndexedAccess`** — `arr[0]` becomes `string | undefined`, because it **is**. Without
it, TypeScript tells you an empty array's first element is a `string`, which is a lie that produces
real production crashes. Noisy on day one; closes a genuine class of bug.

**`exactOptionalPropertyTypes`** — distinguishes "the property is absent" from "present and
undefined". Without it, `{a: undefined}` satisfies `{a?: string}`, which breaks any code using `'a'
in obj` or `Object.keys` to decide whether a value was supplied. If you want to allow an explicit
undefined, say so: `{a?: string | undefined}`.

Also worth having: `noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature`,
`verbatimModuleSyntax`, `noImplicitOverride`.

## `satisfies` — the operator that replaced most annotations

```ts
const annotated: Theme = { primary: '#fff' };        // keyof is `string` — keys LOST
const checked = { primary: '#fff' } satisfies Theme; // keyof is 'primary' — checked AND precise
```

An annotation **widens** the value to the annotated type. `satisfies` **checks** without widening, so
you get the constraint *and* the literal type. It's the right tool for config objects, theme tokens,
route tables — anything you want to key into afterwards.

## Ambient declarations vs augmentation

This is the one that confuses everyone:

```ts
// in a file with NO top-level import/export → an AMBIENT DECLARATION (it creates the module)
declare module 'untyped-lib' { export default function f(): void }

// in a file WITH imports/exports → AUGMENTATION (it reopens an existing module)
declare module 'some-lib' { interface Request { user?: User } }
```

Same syntax, opposite meanings, decided by whether the file is a module. That's the reason
"`declare module` doesn't work" — the file had an import in it, so you were augmenting a module that
didn't exist.

**Augmentation only works on interfaces**, because only interfaces merge — which is why libraries
publish their extensible types as interfaces (`Express.Request`, `Window`, `ProcessEnv`).

Read [`vendor.d.ts`](vendor.d.ts) in this lab for both forms.

## Type performance

Symptoms: a slow editor, a slow `tsc`, "type instantiation is excessively deep".

| Cause | Fix |
|---|---|
| **large unions** — cross-product template literals are the usual culprit | narrow the inputs; four ten-member unions is 10,000 types |
| deep recursion | make it tail-recursive, or accept a less precise type |
| big anonymous types compared at many call sites | name them; prefer `interface` for large extended shapes |

Diagnose properly rather than guessing:

```sh
tsc --noEmit --extendedDiagnostics          # watch "Instantiations"
tsc --noEmit --generateTrace ./trace        # then @typescript/analyze-trace
```

Interfaces are cheaper than large intersection-built aliases because the compiler caches their
resolved members and can compare them by identity.

## Think about

- Why does `noUncheckedIndexedAccess` feel wrong at first?
- When should a type be an `interface`?
- Your `tsc` takes 90 seconds. Where do you look?

<details>
<summary>Answers</summary>

**Why it feels wrong.** Because most index accesses in your code *are* in bounds and you know it —
`for (let i = 0; i < arr.length; i++) arr[i]` is provably safe and the compiler still flags it. The
flag is right anyway: it's exactly the accesses you *didn't* think about (a map lookup, an array
after a filter, a `find` result) that crash. Use `at()`, destructuring with defaults, or a local
`const item = arr[i]; if (!item) continue;` — and note the noise largely disappears once you stop
indexing manually.

**When `interface`.** For object shapes that are extended, implemented, or augmented — and for large
shapes used in many places, where the compiler's caching helps. Use `type` when you need a union, a
tuple, a mapped or conditional type, or a function type you want to name. The style-guide argument
("prefer type") is much less important than the two capability differences: interfaces merge, aliases
can be unions.

**90-second `tsc`.** Start with `--extendedDiagnostics` and look at the check time versus parse/bind
time — if checking dominates, it's your types; if parse/bind dominates, it's file count and you want
project references or `skipLibCheck`. Then `--generateTrace` and `analyze-trace` will name the
specific types. The usual finds: one enormous union, a deeply recursive utility applied to a big
type, or a `node_modules` `.d.ts` being checked because `skipLibCheck` is off.
</details>

---

## Interview questions

1. What does `noUncheckedIndexedAccess` change, and why is it worth the noise?
2. `satisfies` vs an annotation — what's the difference?
3. Why does `declare module` sometimes declare and sometimes augment?
4. Why can you only augment interfaces?
5. How would you diagnose a slow `tsc`?
