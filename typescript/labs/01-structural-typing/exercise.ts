/**
 * Lab 01 — Structural typing, assignability & unions.
 *
 * Replace every `TODO` so the file compiles. Every `Expect<...>` line is an assertion that runs at
 * COMPILE time — `npm run check 01`.
 */

import type { Equal, Expect, ExpectFalse, Extends, TODO } from '../../src/expect.js';

// ---------------------------------------------------------------------------
// 1. Structural typing: a type is a SHAPE, not a name.
// ---------------------------------------------------------------------------

interface Point { x: number; y: number }
interface Vector { x: number; y: number }

// TODO: is a Vector assignable to a Point? Answer with true or false.
type T1 = Expect<Equal<Extends<Vector, Point>, TODO>>;

// A wider object is assignable to a narrower one — EXCEPT for object LITERALS (see §2).
const point3d = { x: 1, y: 2, z: 3 };
const p: Point = point3d;                        // legal: extra properties are fine here
void p;

// ---------------------------------------------------------------------------
// 2. Excess property checking: the exception that confuses everyone.
// ---------------------------------------------------------------------------

// TODO: uncomment the next line and explain (in a comment) why it errors even though §1 did not.
// const literal: Point = { x: 1, y: 2, z: 3 };

// ---------------------------------------------------------------------------
// 3. Unions and intersections are NOT "or" and "and" in the way you expect.
// ---------------------------------------------------------------------------

type A = { a: string; shared: string };
type B = { b: number; shared: string };

// TODO: which properties can you safely read from an `A | B` without narrowing?
type ReadableFromUnion = TODO;
type T3 = Expect<Equal<ReadableFromUnion, 'shared'>>;

// TODO: what are the keys of `A & B`?
type IntersectionKeys = keyof (A & B);
type T4 = Expect<Equal<IntersectionKeys, TODO>>;

// The counter-intuitive part: keyof DISTRIBUTES over a union as an INTERSECTION.
type T5 = Expect<Equal<keyof (A | B), 'shared'>>;

// ---------------------------------------------------------------------------
// 4. `interface` vs `type`.
// ---------------------------------------------------------------------------

interface Merged { a: string }
interface Merged { b: number }                   // declaration merging — interfaces only
type T6 = Expect<Equal<keyof Merged, TODO>>;

// TODO: write a type alias that is a union. (An interface cannot be one — that is the real
// difference, not the style-guide one.)
type Status = TODO;
type T7 = Expect<Equal<Status, 'idle' | 'loading' | 'done'>>;

// ---------------------------------------------------------------------------
// 5. Assignability of functions: parameters are BIVARIANT for methods, CONTRAVARIANT otherwise.
// ---------------------------------------------------------------------------

type HandlerA = (e: { type: string }) => void;
type HandlerB = (e: { type: string; detail: number }) => void;

// TODO: which direction is safe? A handler that needs LESS can stand in for one that needs MORE.
type T8 = Expect<Equal<Extends<HandlerA, HandlerB>, TODO>>;
type T9 = Expect<Equal<Extends<HandlerB, HandlerA>, TODO>>;

// ---------------------------------------------------------------------------
// 6. The unknown / any / never triangle.
// ---------------------------------------------------------------------------

// TODO: fill in each answer.
type T10 = Expect<Equal<Extends<string, unknown>, TODO>>;   // is string assignable to unknown?
type T11 = Expect<Equal<Extends<unknown, string>, TODO>>;   // and the other way?
// A trap, and it is the single most useful one in the language. `Extends<T, U>` is a conditional
// type over a NAKED type parameter, so it DISTRIBUTES over unions — and `never` is the EMPTY union.
// Distributing over nothing produces nothing.
// TODO: what is Extends<never, string>?  (Hint: it is not `true`.)
type T12 = Expect<Equal<Extends<never, string>, TODO>>;
// And the non-distributive form, which gives the answer you expected:
type T12b = Expect<Equal<[never] extends [string] ? true : false, TODO>>;
type T13 = ExpectFalse<Equal<any, unknown>>;                // they are NOT the same

export type { T1, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T12b, T13, ReadableFromUnion, IntersectionKeys, Status };
