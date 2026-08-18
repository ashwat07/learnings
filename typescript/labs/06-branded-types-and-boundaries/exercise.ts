/**
 * Lab 06 — Branded types & the boundary.
 *
 * TypeScript is structural, which is usually what you want and occasionally a disaster: a `UserId`
 * and a `PostId` are both `string`, so passing one where the other is expected compiles happily.
 *
 * This lab builds nominal typing on top of a structural system, and then applies the one rule that
 * matters most in real applications: PARSE, DON'T VALIDATE.
 */

import type { Equal, Expect, Extends, TODO } from '../../src/expect.js';

// ---------------------------------------------------------------------------
// 1. The problem.
// ---------------------------------------------------------------------------

type PlainUserId = string;
type PlainPostId = string;
declare function deletePost(id: PlainPostId): void;
declare const someUserId: PlainUserId;
deletePost(someUserId);                          // compiles. It should not.

// ---------------------------------------------------------------------------
// 2. Branding.
// ---------------------------------------------------------------------------

// TODO: define a Brand helper that makes two aliases of `string` incompatible.
declare const brand: unique symbol;
type Brand<T, B extends string> = TODO;

type UserId = Brand<string, 'UserId'>;
type PostId = Brand<string, 'PostId'>;

type T1 = Expect<Equal<Extends<UserId, PostId>, TODO>>;
type T2 = Expect<Equal<Extends<UserId, string>, TODO>>;   // a brand should still BE a string
type T3 = Expect<Equal<Extends<string, UserId>, TODO>>;   // but not the other way

// TODO: the only way to create one — a constructor that does the checking.
declare function toUserId(raw: string): TODO;
const uid = toUserId('u_1');
type T4 = Expect<Equal<typeof uid, UserId>>;

// ---------------------------------------------------------------------------
// 3. Parse, don't validate.
// ---------------------------------------------------------------------------

type RawInput = { email: string; age: string };
type ValidUser = { email: Brand<string, 'Email'>; age: number };

// TODO: a parser that returns a Result rather than throwing, so the caller MUST handle failure.
type ParseResult<T> = TODO;
declare function parseUser(raw: RawInput): ParseResult<ValidUser>;

declare const raw: RawInput;
const parsed = parseUser(raw);
if (parsed.ok) {
  type T5 = Expect<Equal<typeof parsed.value, ValidUser>>;
  void (null as unknown as T5);
} else {
  type T6 = Expect<Equal<typeof parsed.error, string>>;
  void (null as unknown as T6);
}

// ---------------------------------------------------------------------------
// 4. The network boundary — where `any` gets in.
// ---------------------------------------------------------------------------

// The default signature of fetch().json() is the biggest source of lies in a TypeScript codebase.
declare function badFetch(url: string): Promise<{ json(): Promise<any> }>;

// TODO: write a fetch wrapper that returns `unknown`, forcing the caller to validate.
declare function safeFetch(url: string): Promise<TODO>;

// TODO: and one that takes a validator, so the caller gets a real type only after checking.
declare function typedFetch<T>(url: string, parse: (data: unknown) => T): Promise<TODO>;

declare const parseUserList: (d: unknown) => ValidUser[];
declare const result: Awaited<ReturnType<typeof typedFetch<ValidUser[]>>>;
type T7 = Expect<Equal<typeof result, ValidUser[]>>;
void parseUserList; void badFetch; void safeFetch;

// ---------------------------------------------------------------------------
// 5. Making illegal states unrepresentable.
// ---------------------------------------------------------------------------

// The bad version: 2^3 = 8 possible combinations, of which 4 are nonsense.
type BadState = { loading: boolean; data?: string[]; error?: Error };

// TODO: model the same thing so that only the legal combinations exist.
type GoodState = TODO;

// These must compile:
declare const s1: GoodState;
if (s1.status === 'success') { const d: string[] = s1.data; void d; }

// TODO: and this must NOT be constructible. Uncomment to check.
// const impossible: GoodState = { status: 'success', data: ['a'], error: new Error('x') };

void (null as unknown as BadState);

export type { T1, T2, T3, T4, Brand, ParseResult, GoodState };
