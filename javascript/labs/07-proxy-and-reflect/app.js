// Lab 07 — Proxy & Reflect.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

// ---------------------------------------------------------------------------
// 1. The traps, observed.
// ---------------------------------------------------------------------------
on('traps', () => {
  const fired = [];
  const target = { a: 1, b: 2 };
  const p = new Proxy(target, {
    get(t, k, r) { fired.push(['get', String(k)]); return Reflect.get(t, k, r); },
    set(t, k, v, r) { fired.push(['set', `${String(k)} = ${v}`]); return Reflect.set(t, k, v, r); },
    has(t, k) { fired.push(['has', String(k)]); return Reflect.has(t, k); },
    deleteProperty(t, k) { fired.push(['deleteProperty', String(k)]); return Reflect.deleteProperty(t, k); },
    ownKeys(t) { fired.push(['ownKeys', '—']); return Reflect.ownKeys(t); },
    getOwnPropertyDescriptor(t, k) { fired.push(['getOwnPropertyDescriptor', String(k)]); return Reflect.getOwnPropertyDescriptor(t, k); },
    defineProperty(t, k, d) { fired.push(['defineProperty', String(k)]); return Reflect.defineProperty(t, k, d); },
    getPrototypeOf(t) { fired.push(['getPrototypeOf', '—']); return Reflect.getPrototypeOf(t); },
  });

  void p.a;                 // get
  p.c = 3;                  // set (and defineProperty is NOT fired — set is enough)
  void ('a' in p);          // has
  delete p.b;               // deleteProperty
  void Object.keys(p);      // ownKeys + getOwnPropertyDescriptor per key
  void { ...p };            // ownKeys + gOPD + get per key
  void JSON.stringify(p);   // ownKeys + gOPD + get, plus a get for toJSON

  renderTable('#results', fired.map(([trap, detail], i) => ({ '#': i + 1, trap, detail })), { columns: ['#', 'trap', 'detail'] });
  out.textContent =
    'Thirteen traps exist; the six above cover almost everything real code needs. Two things the\n' +
    'table shows that are easy to get wrong:\n\n' +
    '1. ONE OPERATION FIRES SEVERAL TRAPS. `Object.keys(proxy)` fires ownKeys AND\n' +
    '   getOwnPropertyDescriptor once per key (to check enumerability). Spread fires those plus a\n' +
    '   `get` per key. JSON.stringify additionally does a `get` for "toJSON". If your trap does\n' +
    '   work, it does that work several times per apparently-simple operation.\n\n' +
    '2. ALWAYS USE Reflect INSIDE A TRAP, not the raw operation. `Reflect.get(t, k, receiver)`\n' +
    '   forwards the RECEIVER, which matters the moment your target has getters:\n\n' +
    '     get(t, k) { return t[k]; }                   // a getter sees `t` as this — wrong\n' +
    '     get(t, k, r) { return Reflect.get(t, k, r); } // the getter sees the PROXY — correct\n\n' +
    '   Get that wrong and a getter that reads another property bypasses your proxy entirely,\n' +
    '   which in a reactivity system means silently missing dependencies.\n\n' +
    'Reflect exists precisely for this: one method per trap, same signature, returning a boolean\n' +
    'instead of throwing where the trap wants a boolean.';
});

// ---------------------------------------------------------------------------
// 2. Reactivity in 40 lines. This is genuinely how Vue 3 works.
// ---------------------------------------------------------------------------
let activeEffect = null;
const targetMap = new WeakMap();                 // target → key → Set<effect>

function track(target, key) {
  if (!activeEffect) return;
  let deps = targetMap.get(target);
  if (!deps) targetMap.set(target, (deps = new Map()));
  let set = deps.get(key);
  if (!set) deps.set(key, (set = new Set()));
  set.add(activeEffect);
}

function trigger(target, key) {
  const effects = targetMap.get(target)?.get(key);
  if (!effects) return;
  for (const fn of [...effects]) fn();
}

function reactive(obj) {
  return new Proxy(obj, {
    get(t, k, r) {
      track(t, k);                                // RECORD: this effect read this key
      const value = Reflect.get(t, k, r);
      return value && typeof value === 'object' ? reactive(value) : value;   // deep, lazily
    },
    set(t, k, v, r) {
      const had = Object.prototype.hasOwnProperty.call(t, k);
      const old = t[k];
      const ok = Reflect.set(t, k, v, r);
      if (!had || !Object.is(old, v)) trigger(t, k);   // NOTIFY only if it actually changed
      return ok;
    },
    deleteProperty(t, k) { const ok = Reflect.deleteProperty(t, k); trigger(t, k); return ok; },
  });
}

