/** Lab 07 — solution. */
import type { Equal, Expect } from '../../src/expect.js';

// `noUncheckedIndexedAccess` makes every index access include undefined, which is the TRUTH:
// `arr[0]` on an empty array is undefined at runtime, and without the flag TypeScript lies.
// It is noisy at first and it catches a real class of production crashes.
declare const arr: string[];
const first = arr[0];
type T1 = Expect<Equal<typeof first, string | undefined>>;

declare const record: Record<string, number>;
const value = record['key'];
type T2 = Expect<Equal<typeof value, number | undefined>>;

type Opts = { a?: string };
// `exactOptionalPropertyTypes` distinguishes "the property is absent" from "the property is
// present and undefined". Without it, `{a: undefined}` satisfies `{a?: string}`, which breaks any
// code that uses `'a' in obj` or `Object.keys` to decide whether a value was supplied.
//   const o: Opts = { a: undefined };   // Type 'undefined' is not assignable to type 'string'
type OptsAllowingUndefined = { a?: string | undefined };
declare const o2: OptsAllowingUndefined;
const ok: OptsAllowingUndefined = { a: undefined };
void o2; void ok; void (null as unknown as Opts);

// Module augmentation: reopening a declaration from another module. Interfaces merge; type
// aliases do not — which is the real reason libraries publish interfaces for their public types.
// `vendor.d.ts` in this folder declares the two modules; here we AUGMENT one of them. Because
// this file has top-level imports it is a module, so `declare module` means "reopen", not
// "declare". That distinction is the single most common reason `declare module` "doesn't work".
declare module 'some-http-lib' {
  interface Request { user?: { id: string; roles: string[] } | undefined }
}

// The augmentation is visible everywhere the module is imported:
import type { Request } from 'some-http-lib';
declare const req: Request;
void req.user?.roles;

// An ambient declaration for a library with no types at all lives in vendor.d.ts — read it. It is
// a promise you are making to the compiler; nothing verifies it, so keep it minimal and correct
// rather than complete and wrong.
import formatDate, { PATTERNS } from 'untyped-date-lib';
void formatDate; void PATTERNS;

type Theme = Record<string, `#${string}`>;

// An annotation WIDENS the value to the annotated type, losing the keys.
const annotated: Theme = { primary: '#fff', danger: '#f00' };
type T3 = Expect<Equal<keyof typeof annotated, string>>;

// `satisfies` CHECKS without widening: you get the constraint AND the literal type. This is the
// right tool for config objects, theme tokens, route tables and anything you want to key into.
const checked = { primary: '#fff', danger: '#f00' } satisfies Theme;
type T4 = Expect<Equal<keyof typeof checked, 'primary' | 'danger'>>;
type T5 = Expect<Equal<(typeof checked)['primary'], '#fff'>>;

// A cross-product template literal is 3 × 3 × 3 = 27 members. That is fine; the same shape with
// four ten-member unions is 10,000 and the compiler will slow noticeably, and past ~100,000 it
// refuses outright. Union size is the most common cause of a slow editor in a typed codebase.
type BigUnion = `${'a' | 'b' | 'c'}-${'1' | '2' | '3'}-${'x' | 'y' | 'z'}`;
type T6 = Expect<Equal<BigUnion extends string ? true : false, true>>;

// INTERFACES for large object shapes that are extended or implemented widely: the compiler caches
// their resolved members and can compare them by identity. A large type alias built from
// intersections is re-resolved structurally at each use, which is why replacing a few hot aliases
// with interfaces is a standard fix for a slow `tsc`.
//
// Diagnose with:  tsc --noEmit --extendedDiagnostics       (check "Instantiations")
//                 tsc --noEmit --generateTrace ./trace     (then analyze-trace)

export type { T1, T2, T3, T4, T5, T6, OptsAllowingUndefined };
