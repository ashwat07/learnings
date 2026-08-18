/**
 * Lab 04 — Mapped & conditional types.
 *
 * Where TypeScript stops being annotations and starts being a language. Everything here is a
 * transformation FROM one type TO another, evaluated by the compiler.
 */

import type { Equal, Expect, TODO } from '../../src/expect.js';

// ---------------------------------------------------------------------------
// 1. Mapped types — rebuilding an object type key by key.
// ---------------------------------------------------------------------------

type User = { id: number; name: string; email?: string };

// TODO: implement each of these WITHOUT using the built-in utility.
type MyPartial<T> = TODO;
type MyRequired<T> = TODO;
type MyReadonly<T> = TODO;

type T1 = Expect<Equal<MyPartial<{ a: string }>, { a?: string | undefined }>>;
type T2 = Expect<Equal<MyRequired<{ a?: string }>, { a: string }>>;
type T3 = Expect<Equal<MyReadonly<{ a: string }>, { readonly a: string }>>;

// The `-` modifier is the part people miss: `-?` REMOVES optionality, `-readonly` removes readonly.
type T4 = Expect<Equal<MyRequired<{ readonly a?: string }>, { readonly a: string }>>;

// ---------------------------------------------------------------------------
// 2. Key remapping with `as` — renaming and FILTERING keys.
// ---------------------------------------------------------------------------

// TODO: produce { getId(): number; getName(): string; getEmail(): string | undefined }
// Note that every getter must be REQUIRED, even though `email` is optional on User — a getter
// always exists. That needs one extra character beyond the obvious answer.
type Getters<T> = TODO;
type T5 = Expect<Equal<
  Getters<User>,
  { getId: () => number; getName: () => string; getEmail: () => string | undefined }
>>;

// TODO: keep only the keys whose value type is a function. (Hint: map to `never` to DROP a key.)
type FunctionKeys<T> = TODO;
type T6 = Expect<Equal<FunctionKeys<{ a: string; run(): void; b: number; go: () => number }>, 'run' | 'go'>>;

// ---------------------------------------------------------------------------
// 3. Template literal types.
// ---------------------------------------------------------------------------

// TODO: build event names from a union of entities.
type Entity = 'user' | 'post';
type EventName = TODO;
type T7 = Expect<Equal<EventName, 'user:created' | 'user:deleted' | 'post:created' | 'post:deleted'>>;

// TODO: parse a CSS variable name back out.
type VarName<S> = TODO;
type T8 = Expect<Equal<VarName<'--color-primary'>, 'color-primary'>>;

// ---------------------------------------------------------------------------
// 4. Conditional types with `infer` in awkward positions.
// ---------------------------------------------------------------------------

// TODO: get the type of the FIRST parameter of a function.
type FirstParam<F> = TODO;
type T9 = Expect<Equal<FirstParam<(a: string, b: number) => void>, string>>;

// TODO: get the LAST element of a tuple. (Variadic tuple patterns.)
type Last<T> = TODO;
type T10 = Expect<Equal<Last<[1, 2, 3]>, 3>>;

// TODO: a deep readonly, recursing through objects and arrays but NOT functions.
type DeepReadonly<T> = TODO;
type T11 = Expect<Equal<
  DeepReadonly<{ a: { b: string[] } }>,
  { readonly a: { readonly b: readonly string[] } }
>>;

// ---------------------------------------------------------------------------
// 5. The union-to-intersection trick, and why it works.
// ---------------------------------------------------------------------------

// TODO: turn `A | B` into `A & B`. (Hint: contravariance of function parameters, lab 01 T8/T9.)
type UnionToIntersection<U> = TODO;
type T12 = Expect<Equal<UnionToIntersection<{ a: 1 } | { b: 2 }>, { a: 1 } & { b: 2 }>>;

export type { T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12,
  MyPartial, MyRequired, MyReadonly, Getters, FunctionKeys, EventName, VarName,
  FirstParam, Last, DeepReadonly, UnionToIntersection };
