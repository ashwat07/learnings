/** Lab 01 — solution. */
import type { Equal, Expect, ExpectFalse, Extends } from '../../src/expect.js';

interface Point { x: number; y: number }
interface Vector { x: number; y: number }

// Structural typing: same shape, so yes. The names are irrelevant.
type T1 = Expect<Equal<Extends<Vector, Point>, true>>;

const point3d = { x: 1, y: 2, z: 3 };
const p: Point = point3d;
void p;

// A FRESH OBJECT LITERAL assigned directly to a typed target gets excess property checking,
// because an extra property in a literal is almost always a typo or a misunderstanding — there
// is no other reference to the object, so the extra data is simply lost.
//   const literal: Point = { x: 1, y: 2, z: 3 };   // Object literal may only specify known properties
// Assigning through a variable (as above) opts out, because the object has another identity.

type A = { a: string; shared: string };
type B = { b: number; shared: string };

// Only the properties present in EVERY member of the union can be read without narrowing.
type ReadableFromUnion = 'shared';
type T3 = Expect<Equal<ReadableFromUnion, 'shared'>>;

type IntersectionKeys = keyof (A & B);
type T4 = Expect<Equal<IntersectionKeys, 'a' | 'shared' | 'b'>>;

type T5 = Expect<Equal<keyof (A | B), 'shared'>>;

interface Merged { a: string }
interface Merged { b: number }
type T6 = Expect<Equal<keyof Merged, 'a' | 'b'>>;

type Status = 'idle' | 'loading' | 'done';
type T7 = Expect<Equal<Status, 'idle' | 'loading' | 'done'>>;

type HandlerA = (e: { type: string }) => void;
type HandlerB = (e: { type: string; detail: number }) => void;

// A function that requires LESS can be used where one requiring MORE is expected: callers will
// pass the richer event, and HandlerA simply ignores the extra field. This is contravariance.
type T8 = Expect<Equal<Extends<HandlerA, HandlerB>, true>>;
// The reverse is unsound — HandlerB would read `detail` from an object that may not have it.
type T9 = Expect<Equal<Extends<HandlerB, HandlerA>, false>>;

type T10 = Expect<Equal<Extends<string, unknown>, true>>;   // unknown is the top type
type T11 = Expect<Equal<Extends<unknown, string>, false>>;
// `Extends<T, U>` distributes over a naked type parameter, and `never` is the empty union — so
// distributing over it yields `never`, not `true`. This is why every real-world `IsNever<T>` is
// written as `[T] extends [never]`: the tuple wrapper SUPPRESSES distribution.
type T12 = Expect<Equal<Extends<never, string>, never>>;
type T12b = Expect<Equal<[never] extends [string] ? true : false, true>>;
type T13 = ExpectFalse<Equal<any, unknown>>;

export type { T1, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T12b, T13, ReadableFromUnion, IntersectionKeys, Status };