function effect(fn) {
  const runner = () => { activeEffect = runner; try { fn(); } finally { activeEffect = null; } };
  runner();                                       // run once to collect dependencies
  return runner;
}
function computed(getter) {
  let value, dirty = true;
  const runner = effect(() => { dirty = true; });  // simplified: invalidate on any dep change
  void runner;
  return { get value() { if (dirty) { value = getter(); dirty = false; } return value; } };
}

const state = reactive({ count: 0, untracked: 0, nested: { deep: 1 } });
let runs = 0;

on('reactive', () => {
  runs = 0;
  effect(() => {
    runs++;
    $('count').textContent = state.count;
    $('doubled').textContent = state.count * 2;
    $('runs').textContent = runs;
  });
  log.ok('effect registered — it read state.count, so it is now subscribed to that key only');
  out.textContent =
    'Press "count++" and watch the numbers update. Press "mutate an untracked field" and watch\n' +
    'NOTHING happen — the effect never read that key, so it was never subscribed to it.\n\n' +
    'THAT IS THE WHOLE IDEA, and it is three functions:\n\n' +
    '  track(target, key)    while an effect is running, record that it read this key\n' +
    '  trigger(target, key)  when the key is written, re-run every effect that read it\n' +
    '  effect(fn)            set a global "currently running effect", run fn, unset it\n\n' +
    'The dependency graph is DISCOVERED BY RUNNING THE CODE. Nobody declares dependencies; the\n' +
    'proxy observes them. That is why Vue and Solid have no dependency arrays and React does —\n' +
    'React deliberately does not proxy your data, so it cannot know what you read.\n\n' +
    'The details in the implementation that matter:\n' +
    '  · targetMap is a WeakMap, so a discarded object takes its subscriptions with it.\n' +
    '  · The `set` trap compares old and new with Object.is and only triggers on a REAL change —\n' +
    '    otherwise `state.x = state.x` would cause an infinite loop.\n' +
    '  · `get` wraps nested objects LAZILY, so deep reactivity costs nothing until you read deep.\n' +
    '  · A real implementation adds: effect scheduling (batch, then flush once), cleanup of stale\n' +
    '    dependencies between runs, and recursion guards. Read Vue\'s reactivity package — it is\n' +
    '    about 1,000 lines and this is its skeleton.';
});

on('inc', () => { state.count++; });
on('untracked', () => { state.untracked++; log.muted(`untracked = ${state.untracked} — no effect re-ran`); });

// ---------------------------------------------------------------------------
// 3. Immer's produce(), which is the other famous Proxy application.
// ---------------------------------------------------------------------------
on('immer', () => {
  // Copy-on-write via a Proxy: mutate a draft, get a structurally-shared new object.
  function produce(base, recipe) {
    let copy = null;
    const draft = new Proxy(base, {
      get(t, k, r) {
        const v = Reflect.get(copy ?? t, k, r);
        return v && typeof v === 'object' ? produceChild(v, (child) => { ensureCopy()[k] = child; }) : v;
      },
      set(t, k, v) { ensureCopy()[k] = v; return true; },
      deleteProperty(t, k) { delete ensureCopy()[k]; return true; },
      ownKeys(t) { return Reflect.ownKeys(copy ?? t); },
      getOwnPropertyDescriptor(t, k) { return Reflect.getOwnPropertyDescriptor(copy ?? t, k); },
    });
    function ensureCopy() { return (copy ??= Array.isArray(base) ? [...base] : { ...base }); }
    function produceChild(value, attach) {
      let childCopy = null;
      return new Proxy(value, {
        get(t, k, r) { const v = Reflect.get(childCopy ?? t, k, r); return v && typeof v === 'object' ? produceChild(v, (gc) => { ensureChild()[k] = gc; }) : v; },
        set(t, k, v) { ensureChild()[k] = v; return true; },
        ownKeys(t) { return Reflect.ownKeys(childCopy ?? t); },
        getOwnPropertyDescriptor(t, k) { return Reflect.getOwnPropertyDescriptor(childCopy ?? t, k); },
      });
      function ensureChild() { if (!childCopy) { childCopy = Array.isArray(value) ? [...value] : { ...value }; attach(childCopy); } return childCopy; }
    }
    recipe(draft);
    return copy ?? base;                          // NO CHANGE → the SAME object back
  }

  const base = { user: { name: 'ash', prefs: { theme: 'dark' } }, items: [1, 2], untouched: { big: 'data' } };
  const next = produce(base, (d) => { d.user.prefs.theme = 'light'; });
  const same = produce(base, () => { /* nothing */ });

  renderTable('#results', [
    { check: 'next !== base', result: String(next !== base), meaning: 'a new object was produced' },
    { check: 'next.user !== base.user', result: String(next.user !== base.user), meaning: 'the changed PATH was copied' },
    { check: 'next.untouched === base.untouched', result: String(next.untouched === base.untouched), meaning: 'STRUCTURAL SHARING — untouched subtrees keep their identity' },
    { check: 'base.user.prefs.theme', result: base.user.prefs.theme, meaning: 'the original is unchanged' },
    { check: 'next.user.prefs.theme', result: next.user.prefs.theme, meaning: 'the new one has the change' },
    { check: 'produce(base, noop) === base', result: String(same === base), meaning: 'no change → the SAME reference, so === still short-circuits' },
  ], { columns: ['check', 'result', 'meaning'] });

  out.textContent =
    'Mutable-looking code, immutable result, and — the row that matters — UNTOUCHED SUBTREES KEEP\n' +
    'THEIR IDENTITY.\n\n' +
    'That third row is why this beats a deep clone in a React or Redux codebase. `React.memo`,\n' +
    '`useMemo` dependencies and store selectors all compare with `===`. A deep clone changes every\n' +
    'reference, so everything re-renders. Structural sharing changes only the path you touched,\n' +
    'so only the components that depend on that path re-render (lab 04, and\n' +
    'web-vitals-and-react-perf lab 05).\n\n' +
    'The last row is the other half: if the recipe changes nothing, you get the ORIGINAL OBJECT\n' +
    'back. A reducer that no-ops returns the identical state, and every downstream === check\n' +
    'short-circuits.\n\n' +
    'The real Immer adds: freezing in development, Map/Set support, patches (so you can send just\n' +
    'the diff over the wire — useful for the realtime-ui course), and a `nothing` sentinel for\n' +
    'producing undefined. But the mechanism is what you just read: a Proxy that copies on first\n' +
    'write and attaches the copy to its parent.';
});

