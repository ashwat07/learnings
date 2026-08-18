/**
 * Lab 07 — Declaration files, config & type performance.
 *
 * The unglamorous half: which compiler flags actually change what bugs you can ship, how to type
 * a library that has no types, and why your editor takes four seconds to respond.
 */

import type { Equal, Expect, TODO } from '../../src/expect.js';

// ---------------------------------------------------------------------------
// 1. The flags that change what you can express.
// ---------------------------------------------------------------------------

// With `noUncheckedIndexedAccess` (on in this project), an index access includes undefined.
declare const arr: string[];
const first = arr[0];
// TODO: what is the type of `first`?
type T1 = Expect<Equal<typeof first, TODO>>;

declare const record: Record<string, number>;
const value = record['key'];
type T2 = Expect<Equal<typeof value, TODO>>;

// With `exactOptionalPropertyTypes`, `{ a?: string }` does NOT accept an explicit undefined.
type Opts = { a?: string };
// TODO: uncomment and explain why it errors.
// const o: Opts = { a: undefined };

// TODO: write the type that DOES accept an explicit undefined.
type OptsAllowingUndefined = TODO;
declare const o2: OptsAllowingUndefined;
const ok: OptsAllowingUndefined = { a: undefined };
void o2; void ok;

// ---------------------------------------------------------------------------
// 2. Module augmentation — extending types you do not own.
// ---------------------------------------------------------------------------

// `vendor.d.ts` in this folder declares 'some-http-lib' with a `Request` interface.
// TODO: add an optional `user` property to it WITHOUT editing vendor.d.ts.
//       (Note: this file has imports, so `declare module` here means AUGMENT, not declare.)

// ---------------------------------------------------------------------------
// 3. Typing a JS library that has no types.
// ---------------------------------------------------------------------------

// TODO: read vendor.d.ts, then import from 'untyped-date-lib' and use both exports.
//   import formatDate, { PATTERNS } from 'untyped-date-lib';

// ---------------------------------------------------------------------------
// 4. `satisfies` — the operator that replaced most annotations.
// ---------------------------------------------------------------------------

type Theme = Record<string, `#${string}`>;

// With a plain annotation, the specific keys are LOST.
const annotated: Theme = { primary: '#fff', danger: '#f00' };
type T3 = Expect<Equal<keyof typeof annotated, TODO>>;

// TODO: use `satisfies` so the value is CHECKED against Theme but keeps its literal type.
const checked = { primary: '#fff', danger: '#f00' } TODO;
type T4 = Expect<Equal<keyof typeof checked, 'primary' | 'danger'>>;
type T5 = Expect<Equal<(typeof checked)['primary'], '#fff'>>;

// ---------------------------------------------------------------------------
// 5. Type performance.
// ---------------------------------------------------------------------------

// TODO: which of these is expensive for the compiler, and why? Answer in a comment.
type BigUnion = `${'a' | 'b' | 'c'}-${'1' | '2' | '3'}-${'x' | 'y' | 'z'}`;
type T6 = Expect<Equal<BigUnion extends string ? true : false, true>>;

// TODO: an interface or a type alias for a large object shape that is extended everywhere?
//       (Hint: one of them is cached by the compiler and one is re-evaluated.)

export type { T1, T2, T3, T4, T5, T6, OptsAllowingUndefined };
