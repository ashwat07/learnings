/**
 * Lab 03 — Narrowing, guards & exhaustiveness.
 *
 * The most valuable thing TypeScript does for application code: making it impossible to forget a
 * case. This lab builds the four mechanisms and then the pattern that makes adding a variant a
 * COMPILE error everywhere it matters.
 */

import type { Equal, Expect, TODO } from '../../src/expect.js';

// ---------------------------------------------------------------------------
// 1. Discriminated unions — the single most useful pattern in TypeScript.
// ---------------------------------------------------------------------------

type State =
  | { status: 'idle' }
  | { status: 'loading'; startedAt: number }
  | { status: 'success'; data: string[] }
  | { status: 'error'; error: Error };

// TODO: narrow by the discriminant and return the right thing for each case.
function render(state: State): string {
  switch (state.status) {
    case 'idle': return 'Nothing yet';
    case 'loading': return `Loading since ${state.startedAt}`;
    // TODO: the remaining two cases, plus the exhaustiveness check below.
    default: {
      // TODO: give `_exhaustive` a type that makes this line fail if a case is missing.
      const _exhaustive: TODO = state;
      return _exhaustive;
    }
  }
}
void render;

// ---------------------------------------------------------------------------
// 2. The `never` trick, generalised into a reusable function.
// ---------------------------------------------------------------------------

// TODO: write assertNever so that passing a non-never value is a compile error.
declare function assertNever(value: TODO): never;
void assertNever;

// ---------------------------------------------------------------------------
// 3. Type predicates — teaching the compiler what your runtime check proves.
// ---------------------------------------------------------------------------

// TODO: make this a type predicate so callers get narrowing.
declare function isString(v: unknown): TODO;

const mixed: unknown = 'x';
if (isString(mixed)) {
  type T3 = Expect<Equal<typeof mixed, string>>;
  void (null as unknown as T3);
}

// A predicate the compiler CANNOT infer on its own — filtering out null.
const values: (string | null)[] = ['a', null, 'b'];
// TODO: type `isPresent` so the filtered array is string[].
declare function isPresent<T>(v: T): TODO;
const present = values.filter(isPresent);
type T4 = Expect<Equal<typeof present, string[]>>;

// ---------------------------------------------------------------------------
// 4. Assertion functions — narrowing that persists after the call.
// ---------------------------------------------------------------------------

// TODO: an assertion signature, so `value` is narrowed for the REST of the scope.
declare function assertIsDefined<T>(value: T): TODO;

function useIt(maybe: string | undefined) {
  assertIsDefined(maybe);
  // TODO: after the assertion, what is the type here?
  type T5 = Expect<Equal<typeof maybe, TODO>>;
  return maybe;
}
void useIt;

// ---------------------------------------------------------------------------
// 5. Narrowing that does NOT work, and why.
// ---------------------------------------------------------------------------

type Shape = { kind: 'circle'; r: number } | { kind: 'square'; side: number };

function area(s: Shape): number {
  // `in` narrows too, and is the fallback when there is no discriminant field.
  if ('r' in s) return Math.PI * s.r ** 2;
  return s.side ** 2;
}
void area;

// TODO: this narrowing is LOST. Explain in a comment why, and fix it.
function brokenNarrowing(s: Shape) {
  const isCircle = s.kind === 'circle';
  if (isCircle) {
    // return s.r;   // uncomment: does it compile?
  }
  return 0;
}
void brokenNarrowing;

export type { T4 };
export { render as _render };