// ---------------------------------------------------------------------------
// 4. The tax.
// ---------------------------------------------------------------------------
on('cost', () => {
  const plain = { a: 1, b: 2, c: 3 };
  const bare = new Proxy(plain, {});                                   // NO traps defined
  const forwarding = new Proxy(plain, { get: (t, k, r) => Reflect.get(t, k, r) });
  const reactiveObj = reactive({ a: 1, b: 2, c: 3 });

  const N = 3e6;
  const read = (o) => { let x = 0; const s = performance.now(); for (let i = 0; i < N; i++) x += o.a; return { ms: performance.now() - s, x }; };
  const write = (o) => { const s = performance.now(); for (let i = 0; i < N; i++) o.a = i; return performance.now() - s; };

  const rows = [
    { object: 'a plain object', read: read(plain).ms.toFixed(0), write: write(plain).toFixed(0) },
    { object: 'Proxy with NO traps', read: read(bare).ms.toFixed(0), write: write(bare).toFixed(0) },
    { object: 'Proxy with a forwarding get', read: read(forwarding).ms.toFixed(0), write: write(forwarding).toFixed(0) },
    { object: 'reactive() from this lab', read: read(reactiveObj).ms.toFixed(0), write: write(reactiveObj).toFixed(0) },
  ];
  const base = Number(rows[0].read) || 1;
  renderTable('#results', rows.map((r) => ({ ...r, read: `${r.read}ms`, write: `${r.write}ms`, 'read ×': `${(Number(r.read) / base).toFixed(1)}×` })),
    { columns: ['object', 'read', 'read ×', 'write'] });

  out.textContent =
    'Even a proxy with NO TRAPS AT ALL is several times slower to read than a plain object, because\n' +
    'a proxy cannot participate in inline caches (lab 08): every access goes through the\n' +
    'MOP machinery instead of a cached offset.\n\n' +
    'What follows, practically:\n' +
    '  · NEVER PUT A PROXY IN A HOT LOOP. Read the values out first, work on plain data, write back.\n' +
    '    Vue does exactly this internally — the render function reads reactive values once.\n' +
    '  · The absolute numbers are still small. Millions of accesses per second is plenty for a UI,\n' +
    '    which is why Vue and MobX are fast in practice despite the multiplier.\n' +
    '  · It is a per-ACCESS cost, not a per-object cost. A large object that you read twice is fine;\n' +
    '    a small object you read a million times is not.\n\n' +
    'And the design consequence, which is the real reason React does not do this: proxy-based\n' +
    'reactivity gives you automatic, precise dependency tracking at the cost of making every\n' +
    'property access slower and every value in your app a proxy. React chose the opposite trade —\n' +
    'plain objects, and you tell it what changed. Neither is wrong; they are different points on\n' +
    'the same curve.';
});

