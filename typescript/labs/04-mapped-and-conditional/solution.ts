/** Lab 04 — solution. */
import type { Equal, Expect } from '../../src/expect.js';

type User = { id: number; name: string; email?: string };

type MyPartial<T> = { [K in keyof T]?: T[K] };
type MyRequired<T> = { [K in keyof T]-?: T[K] };      // `-?` REMOVES optionality
type MyReadonly<T> = { readonly [K in keyof T]: T[K] };

type T1 = Expect<Equal<MyPartial<{ a: string }>, { a?: string | undefined }>>;
type T2 = Expect<Equal<MyRequired<{ a?: string }>, { a: string }>>;
type T3 = Expect<Equal<MyReadonly<{ a: string }>, { readonly a: string }>>;
// A homomorphic mapped type PRESERVES readonly and optional modifiers unless you change them —
// which is why MyRequired keeps `readonly` here while removing `?`.
type T4 = Expect<Equal<MyRequired<{ readonly a?: string }>, { readonly a: string }>>;

// `as` remaps the key. Capitalize is one of four intrinsic string types the compiler implements
// natively (Uppercase, Lowercase, Capitalize, Uncapitalize).
//
// The `-?` is load-bearing and easy to miss: key remapping is still HOMOMORPHIC, so without it the
// optional `email?` would produce an optional `getEmail?` — a getter that might not exist, which is
// not what you meant. Modifiers survive remapping unless you strip them.
type Getters<T> = { [K in keyof T as `get${Capitalize<string & K>}`]-?: () => T[K] };
type T5 = Expect<Equal<
  Getters<User>,
  { getId: () => number; getName: () => string; getEmail: () => string | undefined }
>>;

// Remapping a key to `never` DROPS it — the standard filtering idiom.
type FunctionKeys<T> = { [K in keyof T]-?: T[K] extends (...args: never[]) => unknown ? K : never }[keyof T];
type T6 = Expect<Equal<FunctionKeys<{ a: string; run(): void; b: number; go: () => number }>, 'run' | 'go'>>;

// A template literal type distributes over every union member on both sides — 2 × 2 = 4 results.
type Entity = 'user' | 'post';
type EventName = `${Entity}:${'created' | 'deleted'}`;
type T7 = Expect<Equal<EventName, 'user:created' | 'user:deleted' | 'post:created' | 'post:deleted'>>;

type VarName<S> = S extends `--${infer Name}` ? Name : never;
type T8 = Expect<Equal<VarName<'--color-primary'>, 'color-primary'>>;

type FirstParam<F> = F extends (first: infer P, ...rest: never[]) => unknown ? P : never;
type T9 = Expect<Equal<FirstParam<(a: string, b: number) => void>, string>>;

// `...infer _` consumes everything before the last element.
type Last<T> = T extends readonly [...infer _Rest, infer L] ? L : never;
type T10 = Expect<Equal<Last<[1, 2, 3]>, 3>>;

// The function branch matters: without it, a method's parameters get recursed into and you end up
// with an unusable type. Recursion depth is also finite — TypeScript gives up around 50 levels.
type DeepReadonly<T> =
  T extends (...args: never[]) => unknown ? T
  : T extends readonly (infer U)[] ? readonly DeepReadonly<U>[]
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;
type T11 = Expect<Equal<
  DeepReadonly<{ a: { b: string[] } }>,
  { readonly a: { readonly b: readonly string[] } }
>>;

// Distribute the union into function PARAMETER position (contravariant), then ask what single
// function type all of them are assignable to — inference produces the intersection.
type UnionToIntersection<U> =
  (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;
type T12 = Expect<Equal<UnionToIntersection<{ a: 1 } | { b: 2 }>, { a: 1 } & { b: 2 }>>;

export type { T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12,
  MyPartial, MyRequired, MyReadonly, Getters, FunctionKeys, EventName, VarName,
  FirstParam, Last, DeepReadonly, UnionToIntersection };
