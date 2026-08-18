/** Lab 03 — solution. */
import type { Equal, Expect } from '../../src/expect.js';

type State =
  | { status: 'idle' }
  | { status: 'loading'; startedAt: number }
  | { status: 'success'; data: string[] }
  | { status: 'error'; error: Error };

function render(state: State): string {
  switch (state.status) {
    case 'idle': return 'Nothing yet';
    case 'loading': return `Loading since ${state.startedAt}`;
    case 'success': return `${state.data.length} items`;
    case 'error': return state.error.message;
    default: {
      // After every case is handled, `state` is `never`. Add a fifth variant to State and this
      // line becomes an error — which is the entire value of the pattern: the compiler finds
      // every place that needs updating, instead of you finding them in production.
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}
void render;

declare function assertNever(value: never): never;
void assertNever;

// A type predicate: the return type `v is string` tells the compiler what a `true` result proves.
// The compiler does NOT verify the implementation matches the claim — a predicate is an assertion
// you are making, which is why they belong at trust boundaries and should be small enough to read.
declare function isString(v: unknown): v is string;

const mixed: unknown = 'x';
if (isString(mixed)) {
  type T3 = Expect<Equal<typeof mixed, string>>;
  void (null as unknown as T3);
}

const values: (string | null)[] = ['a', null, 'b'];
// `NonNullable<T>` plus a predicate is the idiomatic filter. Without the predicate, `filter`
// returns (string | null)[] — the compiler cannot know the callback removed the nulls.
declare function isPresent<T>(v: T): v is NonNullable<T>;
const present = values.filter(isPresent);
type T4 = Expect<Equal<typeof present, string[]>>;

// An ASSERTION SIGNATURE narrows for the rest of the scope rather than inside a branch.
// Note the requirement: an assertion function must have an explicit type annotation at the
// declaration site — you cannot infer one, and `const f = (x): asserts x is T => {}` is an error.
declare function assertIsDefined<T>(value: T): asserts value is NonNullable<T>;

function useIt(maybe: string | undefined) {
  assertIsDefined(maybe);
  type T5 = Expect<Equal<typeof maybe, string>>;
  void (null as unknown as T5);
  return maybe;
}
void useIt;

type Shape = { kind: 'circle'; r: number } | { kind: 'square'; side: number };

function area(s: Shape): number {
  if ('r' in s) return Math.PI * s.r ** 2;
  return s.side ** 2;
}
void area;

function brokenNarrowing(s: Shape) {
  // Narrowing through a `const` boolean DOES work since TypeScript 4.4 (aliased conditions), but
  // ONLY when the alias is a `const` and the discriminant is not reassigned. It does NOT work
  // through a `let`, through a function boundary, or through a property of an object — which is
  // why extracting a "isCircle" helper method loses the narrowing and a type predicate is needed.
  const isCircle = s.kind === 'circle';
  if (isCircle) return s.r;
  return s.side;
}
void brokenNarrowing;

export type { T4 };
export { render as _render };
