/**
 * Lab 02 — Generics & inference.
 *
 * The theme: TypeScript infers from ARGUMENTS, and you shape that inference with constraints,
 * defaults and where you put the type parameter. Most "why is this `unknown`?" questions are
 * really "the compiler had no inference site".
 */

import type { Equal, Expect, TODO } from '../../src/expect.js';

// ---------------------------------------------------------------------------
// 1. Inference sites.
// ---------------------------------------------------------------------------

declare function identity<T>(value: T): T;
type T1 = Expect<Equal<ReturnType<typeof identity<string>>, TODO>>;

// Literal inference is subtler than "literals widen". Work out each of these four.
declare function inArray<T>(value: T[]): T[];

const a = identity('hello');            // a naked T in an immutable position
const b = identity({ k: 'hello' });     // the literal is inside an object
const c = inArray(['hello']);           // the literal is inside an array
let   d = 'hello';                      // a mutable binding, no generics involved

type T2a = Expect<Equal<typeof a, TODO>>;
type T2b = Expect<Equal<typeof b, TODO>>;
type T2c = Expect<Equal<typeof c, TODO>>;
type T2d = Expect<Equal<typeof d, TODO>>;

// TODO: make `b` keep its literal type too, WITHOUT changing the call site.
// (Hint: `const` type parameters, TypeScript 5.0+.)
declare function preserve<TODO2 extends unknown>(value: TODO2): TODO2;
const kept = preserve({ k: 'hello' });
type T3 = Expect<Equal<typeof kept, { k: 'hello' }>>;

// ---------------------------------------------------------------------------
// 2. Constraints, and the `keyof` pattern that makes property access safe.
// ---------------------------------------------------------------------------

// TODO: type `get` so it returns the exact property type.
declare function get<O, K extends TODO>(obj: O, key: K): TODO;

const user = { id: 1, name: 'ash', active: true };
type T4 = Expect<Equal<ReturnType<typeof get<typeof user, 'name'>>, string>>;
type T5 = Expect<Equal<ReturnType<typeof get<typeof user, 'id'>>, number>>;

// ---------------------------------------------------------------------------
// 3. Generic defaults, and why the order matters.
// ---------------------------------------------------------------------------

// TODO: give Result a default error type of `Error`.
type Result<T, E = TODO> = { ok: true; value: T } | { ok: false; error: E };
type T6 = Expect<Equal<Result<number>, { ok: true; value: number } | { ok: false; error: Error }>>;

// ---------------------------------------------------------------------------
// 4. Distribution — the behaviour that surprises everyone (see lab 01, T12).
// ---------------------------------------------------------------------------

type ToArray<T> = T extends unknown ? T[] : never;
// TODO: is this string[] | number[], or (string | number)[]?
type T7 = Expect<Equal<ToArray<string | number>, TODO>>;

// TODO: write the NON-distributive version, so a union produces ONE array type.
type ToArrayNonDist<T> = TODO;
type T8 = Expect<Equal<ToArrayNonDist<string | number>, (string | number)[]>>;

// ---------------------------------------------------------------------------
// 5. `infer` — pattern matching in the type system.
// ---------------------------------------------------------------------------

// TODO: extract the element type of an array.
type ElementOf<T> = TODO;
type T9 = Expect<Equal<ElementOf<string[]>, string>>;
type T10 = Expect<Equal<ElementOf<Array<{ a: 1 }>>, { a: 1 }>>;

// TODO: unwrap a Promise, however deeply nested. (Recursion is allowed in conditional types.)
type Awaited2<T> = TODO;
type T11 = Expect<Equal<Awaited2<Promise<Promise<number>>>, number>>;
type T12 = Expect<Equal<Awaited2<string>, string>>;

// ---------------------------------------------------------------------------
// 6. Variadic tuples — typing a real function signature.
// ---------------------------------------------------------------------------

// TODO: type `curry2` so the argument types flow through.
declare function curry2<A, B, R>(fn: (a: A, b: B) => R): TODO;
const add = (a: number, b: string) => `${a}${b}`;
const curried = curry2(add);
type T13 = Expect<Equal<typeof curried, (a: number) => (b: string) => string>>;

// TODO: type a `pipe` of two functions where the output of the first must match the input of
// the second — so a mismatch is a COMPILE error, not a runtime one.
declare function pipe2<A, B, C>(f: (a: A) => B, g: (b: B) => C): TODO;
const toLen = (s: string) => s.length;
const isEven = (n: number) => n % 2 === 0;
const piped = pipe2(toLen, isEven);
type T14 = Expect<Equal<typeof piped, (a: string) => boolean>>;

export type { T1, T2a, T2b, T2c, T2d, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T13, T14, Result, ToArrayNonDist, ElementOf, Awaited2 };
