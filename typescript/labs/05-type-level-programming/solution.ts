/** Lab 05 — solution. */
import type { Equal, Expect } from '../../src/expect.js';

// Two template-literal patterns, matched in order: a parameter followed by more path, then a
// parameter at the end. The intersection accumulates the record as the recursion unwinds.
type PathParams<Path extends string> =
  Path extends `${string}:${infer Param}/${infer Rest}`
    ? { [K in Param]: string } & PathParams<`/${Rest}`>
    : Path extends `${string}:${infer Param}`
      ? { [K in Param]: string }
      : {};

// `Simplify` flattens `A & B` into a single object literal so `Equal` sees the shape you expect.
// Without it the assertions below fail even though the types are assignable both ways — a
// distinction that trips up everyone writing type tests for the first time.
type Simplify<T> = { [K in keyof T]: T[K] } & {};

type T1 = Expect<Equal<Simplify<PathParams<'/users/:id'>>, { id: string }>>;
type T2 = Expect<Equal<Simplify<PathParams<'/users/:id/posts/:postId'>>, { id: string; postId: string }>>;
type T3 = Expect<Equal<PathParams<'/health'>, {}>>;

declare function route<P extends string>(path: P, handler: (params: Simplify<PathParams<P>>) => void): void;

route('/users/:id/posts/:postId', (params) => {
  type T4 = Expect<Equal<typeof params, { id: string; postId: string }>>;
  void (null as unknown as T4);
});

type Config = {
  server: { host: string; port: number; tls: { enabled: boolean } };
  debug: boolean;
};

// At each level: emit the key itself, and — if the value is an object — every dotted continuation.
// `& string` is needed because keyof can include number and symbol, which cannot be interpolated.
type Paths<T> = T extends object
  ? { [K in keyof T & string]: T[K] extends object ? K | `${K}.${Paths<T[K]>}` : K }[keyof T & string]
  : never;

type T5 = Expect<Equal<
  Paths<Config>,
  'server' | 'server.host' | 'server.port' | 'server.tls' | 'server.tls.enabled' | 'debug'
>>;

// Walk the path by splitting on the first dot and recursing into the remainder.
type ValueAt<T, P extends string> =
  P extends `${infer Head}.${infer Rest}`
    ? Head extends keyof T ? ValueAt<T[Head], Rest> : never
    : P extends keyof T ? T[P] : never;

type T6 = Expect<Equal<ValueAt<Config, 'server.tls.enabled'>, boolean>>;
type T7 = Expect<Equal<ValueAt<Config, 'server.port'>, number>>;

// Constraining P to Paths<T> is what makes a typo a compile error AND gives you autocomplete in
// the editor — the same mechanism behind i18n key checking and form field paths.
declare function getIn<T, P extends Paths<T>>(obj: T, path: P): ValueAt<T, P>;
declare const config: Config;
const port = getIn(config, 'server.port');
type T8 = Expect<Equal<typeof port, number>>;

// Type-level arithmetic is done with TUPLE LENGTHS, because the compiler has no number arithmetic.
// It is genuinely useful (fixed-length tuples, bounded recursion) and genuinely limited: the
// recursion limit is ~1000 and every step costs compile time.
type Tuple<N extends number, Acc extends unknown[] = []> =
  Acc['length'] extends N ? Acc : Tuple<N, [...Acc, unknown]>;
type T9 = Expect<Equal<Tuple<3>['length'], 3>>;

type Add<A extends number, B extends number> = [...Tuple<A>, ...Tuple<B>]['length'];
type T10 = Expect<Equal<Add<3, 4>, 7>>;

type Events = {
  click: { x: number; y: number };
  keypress: { key: string };
  close: undefined;
};

// The conditional on the payload is what makes `emit('close')` legal and `emit('keypress')` an
// error: a variadic tuple that is empty when the payload is undefined.
interface Emitter<E extends Record<string, unknown>> {
  on<K extends keyof E>(event: K, handler: (payload: E[K]) => void): void;
  emit<K extends keyof E>(
    event: K,
    ...args: E[K] extends undefined ? [] : [payload: E[K]]
  ): void;
}

declare const emitter: Emitter<Events>;
emitter.on('click', (payload) => {
  type T11 = Expect<Equal<typeof payload, { x: number; y: number }>>;
  void (null as unknown as T11);
});
emitter.emit('keypress', { key: 'a' });
emitter.emit('close');

export type { T1, T2, T3, T5, T6, T7, T8, T9, T10, PathParams, Paths, ValueAt, Tuple, Add, Emitter, Simplify };
