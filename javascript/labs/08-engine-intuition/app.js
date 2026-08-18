// Lab 08 — Engine intuition.
//
// Every measurement warms the function up first (so V8 has optimised it), then times it. The
// absolute numbers depend on your machine; the ratios between rows are the lesson.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

function bench(fn, { warmup = 20000, iterations = 2e6 } = {}) {
  for (let i = 0; i < warmup; i++) fn(i);          // let the optimiser see it
  const s = performance.now();
  let sink = 0;
  for (let i = 0; i < iterations; i++) sink += fn(i) | 0;
  const ms = performance.now() - s;
  return { ms, sink };
}
const ratio = (rows) => {
  const base = Math.min(...rows.map((r) => r.msRaw));
  return rows.map((r) => ({
    ...r,
    ms: `${r.msRaw.toFixed(0)}ms`,
    slower: `${(r.msRaw / base).toFixed(1)}x`,
    _slowerClass: r.msRaw / base > 2 ? 'no' : 'ok',
  }));
};

// ---------------------------------------------------------------------------
// 1. Hidden classes: property ORDER changes the shape.
// ---------------------------------------------------------------------------
on('shapes', () => {
  function A(x, y) { this.x = x; this.y = y; }              // shape {x, y}
  function B(x, y) { this.y = y; this.x = x; }              // shape {y, x} — a DIFFERENT hidden class
  function C(x, y) { this.x = x; this.y = y; this.extra = 1; }
  function D(x) { this.x = x; }                             // and .y added later

  const sameShape = Array.from({ length: 1000 }, (_, i) => new A(i, i));
  const mixedOrder = Array.from({ length: 1000 }, (_, i) => (i % 2 ? new A(i, i) : new B(i, i)));
  const lateAdd = Array.from({ length: 1000 }, (_, i) => { const o = new D(i); o.y = i; return o; });

  const read = (arr) => (i) => { const o = arr[i % arr.length]; return o.x + o.y; };

  const rows = [
    { construction: 'always {x, y} in the same order', msRaw: bench(read(sameShape)).ms },
    { construction: 'half {x,y}, half {y,x} — same keys, different ORDER', msRaw: bench(read(mixedOrder)).ms },
    { construction: 'x in the constructor, y added afterwards', msRaw: bench(read(lateAdd)).ms },
  ];
  renderTable('#results', ratio(rows), { columns: ['construction', 'ms', 'slower'] });
  void C;

  out.textContent =
    'Same properties, same values, same reads — and different times, because V8 gives each object a\n' +
    'HIDDEN CLASS (a "map" or "shape") describing its layout, and objects only share one if they\n' +
    'were built the same way in the same ORDER.\n\n' +
    '  { x, y }  and  { y, x }  are two different shapes with identical contents.\n\n' +
    'Why it matters: a property read compiles to "load the field at offset 8 of this shape". If\n' +
    'every object at a call site has the same shape, that is one machine instruction. If they have\n' +
    'several, V8 must check which one — and past a threshold it gives up entirely (the next\n' +
    'button).\n\n' +
    'The third row is the one that appears in real code: initialising all fields in the constructor\n' +
    'versus adding some later. Each added property is a TRANSITION to a new hidden class, and\n' +
    'objects that diverge partway share only the prefix.\n\n' +
    'The rule that falls out of it, and it costs nothing to follow:\n' +
    '  INITIALISE EVERY FIELD IN THE CONSTRUCTOR, IN THE SAME ORDER, EVERY TIME — including the\n' +
    '  ones you do not have a value for yet (`this.error = null`).\n\n' +
    'You can inspect this directly with %HaveSameMap(a, b) if you launch Chrome with\n' +
    '--js-flags="--allow-natives-syntax".';
});

