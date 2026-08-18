# Lab 06 — Branded types & boundaries ⭐⭐⭐⭐⭐

**Goal:** the two habits that change how much your types are actually worth.

```sh
npm run check 06
```

---

## Nominal typing on a structural system

```ts
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

type UserId = Brand<string, 'UserId'>;
type PostId = Brand<string, 'PostId'>;
```

A phantom property that ordinary code can never produce. It doesn't exist at runtime — the whole
thing erases to `string`, so branding is **free**.

Using a `unique symbol` key rather than a string keeps it out of autocomplete and out of `keyof`,
which matters if the branded type is ever mapped over.

The result: a `UserId` is still usable everywhere a `string` is, but a bare `string` can't be passed
where a `UserId` is required. The cast lives in exactly **one** place — the constructor — and
everything downstream is guaranteed by the type system rather than by discipline.

**Where it pays:** ids of different entities, validated email addresses, sanitised HTML, currency
minor units, encoded vs decoded URLs, hashed vs plaintext passwords. Anywhere two things are the same
*primitive* and must never be swapped.

## Parse, don't validate

```ts
// validate: returns a boolean, and the caller still has raw data
function isValidUser(raw: unknown): boolean

// parse: returns a TYPE that proves the check happened
function parseUser(raw: unknown): { ok: true; value: ValidUser } | { ok: false; error: string }
```

The second one makes it **impossible to forget**. There is no `ValidUser` in the program that didn't
come through the parser, so nothing downstream needs a defensive check.

Returning a `Result` rather than throwing forces the caller to handle failure — nothing in a
signature says a function can throw, so exceptions are invisible to the type system.

## The network boundary

```ts
const data = await res.json();    // any — the biggest lie in a TypeScript codebase
```

`Response.json()` returns `any`, and from that point the compiler stops helping. Two fixes:

```ts
declare function safeFetch(url: string): Promise<unknown>;
declare function typedFetch<T>(url: string, parse: (d: unknown) => T): Promise<T>;
```

`unknown` is the honest type for anything that crossed the network. It's not pedantry: the server
can and will change, and a generated client that says `Promise<User>` is asserting something nobody
verified at runtime. Pair it with **Zod**, **Valibot** or **ArkType** and the parser *is* the type.

## Make illegal states unrepresentable

```ts
type Bad  = { loading: boolean; data?: string[]; error?: Error };   // 8 combinations, 4 nonsense
type Good = { status: 'idle' } | { status: 'loading' }
          | { status: 'success'; data: string[] }
          | { status: 'error'; error: Error };
```

"Loading **and** error **and** data" becomes unspellable rather than merely unlikely — and it pairs
with the exhaustiveness check from [lab 03](../03-narrowing-and-exhaustiveness/), so adding a state
finds every consumer.

This is also exactly the modelling in
[architecture-and-state lab 05](../../../architecture-and-state/labs/05-state-machines/), arriving
from the type system instead of from state-machine theory.

## Think about

- Where would branding pay off in your codebase today?
- Is `as` ever acceptable?
- If you validate at the boundary, do you still need runtime checks deeper in?

<details>
<summary>Answers</summary>

**Where branding pays.** Look for functions taking two or more parameters of the same primitive type
— `transfer(fromAccount: string, toAccount: string, amount: number)` is a bug waiting to happen and
branding makes the swap a compile error. Also: anything where "checked" and "unchecked" versions of
the same shape coexist (sanitised HTML, validated email, normalised path), and any id that could be
passed to the wrong lookup.

**`as`.** Acceptable in exactly three places: inside a brand constructor after the real check, in
test fixtures where you're deliberately constructing a partial object, and when you genuinely know
something the compiler cannot (a `document.getElementById` you control). Everywhere else it's a
silenced error. `as unknown as X` is a much louder signal and should attract a comment explaining
why.

**Checks deeper in.** No — that's the point. If the only way to obtain a `ValidUser` is through the
parser, then any function taking a `ValidUser` can trust it, and a defensive check inside is dead
code that suggests the type is not to be believed. The exception is a genuine second trust boundary:
data that leaves and re-enters (localStorage, a URL, a message from another window) is untrusted
again and needs re-parsing.
</details>

---

## Interview questions

1. How do you get nominal typing in a structural type system, and what does it cost at runtime?
2. What's the difference between validating and parsing?
3. Why is `res.json()` returning `any` a problem?
4. Show a state shape with illegal combinations and fix it.
5. When is `as` acceptable?
