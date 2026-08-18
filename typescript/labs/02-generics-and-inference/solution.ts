/** Lab 02 — solution. */
import type { Equal, Expect } from '../../src/expect.js';

declare function identity<T>(value: T): T;
type T1 = Expect<Equal<ReturnType<typeof identity<string>>, string>>;

// The real rule is about WIDENING POSITIONS, not about generics.
//   · a naked type parameter inferred directly from a literal argument KEEPS the literal
//   · a literal inside an object or array property is in a MUTABLE position, so it widens —
//     because `{k: 'hello'}` is an object whose `k` you could later reassign
//   · a `let` binding always widens, for the same reason
declare function inArray<T>(value: T[]): T[];

const a = identity('hello');
const b = identity({ k: 'hello' });
const c = inArray(['hello']);
let   d = 'hello';

type T2a = Expect<Equal<typeof a, 'hello'>>;
type T2b = Expect<Equal<typeof b, { k: string }>>;
type T2c = Expect<Equal<typeof c, string[]>>;
type T2d = Expect<Equal<typeof d, string>>;

// `const T` (TypeScript 5.0) tells the compiler to infer as if the argument had `as const` —
// which is exactly what you want for config objects, route tables and tuple-shaped arguments.
declare function preserve<const T>(value: T): T;
const kept = preserve({ k: 'hello' });
type T3 = Expect<Equal<typeof kept, { readonly k: 'hello' }>>;

declare function get<O, K extends keyof O>(obj: O, key: K): O[K];

const user = { id: 1, name: 'ash', active: true };
type T4 = Expect<Equal<ReturnType<typeof get<typeof user, 'name'>>, string>>;
type T5 = Expect<Equal<ReturnType<typeof get<typeof user, 'id'>>, number>>;

type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };
type T6 = Expect<Equal<Result<number>, { ok: true; value: number } | { ok: false; error: Error }>>;

type ToArray<T> = T extends unknown ? T[] : never;
// Distribution: the conditional is applied to each union member separately, then re-unioned.
type T7 = Expect<Equal<ToArray<string | number>, string[] | number[]>>;

// Wrapping BOTH sides in a tuple suppresses distribution.
type ToArrayNonDist<T> = [T] extends [unknown] ? T[] : never;
type T8 = Expect<Equal<ToArrayNonDist<string | number>, (string | number)[]>>;

type ElementOf<T> = T extends readonly (infer U)[] ? U : never;
type T9 = Expect<Equal<ElementOf<string[]>, string>>;
type T10 = Expect<Equal<ElementOf<Array<{ a: 1 }>>, { a: 1 }>>;

// Recursive conditional types are allowed and are how the built-in Awaited works.
type Awaited2<T> = T extends Promise<infer U> ? Awaited2<U> : T;
type T11 = Expect<Equal<Awaited2<Promise<Promise<number>>>, number>>;
type T12 = Expect<Equal<Awaited2<string>, string>>;

declare function curry2<A, B, R>(fn: (a: A, b: B) => R): (a: A) => (b: B) => R;
const add = (a: number, b: string) => `${a}${b}`;
const curried = curry2(add);
type T13 = Expect<Equal<typeof curried, (a: number) => (b: string) => string>>;

// B appears in both positions, so the compiler UNIFIES them: if `g` does not accept what `f`
// returns, there is no valid B and the call is an error at the call site.
declare function pipe2<A, B, C>(f: (a: A) => B, g: (b: B) => C): (a: A) => C;
const toLen = (s: string) => s.length;
const isEven = (n: number) => n % 2 === 0;
const piped = pipe2(toLen, isEven);
type T14 = Expect<Equal<typeof piped, (a: string) => boolean>>;

export type { T1, T2a, T2b, T2c, T2d, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T13, T14, Result, ToArrayNonDist, ElementOf, Awaited2 };