// ---------------------------------------------------------------------------
// 2. Inline caches.
// ---------------------------------------------------------------------------
on('ic', () => {
  const makeShape = (n) => {
    // n distinct shapes, each with a `value` property at a different offset.
    const objs = [];
    for (let i = 0; i < n; i++) {
      const o = {};
      for (let j = 0; j < i; j++) o[`pad${j}`] = j;    // shift `value` to a different offset
      o.value = 1;
      objs.push(o);
    }
    return objs;
  };
  const readValue = (arr) => (i) => arr[i % arr.length].value;

  const rows = [
    { site: '1 shape — MONOMORPHIC', msRaw: bench(readValue(makeShape(1))).ms },
    { site: '2 shapes — polymorphic', msRaw: bench(readValue(makeShape(2))).ms },
    { site: '4 shapes — polymorphic (the usual limit)', msRaw: bench(readValue(makeShape(4))).ms },
    { site: '8 shapes — MEGAMORPHIC', msRaw: bench(readValue(makeShape(8))).ms },
    { site: '40 shapes — megamorphic', msRaw: bench(readValue(makeShape(40))).ms },
  ];
  renderTable('#results', ratio(rows), { columns: ['site', 'ms', 'slower'] });

  out.textContent =
    'AN INLINE CACHE is a small memo attached to each property-access SITE in your code: "last time,\n' +
    'objects of shape S had `value` at offset 8".\n\n' +
    '  MONOMORPHIC  one shape seen. The fastest thing the engine can do — a check and a load.\n' +
    '  POLYMORPHIC  2–4 shapes. A short list of checks. Still fast.\n' +
    '  MEGAMORPHIC  more than ~4. V8 gives up on the site and falls back to a global hash lookup.\n\n' +
    'Note the shape of the numbers: the cliff is not gradual. Two or four shapes cost a little;\n' +
    'crossing into megamorphic costs a lot, and adding forty more shapes after that costs nothing\n' +
    'extra — you already fell off.\n\n' +
    'Where this appears in real code:\n' +
    '  · A GENERIC UTILITY called with every object type in your app — `get(obj, key)`,\n' +
    '    a serialiser, a deep-equal, a logger. It is megamorphic by construction.\n' +
    '  · A LIST OF HETEROGENEOUS ITEMS: `{type:"text", …} | {type:"image", …}` rendered by one\n' +
    '    loop. Give them a UNION SHAPE (every field on every variant, unused ones null) and the\n' +
    '    site becomes monomorphic.\n' +
    '  · An options object built differently at different call sites.\n\n' +
    'And the honest caveat: this matters in HOT code — a render loop, a parser, a physics step, a\n' +
    'sort comparator. It does not matter in a click handler that runs twice a minute, and\n' +
    'contorting your data model for it there is a mistake.';
});

// ---------------------------------------------------------------------------
// 3. Array element kinds.
// ---------------------------------------------------------------------------
on('elements', () => {
  const N = 100000;
  const smi = Array.from({ length: N }, (_, i) => i);                    // PACKED_SMI_ELEMENTS
  const dbl = Array.from({ length: N }, (_, i) => i + 0.5);              // PACKED_DOUBLE_ELEMENTS
  const objs = Array.from({ length: N }, (_, i) => ({ v: i }));          // PACKED_ELEMENTS
  const holey = Array.from({ length: N }, (_, i) => i); delete holey[5]; // HOLEY_SMI_ELEMENTS
  const tainted = Array.from({ length: N }, (_, i) => i); tainted[10] = 'a string';  // PACKED_ELEMENTS

  const sum = (arr) => () => { let s = 0; for (let i = 0; i < arr.length; i++) s += typeof arr[i] === 'number' ? arr[i] : 0; return s; };
  const rows = [
    { array: 'small integers (SMI)', msRaw: bench(sum(smi), { iterations: 200 }).ms },
    { array: 'doubles', msRaw: bench(sum(dbl), { iterations: 200 }).ms },
    { array: 'one string added to an int array', msRaw: bench(sum(tainted), { iterations: 200 }).ms },
    { array: 'objects', msRaw: bench(sum(objs), { iterations: 200 }).ms },
    { array: 'ints with ONE hole (delete arr[5])', msRaw: bench(sum(holey), { iterations: 200 }).ms },
  ];
  renderTable('#results', ratio(rows), { columns: ['array', 'ms', 'slower'] });

  out.textContent =
    'V8 tracks what an array CONTAINS, in a lattice you can only ever move DOWN:\n\n' +
    '  PACKED_SMI  →  PACKED_DOUBLE  →  PACKED_ELEMENTS      (contents get more general)\n' +
    '       ↓              ↓                  ↓\n' +
    '  HOLEY_SMI   →  HOLEY_DOUBLE   →  HOLEY_ELEMENTS       (a hole appeared)\n\n' +
    'Packed integers are stored as raw machine values in a contiguous buffer — a sum is a tight\n' +
    'loop over memory. Once an array holds arbitrary values, every element is a tagged pointer that\n' +
    'must be checked and possibly dereferenced.\n\n' +
    'THE TRANSITION IS ONE-WAY. Putting a single string into an array of a million integers moves\n' +
    'the whole array to PACKED_ELEMENTS permanently — removing the string does not move it back.\n' +
    'The same is true of holes: one `delete` makes the array HOLEY forever, and every read now has\n' +
    'to check for a hole and walk the prototype chain if it finds one.\n\n' +
    'Practical rules:\n' +
    '  · never `delete arr[i]` — use splice, or filter, or set a sentinel\n' +
    '  · never `new Array(n)` and then fill by index — that array starts HOLEY. Use\n' +
    '    Array.from({length: n}, fn), or new Array(n).fill(0)\n' +
    '  · do not mix types in a numeric array\n' +
    '  · for genuinely numeric data, use a TYPED ARRAY (Float64Array), which has none of this and\n' +
    '    is also transferable to a worker (web-workers lab 02)';
});

