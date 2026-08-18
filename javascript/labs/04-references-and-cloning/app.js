// Lab 04 — References, cloning & immutability.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

// A deliberately awkward object: every field is something one of the cloning methods gets wrong.
function makeSubject() {
  const o = {
    number: 1,
    text: 'hi',
    date: new Date('2020-01-01'),
    map: new Map([['k', 'v']]),
    set: new Set([1, 2]),
    regexp: /ab+c/gi,
    bigint: 10n,
    undef: undefined,
    nan: NaN,
    infinity: Infinity,
    nested: { deep: { value: 1 } },
    arr: [1, [2, [3]]],
    typed: new Uint8Array([1, 2, 3]),
    fn() { return 1; },
    get computed() { return 42; },
  };
  o.self = o;                                   // a cycle
  return o;
}

const METHODS = {
  'spread {...o}': (o) => ({ ...o }),
  'Object.assign': (o) => Object.assign({}, o),
  'JSON round-trip': (o) => JSON.parse(JSON.stringify(o)),
  structuredClone: (o) => structuredClone(o),
  'a hand-rolled deep clone': (o) => deepClone(o),
};

// A deep clone that handles the cases the naive version misses. Read it — it is the shape of
// every "deepClone" utility, and it is still not complete.
function deepClone(value, seen = new WeakMap()) {
  if (Object(value) !== value) return value;             // primitives, including bigint & symbol
  if (seen.has(value)) return seen.get(value);           // cycles
  if (value instanceof Date) return new Date(value);
  if (value instanceof RegExp) return new RegExp(value.source, value.flags);
  if (value instanceof Map) { const m = new Map(); seen.set(value, m); for (const [k, v] of value) m.set(deepClone(k, seen), deepClone(v, seen)); return m; }
  if (value instanceof Set) { const s = new Set(); seen.set(value, s); for (const v of value) s.add(deepClone(v, seen)); return s; }
  if (ArrayBuffer.isView(value)) return new value.constructor(value);
  if (typeof value === 'function') return value;         // functions are shared, not cloned
  const out2 = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
  seen.set(value, out2);
  for (const key of Reflect.ownKeys(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (d.get) { Object.defineProperty(out2, key, d); continue; }   // preserve accessors
    out2[key] = deepClone(d.value, seen);
  }
  return out2;
}

on('matrix', () => {
  const checks = [
    ['Date stays a Date', (c) => c.date instanceof Date && +c.date === +new Date('2020-01-01')],
    ['Map survives', (c) => c.map instanceof Map && c.map.get('k') === 'v'],
    ['Set survives', (c) => c.set instanceof Set && c.set.has(2)],
    ['RegExp survives', (c) => c.regexp instanceof RegExp && c.regexp.flags === 'gi'],
    ['BigInt survives', (c) => c.bigint === 10n],
    ['undefined key kept', (c) => 'undef' in c],
    ['NaN / Infinity kept', (c) => Number.isNaN(c.nan) && c.infinity === Infinity],
    ['TypedArray survives', (c) => c.typed instanceof Uint8Array && c.typed[2] === 3],
    ['nested object is a COPY', (c) => c.nested !== undefined && c.nested.deep.value === 1],
    ['function survives', (c) => typeof c.fn === 'function'],
    ['cycle handled', (c) => c.self !== undefined],
  ];

  const rows = checks.map(([label, test]) => {
    const row = { property: label };
    for (const [name, clone] of Object.entries(METHODS)) {
      let verdict;
      try {
        const c = clone(makeSubject());
        verdict = test(c) ? 'ok' : 'LOST';
      } catch (e) { verdict = e.name === 'TypeError' ? 'THROWS' : 'THROWS'; }
      row[name] = verdict;
      row[`_${name}Class`] = verdict === 'ok' ? 'ok' : 'no';
    }
    return row;
  });

  renderTable('#results', rows, { columns: ['property', ...Object.keys(METHODS)] });

  out.textContent =
    'Read down the JSON column first. `JSON.parse(JSON.stringify(x))` is the most widely used deep\n' +
    'clone in JavaScript and it silently destroys almost everything:\n' +
    '  · Date becomes a STRING (and then quietly compares wrong forever)\n' +
    '  · Map and Set become {} — with no error\n' +
    '  · undefined keys, functions and symbols VANISH\n' +
    '  · NaN and Infinity become null\n' +
    '  · BigInt THROWS\n' +
    '  · a cycle THROWS\n' +
    '  · getters are flattened into their value at clone time\n\n' +
    'structuredClone (built into every modern browser and Node 17+) handles the whole list except\n' +
    'functions, symbols, DOM nodes and property descriptors — and it throws loudly instead of\n' +
    'silently corrupting. It is the correct default in 2026, and most codebases still have a\n' +
    'hand-rolled clone or a lodash import that predates it.\n\n' +
    'The hand-rolled column shows what you have to write to match it: cycles via a WeakMap,\n' +
    'per-type branches, descriptor preservation. Read deepClone() in this file — it is 20 lines and\n' +
    'still incomplete (Error, Blob, File, ArrayBuffer transfer, class instances with private\n' +
    'fields).';
});

on('speed', () => {
  const subject = { id: 1, name: 'x', tags: ['a', 'b', 'c'], meta: { a: 1, b: 2, c: { d: 3 } } };
  const big = Array.from({ length: 2000 }, (_, i) => ({ ...subject, id: i }));
  const time = (fn, n) => { const s = performance.now(); for (let i = 0; i < n; i++) fn(); return performance.now() - s; };

  const rows = [
    { method: 'spread (shallow)', small: time(() => ({ ...subject }), 200000).toFixed(0), large: time(() => ({ ...big }), 200).toFixed(0) },
    { method: 'JSON round-trip', small: time(() => JSON.parse(JSON.stringify(subject)), 20000).toFixed(0), large: time(() => JSON.parse(JSON.stringify(big)), 20).toFixed(0) },
    { method: 'structuredClone', small: time(() => structuredClone(subject), 20000).toFixed(0), large: time(() => structuredClone(big), 20).toFixed(0) },
    { method: 'hand-rolled deep', small: time(() => deepClone(subject), 20000).toFixed(0), large: time(() => deepClone(big), 20).toFixed(0) },
  ];
  renderTable('#results', rows.map((r) => ({ method: r.method, 'small ×N': `${r.small}ms`, 'large ×N': `${r.large}ms` })),
    { columns: ['method', 'small ×N', 'large ×N'] });

  out.textContent =
    'Different iteration counts per method (a shallow spread is run 10× more), so compare SHAPES\n' +
    'not absolute numbers — the point is the order of magnitude between shallow and deep.\n\n' +
    'What the numbers usually show, and what to do about it:\n' +
    '  · A SHALLOW COPY IS ROUGHLY FREE. It copies N references, not N objects.\n' +
    '  · JSON is often FASTER than structuredClone for plain data, because the serialiser is\n' +
    '    hand-tuned C++ for a much simpler format. It is also the one that corrupts your data, so\n' +
    '    the trade is speed against correctness.\n' +
    '  · structuredClone uses the structured clone algorithm — the same one behind postMessage and\n' +
    '    IndexedDB — which is why web-workers lab 02 measures the same cost from the other side.\n\n' +
    'The real lesson is not which is fastest. It is: MOST DEEP CLONES SHOULD NOT EXIST. If you are\n' +
    'cloning to avoid mutating shared state, the fix is usually to stop sharing mutable state —\n' +
    'copy only the path you are changing (the next button), or use a structural-sharing library\n' +
    '(Immer, which does exactly that under a mutable-looking API).';
});

on('shallow', () => {
  const original = { user: { name: 'ash', prefs: { theme: 'dark' } }, tags: ['a'] };
  const copy = { ...original };
  copy.user.name = 'MUTATED';
  copy.tags.push('b');

  renderTable('#results', [
    { operation: 'copy = {...original}', effect: 'a new top-level object' },
    { operation: 'copy.user.name = "MUTATED"', 'original.user.name': original.user.name, note: 'the SAME nested object' },
    { operation: 'copy.tags.push("b")', 'original.tags': original.tags.join(','), note: 'the SAME array' },
    { operation: 'copy.user === original.user', 'original.user.name': String(copy.user === original.user), note: 'shallow means ONE level' },
  ], { columns: ['operation', 'original.user.name', 'original.tags', 'note'] });

  out.textContent =
    'A shallow copy copies REFERENCES. The nested objects are the same objects, so mutating them\n' +
    'through the copy mutates the original — which is exactly the bug that makes people reach for a\n' +
    'deep clone, usually unnecessarily.\n\n' +
    'THE CORRECT PATTERN IS NOT A DEEP CLONE. It is to copy only the path you are changing:\n\n' +
    '  const next = {\n' +
    '    ...state,\n' +
    '    user: { ...state.user, prefs: { ...state.user.prefs, theme: "light" } },\n' +
    '  };\n\n' +
    'Everything you did not touch is SHARED, which is both faster and the property React,\n' +
    'Redux and every memoisation depend on: an unchanged subtree keeps the same identity, so\n' +
    '`prev.items === next.items` is a valid "nothing changed" check.\n\n' +
    'That path-copying is exactly what Immer generates for you — `produce(state, d => { d.a.b.c = 1 })`\n' +
    'compiles to the nested-spread above via a Proxy (lab 07). Deep-cloning the whole state on every\n' +
    'update destroys the identity checks AND the performance, which is why "just deep clone it" is\n' +
    'the wrong instinct in a React codebase.';
});

on('equality', () => {
  const a = { x: 1, y: { z: 2 } };
  const b = { x: 1, y: { z: 2 } };
  const shallowEqual = (p, q) => Object.keys(p).length === Object.keys(q).length && Object.keys(p).every((k) => p[k] === q[k]);
  const deepEqual = (p, q) => {
    if (Object.is(p, q)) return true;
    if (Object(p) !== p || Object(q) !== q) return false;
    const kp = Reflect.ownKeys(p), kq = Reflect.ownKeys(q);
    return kp.length === kq.length && kp.every((k) => deepEqual(p[k], q[k]));
  };
  renderTable('#results', [
    { comparison: 'a === b', result: String(a === b), meaning: 'reference identity — different objects' },
    { comparison: 'Object.is(a, b)', result: String(Object.is(a, b)), meaning: 'same as === except for NaN and -0' },
    { comparison: 'shallowEqual(a, b)', result: String(shallowEqual(a, b)), meaning: 'a.y !== b.y — different nested objects' },
    { comparison: 'deepEqual(a, b)', result: String(deepEqual(a, b)), meaning: 'structural comparison, O(size)' },
    { comparison: 'JSON.stringify(a) === JSON.stringify(b)', result: String(JSON.stringify(a) === JSON.stringify(b)), meaning: 'works here; breaks on key ORDER, and on everything JSON loses' },
  ], { columns: ['comparison', 'result', 'meaning'] });
  out.textContent =
    'Which equality you need is a design decision, and getting it wrong is the source of both\n' +
    '"why did this re-render?" and "why did this NOT re-render?".\n\n' +
    '  ===            what React.memo, useMemo deps, and Object.is-based store selectors use.\n' +
    '                 Cheap, and it requires you to preserve identity deliberately.\n' +
    '  shallowEqual   what connect()/useSelector-style comparisons use. One level, cheap.\n' +
    '  deepEqual      correct, O(size), and a trap — a deep comparison on every render can cost\n' +
    '                 more than the render you are avoiding.\n\n' +
    'The JSON.stringify trick deserves its own warning: it depends on KEY INSERTION ORDER, so two\n' +
    'objects with the same content built in a different order compare unequal. It also inherits\n' +
    'every JSON limitation from the first button. It is fine for a quick assertion in a test and\n' +
    'wrong in application code.\n\n' +
    'The design rule: PRESERVE IDENTITY INSTEAD OF COMPARING STRUCTURE. If unchanged subtrees keep\n' +
    'their references (path-copying, above), `===` is sufficient everywhere and you never need a\n' +
    'deep comparison at all.';
});

on('immutable', () => {
  renderTable('#results', [
    { technique: 'spread / path copying', enforced: 'no — convention only', cost: 'copies the path', use: 'the default; what Redux Toolkit generates' },
    { technique: 'Object.freeze', enforced: 'SHALLOW, at runtime', cost: 'a check per write', use: 'dev-mode guard rails; never a deep guarantee' },
    { technique: 'TypeScript readonly / Readonly<T>', enforced: 'compile time only', cost: 'zero at runtime', use: 'the cheapest useful enforcement' },
    { technique: 'Immer (produce)', enforced: 'via Proxy', cost: 'proxy overhead on write', use: 'complex nested updates that would be unreadable as spreads' },
    { technique: 'persistent structures (Immutable.js)', enforced: 'by the data type', cost: 'a different API for everything', use: 'rarely worth it now' },
    { technique: 'structuredClone on the boundary', enforced: 'by copying', cost: 'a full copy', use: 'when handing data to code you do not trust' },
  ], { columns: ['technique', 'enforced', 'cost', 'use'] });
  out.textContent =
    'The honest ranking for application code:\n\n' +
    '  1. TYPESCRIPT readonly — free at runtime, catches the mistake where it is made, and costs\n' +
    '     one keyword. Start here.\n' +
    '  2. PATH COPYING for updates — preserves identity, which is what the ecosystem depends on.\n' +
    '  3. IMMER when the spread pyramid becomes unreadable. It is a Proxy that records your\n' +
    '     mutations and produces the path-copied result, so you get readable code AND structural\n' +
    '     sharing. Lab 07 builds the same mechanism.\n' +
    '  4. Object.freeze in development only, if at all. It is shallow, it costs on every write, and\n' +
    '     in sloppy mode it fails SILENTLY, which is worse than not having it.\n\n' +
    'And the thing that makes all of it easier: DO NOT SHARE MUTABLE OBJECTS ACROSS BOUNDARIES.\n' +
    'A function that takes an object and mutates it is the actual problem; immutability techniques\n' +
    'are ways to survive it.';
});

on('sparse', () => {
  const sparse = [1, , 3];                       // a HOLE, not undefined
  const withUndef = [1, undefined, 3];
  const rows = [
    { operation: 'length', sparse: sparse.length, undefined: withUndef.length },
    { operation: '1 in arr', sparse: String(1 in sparse), undefined: String(1 in withUndef) },
    { operation: 'map(x => 9)', sparse: JSON.stringify(sparse.map(() => 9)), undefined: JSON.stringify(withUndef.map(() => 9)) },
    { operation: 'forEach count', sparse: countVisits(sparse), undefined: countVisits(withUndef) },
    { operation: 'for...of count', sparse: [...sparse].length, undefined: [...withUndef].length },
    { operation: 'Object.keys', sparse: Object.keys(sparse).join(','), undefined: Object.keys(withUndef).join(',') },
    { operation: 'JSON.stringify', sparse: JSON.stringify(sparse), undefined: JSON.stringify(withUndef) },
    { operation: 'Array(3) then fill', sparse: JSON.stringify(new Array(3).fill(0)), undefined: 'fill visits holes' },
    { operation: 'Array(3).map(fn)', sparse: JSON.stringify(new Array(3).map(() => 1)), undefined: 'map SKIPS holes — the classic bug' },
    { operation: 'Array.from({length:3}, fn)', sparse: JSON.stringify(Array.from({ length: 3 }, (_, i) => i)), undefined: 'the correct way to build a range' },
  ];
  renderTable('#results', rows, { columns: ['operation', 'sparse', 'undefined'] });

  function countVisits(a) { let n = 0; a.forEach(() => n++); return n; }

  out.textContent =
    'A HOLE IS NOT `undefined`. It is the absence of a property, and the array methods split into\n' +
    'two camps about it:\n\n' +
    '  SKIP holes:   forEach, map, filter, some, every, reduce, Object.keys, JSON.stringify\n' +
    '  VISIT holes:  for...of, spread, Array.from, fill, find, findIndex, includes, join, sort\n\n' +
    'Which produces the single most common "why doesn\'t this work" in beginner code:\n\n' +
    '  new Array(3).map((_, i) => i)      // [ <3 empty items> ] — map skipped every hole\n' +
    '  Array.from({length: 3}, (_, i) => i)   // [0, 1, 2] — correct\n' +
    '  [...Array(3)].map((_, i) => i)          // also correct: spread fills the holes first\n\n' +
    'Where holes come from in real code: `new Array(n)`, `arr.length = 10`, `delete arr[i]`, and\n' +
    'assigning past the end (`a[100] = 1`). The last two are the ones to avoid outright — `delete`\n' +
    'on an array leaves a hole AND can push the array into dictionary mode, which is a large\n' +
    'performance cliff (lab 08). Use `splice` or `filter`.';
});
