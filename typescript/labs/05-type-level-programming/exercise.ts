/**
 * Lab 05 — Type-level programming.
 *
 * The hard one. You are going to write a router whose PATH PARAMETERS are extracted by the type
 * system, a deep property getter typed by a dotted string, and an object-path autocomplete — the
 * three techniques behind every "magically typed" library you have used.
 *
 * These are not party tricks. `params.id` being typed without a generic argument is the difference
 * between a route table you trust and one you grep.
 */

import type { Equal, Expect, TODO } from '../../src/expect.js';

// ---------------------------------------------------------------------------
// 1. Parse path parameters out of a route string.
// ---------------------------------------------------------------------------

// TODO: extract ':' parameters from a path into a record of strings.
//   '/users/:id/posts/:postId'  →  { id: string; postId: string }
type PathParams<Path extends string> = TODO;

type T1 = Expect<Equal<PathParams<'/users/:id'>, { id: string }>>;
type T2 = Expect<Equal<PathParams<'/users/:id/posts/:postId'>, { id: string; postId: string }>>;
type T3 = Expect<Equal<PathParams<'/health'>, {}>>;

// TODO: now type a route registrar so the handler's `params` is inferred from the path LITERAL.
declare function route<P extends string>(path: P, handler: (params: TODO) => void): void;

route('/users/:id/posts/:postId', (params) => {
  type T4 = Expect<Equal<typeof params, { id: string; postId: string }>>;
  void (null as unknown as T4);
});

// ---------------------------------------------------------------------------
// 2. Dotted paths into a nested object.
// ---------------------------------------------------------------------------

type Config = {
  server: { host: string; port: number; tls: { enabled: boolean } };
  debug: boolean;
};

// TODO: every valid dotted path through T, as a union of string literals.
type Paths<T> = TODO;
type T5 = Expect<Equal<
  Paths<Config>,
  'server' | 'server.host' | 'server.port' | 'server.tls' | 'server.tls.enabled' | 'debug'
>>;

// TODO: the type at a dotted path.
type ValueAt<T, P extends string> = TODO;
type T6 = Expect<Equal<ValueAt<Config, 'server.tls.enabled'>, boolean>>;
type T7 = Expect<Equal<ValueAt<Config, 'server.port'>, number>>;

// TODO: a typed getter. An invalid path must be a COMPILE error.
declare function getIn<T, P extends TODO>(obj: T, path: P): TODO;
declare const config: Config;
const port = getIn(config, 'server.port');
type T8 = Expect<Equal<typeof port, number>>;
// getIn(config, 'server.prot');   // uncomment: this must NOT compile

// ---------------------------------------------------------------------------
// 3. A tiny type-level arithmetic, to see the limits.
// ---------------------------------------------------------------------------

// TODO: build a tuple of length N, then use its `length` as a number.
type Tuple<N extends number, Acc extends unknown[] = []> = TODO;
type T9 = Expect<Equal<Tuple<3>['length'], 3>>;

// TODO: addition, via tuple concatenation.
type Add<A extends number, B extends number> = TODO;
type T10 = Expect<Equal<Add<3, 4>, 7>>;

// ---------------------------------------------------------------------------
// 4. A typed event emitter — the pattern worth actually shipping.
// ---------------------------------------------------------------------------

type Events = {
  click: { x: number; y: number };
  keypress: { key: string };
  close: undefined;
};

// TODO: `on` must accept only known event names, and give the handler the right payload.
//       `emit` must require the payload for events that have one, and forbid it otherwise.
interface Emitter<E extends Record<string, unknown>> {
  on: TODO;
  emit: TODO;
}

declare const emitter: Emitter<Events>;
emitter.on('click', (payload) => {
  type T11 = Expect<Equal<typeof payload, { x: number; y: number }>>;
  void (null as unknown as T11);
});
emitter.emit('keypress', { key: 'a' });
emitter.emit('close');
// emitter.on('nope', () => {});             // must NOT compile
// emitter.emit('keypress');                 // must NOT compile — payload required

export type { T1, T2, T3, T5, T6, T7, T8, T9, T10, PathParams, Paths, ValueAt, Tuple, Add, Emitter };