// ---------------------------------------------------------------------------
// 4. Dictionary mode.
// ---------------------------------------------------------------------------
on('dictionary', () => {
  const makeFast = () => { const o = { a: 1, b: 2, c: 3, d: 4 }; return o; };
  const makeSlow = () => { const o = { a: 1, b: 2, c: 3, d: 4 }; delete o.b; o.b = 2; return o; };
  const makeMany = () => { const o = {}; for (let i = 0; i < 200; i++) o[`k${i}`] = i; return o; };

  const fast = Array.from({ length: 500 }, makeFast);
  const slow = Array.from({ length: 500 }, makeSlow);
  const many = Array.from({ length: 500 }, makeMany);

  const rows = [
    { object: 'a normal object', msRaw: bench((i) => fast[i % 500].a).ms },
    { object: 'after delete + re-add (dictionary mode)', msRaw: bench((i) => slow[i % 500].a).ms },
    { object: '200 dynamically-added keys', msRaw: bench((i) => many[i % 500].k0).ms },
  ];
  renderTable('#results', ratio(rows), { columns: ['object', 'ms', 'slower'] });

  out.textContent =
    'When an object is used in ways that make a fixed layout untenable — properties deleted,\n' +
    'hundreds of keys added dynamically, a key added to a shape shared by many objects — V8 gives\n' +
    'up on hidden classes and converts it to DICTIONARY MODE: a plain hash table.\n\n' +
    'Every property access becomes a hash lookup, inline caches stop helping, and the object cannot\n' +
    'return to fast mode (in practice; there are narrow exceptions).\n\n' +
    'What pushes an object into dictionary mode:\n' +
    '  · `delete obj.key` — THE most common cause. Use `obj.key = undefined` if you can tolerate\n' +
    '    the key existing, or a Map if you genuinely need to remove entries.\n' +
    '  · adding many properties dynamically after construction\n' +
    '  · using an object as a growing key-value store — which is what Map is FOR\n' +
    '  · Object.defineProperty with unusual descriptors, on some paths\n\n' +
    'The design rule this produces is a good one independently of performance:\n' +
    '  OBJECTS FOR RECORDS WITH KNOWN FIELDS. MAPS FOR DYNAMIC KEY-VALUE DATA.\n' +
    'A Map is designed for insertion and deletion, has no prototype-key collisions (no "__proto__"\n' +
    'surprises), keeps insertion order for all key types, and gives you .size for free.';
});

