/**
 * The type-level assertion toolkit. Everything in these labs is checked by `tsc`, not at runtime —
 * a failing exercise is a COMPILE ERROR, which is the whole point.
 *
 * Read `Equal` twice. It is the most-copied type in the TypeScript ecosystem and it is genuinely
 * strange: two conditional types are assignable to each other only if their check types are
 * *identical* to the compiler's internal relation — which is stricter than mutual assignability.
 * That strictness is exactly what makes it able to distinguish `any` from `unknown`, and
 * `{a: string}` from `{a: string} & {}`.
 */

export type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;

export type NotEqual<X, Y> = Equal<X, Y> extends true ? false : true;

/** Fails to compile unless T is exactly `true`. */
export type Expect<T extends true> = T;

/** Fails to compile unless T is exactly `false`. */
export type ExpectFalse<T extends false> = T;

/** Assignability, which is a WEAKER claim than Equal — useful when you mean "at least". */
export type Extends<A, B> = A extends B ? true : false;

/** True only for `any`. Handy for proving that a type has not silently degraded. */
export type IsAny<T> = 0 extends 1 & T ? true : false;

/** True only for `never`. Note `T extends never` distributes and gives the wrong answer. */
export type IsNever<T> = [T] extends [never] ? true : false;

/** Marks an exercise you have not finished. Replace it with the real type. */
export type TODO = any;