on('uses', () => {
  renderTable('#results', [
    { use: 'reactivity', who: 'Vue 3, MobX, Solid stores, Valtio', why: 'automatic dependency tracking' },
    { use: 'copy-on-write drafts', who: 'Immer, Redux Toolkit', why: 'mutable syntax, immutable result, structural sharing' },
    { use: 'a typed RPC client', who: 'comlink, tRPC-ish clients', why: '`api.users.get(1)` becomes a request; no codegen' },
    { use: 'mocking & spying', who: 'test libraries', why: 'record every access without touching the subject' },
    { use: 'negative array indices, default values', who: 'utility libraries', why: 'the classic tutorial example, and rarely worth it' },
    { use: 'lazy loading / hydration', who: 'ORMs, GraphQL clients', why: 'fetch a relation on first access' },
    { use: 'access control & validation', who: 'config objects, API surfaces', why: 'throw on an unknown key instead of returning undefined' },
  ], { columns: ['use', 'who', 'why'] });
  out.textContent =
    'The third row is the one worth stealing. A Proxy that builds a path and turns the final call\n' +
    'into a message gives you a fully "typed-looking" remote API with no code generation:\n\n' +
    '  const api = rpc();\n' +
    '  await api.users.byId(42).posts.list();\n' +
    '  // → { path: ["users","byId","posts","list"], args: [[42], []] } sent to a worker/server\n\n' +
    'That is how Comlink makes a Web Worker look like a local object (web-workers lab 04), and it\n' +
    'is about 20 lines: a `get` trap that returns another proxy with the key appended, and an\n' +
    '`apply` trap that sends the accumulated path.\n\n' +
    'The last row is the underrated one for application code: a config proxy that THROWS on an\n' +
    'unknown key turns a whole class of silent typo bugs (`config.timout`) into an immediate,\n' +
    'located error. Twelve lines, and worth it for any object that is read in many places.\n\n' +
    'The row to be sceptical about is the fifth. Negative array indices via Proxy is the example in\n' +
    'every tutorial and a bad idea in real code: it makes an array that is not quite an array,\n' +
    'surprises every reader, and costs the tax on every access. `arr.at(-1)` exists.';
});

on('limits', () => {
  const frozen = Object.freeze({ a: 1 });
  const lying = new Proxy(frozen, { get: () => 'a different value' });
  let invariantError = 'no error';
  try { void lying.a; } catch (e) { invariantError = `${e.name}: the proxy cannot lie about a non-configurable, non-writable property`; }

  const withPrivate = new (class { #x = 1; getX() { return this.#x; } })();
  const proxied = new Proxy(withPrivate, {});
  let privateError = 'worked';
  try { proxied.getX(); } catch (e) { privateError = `${e.name} — #private fields are keyed on the RECEIVER, and the proxy is not the instance`; }

  renderTable('#results', [
    { limit: 'invariants on non-configurable properties', detail: invariantError },
    { limit: '#private class fields', detail: privateError },
    { limit: 'internal slots (Date, Map, Set, TypedArray)', detail: 'a bare Proxy over a Map throws on .get — you must bind the method to the TARGET' },
    { limit: 'proxy !== target', detail: 'identity comparisons, WeakMap keys and === all see a different object' },
    { limit: 'not transparent to instanceof-style checks that use internal slots', detail: 'though instanceof itself works via getPrototypeOf' },
    { limit: 'revocable proxies', detail: 'Proxy.revocable() gives you a kill switch — every trap throws after revoke()' },
  ], { columns: ['limit', 'detail'] });

  out.textContent =
    'Three limits that will bite you if you build on Proxies:\n\n' +
    '1. INVARIANTS. A proxy may not lie about a non-configurable, non-writable property — the\n' +
    '   engine checks, and throws a TypeError. This is what keeps `Object.freeze` meaningful even\n' +
    '   through a proxy.\n\n' +
    '2. INTERNAL SLOTS. Map, Set, Date, Promise and TypedArray methods read internal slots that\n' +
    '   live on the TARGET, not the proxy — so `new Proxy(new Map(), {}).get(k)` throws. The fix in\n' +
    '   the `get` trap is to bind methods to the target:\n\n' +
    '     get(t, k, r) { const v = Reflect.get(t, k, r);\n' +
    '                    return typeof v === "function" ? v.bind(t) : v; }\n\n' +
    '   ...which then breaks reactivity for Map mutations, which is why Vue writes explicit\n' +
    '   handlers for collection types instead. The same applies to `#private` fields.\n\n' +
    '3. IDENTITY. The proxy is a different object. Store it in a WeakMap and look it up by the\n' +
    '   target and you will miss; compare with === and you will be surprised. Every serious\n' +
    '   proxy-based library keeps a target↔proxy WeakMap in both directions for exactly this.\n\n' +
    'And Proxy.revocable is a genuinely useful and little-known tool: hand out a proxy, revoke it\n' +
    'when a component unmounts or a plugin is disabled, and every subsequent access throws instead\n' +
    'of silently working against stale state.';
});
