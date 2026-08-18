/** Lab 06 — solution. */
import type { Equal, Expect, Extends } from '../../src/expect.js';

type PlainUserId = string;
type PlainPostId = string;
declare function deletePost(id: PlainPostId): void;
declare const someUserId: PlainUserId;
deletePost(someUserId);

// An intersection with a phantom property that can never be produced by ordinary code. The
// property does not exist at runtime — the whole thing erases to `string`, so branding is free.
// Using a `unique symbol` key rather than a string key keeps it out of autocomplete and out of
// `keyof`, which matters if the branded type is ever mapped over.
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

type UserId = Brand<string, 'UserId'>;
type PostId = Brand<string, 'PostId'>;

type T1 = Expect<Equal<Extends<UserId, PostId>, false>>;   // the whole point
type T2 = Expect<Equal<Extends<UserId, string>, true>>;    // still usable as a string
type T3 = Expect<Equal<Extends<string, UserId>, false>>;   // but you cannot fabricate one

// The cast is deliberate and belongs in exactly one place: the constructor. Everything downstream
// is then guaranteed by the type system rather than by discipline.
declare function toUserId(raw: string): UserId;
const uid = toUserId('u_1');
type T4 = Expect<Equal<typeof uid, UserId>>;

type RawInput = { email: string; age: string };
type ValidUser = { email: Brand<string, 'Email'>; age: number };

// A Result type forces the caller to handle failure — an exception does not, because nothing in
// the signature says it can throw. This is the single highest-value habit at a trust boundary.
type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };
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

declare function badFetch(url: string): Promise<{ json(): Promise<any> }>;

// `unknown` is the honest return type for anything that crossed the network. It is not pedantry:
// the server can and will change, and `any` means the compiler stops helping from here on.
declare function safeFetch(url: string): Promise<unknown>;

declare function typedFetch<T>(url: string, parse: (data: unknown) => T): Promise<T>;

declare const parseUserList: (d: unknown) => ValidUser[];
declare const result: Awaited<ReturnType<typeof typedFetch<ValidUser[]>>>;
type T7 = Expect<Equal<typeof result, ValidUser[]>>;
void parseUserList; void badFetch; void safeFetch;

type BadState = { loading: boolean; data?: string[]; error?: Error };

// Four states instead of eight combinations, and each carries exactly the data it can have.
// "Loading AND error AND data" is now unspellable rather than merely unlikely.
type GoodState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: string[] }
  | { status: 'error'; error: Error };

declare const s1: GoodState;
if (s1.status === 'success') { const d: string[] = s1.data; void d; }

void (null as unknown as BadState);

export type { T1, T2, T3, T4, T7, Brand, ParseResult, GoodState };