on('deopt', () => {
  renderTable('#results', [
    { trigger: 'a new hidden class at an optimised site', effect: 'IC misses → possible deopt', avoid: 'stable shapes' },
    { trigger: 'an unexpected type (a string where a number was assumed)', effect: 'DEOPT and re-optimise', avoid: 'stable types per site' },
    { trigger: 'arguments object leaking out of a function', effect: 'blocks some optimisations', avoid: 'rest parameters' },
    { trigger: 'try/catch in very old V8', effect: 'used to block optimisation entirely', avoid: 'no longer true — TurboFan optimises try/catch' },
    { trigger: '`with` and sloppy-mode `eval`', effect: 'disables scope analysis', avoid: 'never use them' },
    { trigger: 'reading an out-of-bounds index', effect: 'returns undefined, and can deopt the loop', avoid: 'bound your loops' },
    { trigger: 'changing a function\'s arity dynamically', effect: 'call-site mismatch', avoid: 'consistent signatures' },
    { trigger: 'a very large function', effect: 'may not be inlined', avoid: 'small hot functions' },
  ], { columns: ['trigger', 'effect', 'avoid'] });
  out.textContent =
    'A note on how V8 actually runs your code, because it explains the whole lab:\n\n' +
    '  Ignition   an interpreter runs the bytecode and COLLECTS TYPE FEEDBACK\n' +
    '  Sparkplug  a fast baseline compiler for warm code\n' +
    '  Maglev     a mid-tier optimising compiler\n' +
    '  TurboFan   the full optimiser, which SPECULATES using the collected feedback\n\n' +
    'TurboFan compiles "this is always a small integer" into code that assumes it, guarded by a\n' +
    'cheap check. When the assumption is violated the code DEOPTIMISES: it bails back to the\n' +
    'interpreter, discards the optimised version, and may re-optimise later with weaker\n' +
    'assumptions. A function that deopts in a loop can end up slower than if it had never been\n' +
    'optimised.\n\n' +
    'The row worth correcting: try/catch has NOT blocked optimisation since 2017 or so. That advice\n' +
    'is still repeated constantly and is simply out of date — as is "arrow functions are slower",\n' +
    '"forEach is slower than for", and most micro-optimisation folklore. Measure on the engine you\n' +
    'ship to; the only durable rules are the ones about SHAPE and TYPE STABILITY, because those\n' +
    'follow from how speculative optimisation works rather than from any particular version.';
});

on('rules', () => {
  renderTable('#results', [
    { rule: 'initialise every field in the constructor, same order', because: 'one hidden class' },
    { rule: 'never `delete` — assign undefined, or use a Map', because: 'dictionary mode is one-way' },
    { rule: 'keep types stable per property and per parameter', because: 'speculation, and deopt' },
    { rule: 'Array.from({length}) or fill(), never a bare new Array(n)', because: 'holey arrays are permanently slower' },
    { rule: 'do not mix element types in numeric arrays', because: 'element-kind transitions are one-way' },
    { rule: 'typed arrays for real numeric work', because: 'no tagging, no transitions, transferable' },
    { rule: 'Map for dynamic keys, objects for records', because: 'the right tool, and it avoids dictionary mode' },
    { rule: 'small, hot, monomorphic functions', because: 'inlining and stable ICs' },
    { rule: 'MEASURE — with warm-up', because: 'a cold benchmark measures the interpreter' },
  ], { columns: ['rule', 'because'] });
  out.textContent =
    'THE META-RULE, and the reason this lab is last:\n\n' +
    'ALMOST NONE OF THIS MATTERS FOR APPLICATION CODE. A React component, a click handler, a form\n' +
    'validator — the engine will run any reasonable version of these fast enough that the\n' +
    'difference is unmeasurable next to a single layout or network request.\n\n' +
    'It matters in four places, and you will know when you are in one:\n' +
    '  · a render or animation loop running every frame (graphics-and-animation lab 03)\n' +
    '  · a parser, serialiser or transformer over large data\n' +
    '  · a comparator or hash called millions of times inside a sort or a join\n' +
    '  · a library that other people put in their hot paths\n\n' +
    'The value of knowing it anyway is DIAGNOSTIC. When something is inexplicably 10× slower than\n' +
    'it should be, and the algorithm is right, and the profiler shows time spread across everything\n' +
    'with no obvious hotspot — the answer is usually in this lab. That specific shape of\n' +
    '"uniformly slow with no hotspot" is the signature of a megamorphic site or a deopt loop, and\n' +
    'recognising it saves days.\n\n' +
    'And the first thing to check, always, is the ALGORITHM. An O(n²) loop with perfect hidden\n' +
    'classes loses to an O(n) one with terrible ones, every time.';
});
