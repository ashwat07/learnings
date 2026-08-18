// Lab 01 — Scope & closures.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

// ---------------------------------------------------------------------------
// Measuring the heap. performance.memory is Chrome-only and coarse; it is still
// enough to see a 10× difference, which is all these labs need.
// ---------------------------------------------------------------------------
const heapMB = () => (performance.memory ? performance.memory.usedJSHeapSize / 1048576 : NaN);
const settle = () => new Promise((r) => setTimeout(r, 250));

async function measure(label, build) {
  await settle();
  const before = heapMB();
  const kept = build();                       // the thing we deliberately keep a reference to
  await settle();
  const after = heapMB();
  log.line(`${label}: ${(after - before).toFixed(1)} MB retained`);
  return { label, mb: after - before, kept };
}

// ---------------------------------------------------------------------------
// 1. The loop variable — the single most famous closure bug.
// ---------------------------------------------------------------------------
on('loopvar', () => {
  const withVar = [];
  for (var i = 0; i < 3; i++) withVar.push(() => i);

  const withLet = [];
  for (let j = 0; j < 3; j++) withLet.push(() => j);

  const withIife = [];
  for (var k = 0; k < 3; k++) withIife.push(((captured) => () => captured)(k));

  renderTable('#results', [
    { form: 'for (var i …)', results: withVar.map((f) => f()).join(', '), why: 'ONE binding, function-scoped. All three closures see the same i, which is 3 when they run.' },
    { form: 'for (let j …)', results: withLet.map((f) => f()).join(', '), why: 'A NEW binding PER ITERATION — the spec copies the value into a fresh environment each time.' },
    { form: 'var + IIFE', results: withIife.map((f) => f()).join(', '), why: 'The pre-2015 fix: create a scope by calling a function.' },
  ], { columns: ['form', 'results', 'why'] });

  out.textContent =
    'The usual explanation ("var is function-scoped") is true and incomplete. The precise mechanism\n' +
    'is worth knowing because it explains a lot else:\n\n' +
    'A CLOSURE CAPTURES AN ENVIRONMENT RECORD, NOT A VALUE. With `var` there is exactly one record\n' +
    'for the whole function, containing one `i`. All three functions hold the same record, so they\n' +
    'all see whatever `i` ended up as.\n\n' +
    'With `let`, the spec (CreatePerIterationEnvironment) creates a NEW environment record for each\n' +
    'iteration and copies the loop variable into it. Three records, three different values.\n\n' +
    'Two consequences people miss:\n' +
    '  · `let` in a loop is not free — it is an allocation per iteration. Usually irrelevant, but it\n' +
    '    is the reason a hot loop sometimes gets faster when you hoist the variable out.\n' +
    '  · The same rule applies to `for...of` and `for...in`, and NOT to a plain `while` loop, where\n' +
    '    you only have one binding no matter which keyword you used.';
});

// ---------------------------------------------------------------------------
// 2. The temporal dead zone.
// ---------------------------------------------------------------------------
on('tdz', () => {
  const rows = [];
  try { rows.push({ code: 'console.log(a); var a = 1', result: String(readVar()) }); }
  catch (e) { rows.push({ code: 'console.log(a); var a = 1', result: e.message }); }
  try { readLet(); rows.push({ code: 'console.log(b); let b = 1', result: '(no error?)' }); }
  catch (e) { rows.push({ code: 'console.log(b); let b = 1', result: `${e.name}: ${e.message}` }); }
  try { rows.push({ code: 'typeof undeclared', result: typeof someTotallyUndeclaredThing }); }
  catch (e) { rows.push({ code: 'typeof undeclared', result: e.message }); }
  try { typeofTdz(); rows.push({ code: 'typeof c; let c = 1', result: '(no error?)' }); }
  catch (e) { rows.push({ code: 'typeof c; let c = 1', result: `${e.name} — typeof is NOT safe here` }); }

  renderTable('#results', rows, { columns: ['code', 'result'] });
  out.textContent =
    'The TDZ is not "let is not hoisted". `let` and `const` ARE hoisted — the binding is created when\n' +
    'the scope is entered. It is simply UNINITIALISED until the declaration executes, and touching\n' +
    'an uninitialised binding throws.\n\n' +
    'The line that proves it is the last one: `typeof x` is the one operation that is SAFE on a\n' +
    'completely undeclared variable (it returns "undefined" instead of throwing) — and it THROWS in\n' +
    'the TDZ. If `let` were simply "not hoisted", the variable would be undeclared and typeof would\n' +
    'be safe. It is not, because the binding exists.\n\n' +
    'Why the TDZ exists at all: it makes `const` meaningful (you can never observe it before its\n' +
    'value), and it turns a class of silent `undefined` bugs into loud errors. It is the single\n' +
    'best argument for never using `var`.';

  function readVar() { const r = a; var a = 1; return r; }        // undefined, no error
  function readLet() { const r = b; let b = 1; return r; }        // throws
  function typeofTdz() { const t = typeof c; let c = 1; return t; } // ALSO throws
});

on('hoisting', () => {
  renderTable('#results', [
    { declaration: 'function foo() {}', hoisted: 'yes — name AND body', beforeDeclaration: 'callable' },
    { declaration: 'var x = 1', hoisted: 'the binding only', beforeDeclaration: 'undefined' },
    { declaration: 'let / const x = 1', hoisted: 'the binding, uninitialised', beforeDeclaration: 'ReferenceError (TDZ)' },
    { declaration: 'class X {}', hoisted: 'the binding, uninitialised', beforeDeclaration: 'ReferenceError (TDZ)' },
    { declaration: 'const f = function() {}', hoisted: 'the binding only', beforeDeclaration: 'ReferenceError (TDZ)' },
    { declaration: 'import { x }', hoisted: 'fully — live binding', beforeDeclaration: 'usable (hoisted to the top of the module)' },
  ], { columns: ['declaration', 'hoisted', 'beforeDeclaration'] });
  out.textContent =
    'One row is more surprising than the rest: IMPORTS ARE FULLY HOISTED AND LIVE.\n\n' +
    '  import { count } from "./counter.js";   // usable before this line, in this module\n\n' +
    'And "live" means the binding tracks the exporting module — if the exporter reassigns `count`,\n' +
    'your imported name changes value. That is why ESM is not sugar over CommonJS: `require()`\n' +
    'copies a value at call time, `import` binds to a cell. It is also why circular imports behave\n' +
    'differently in the two systems, and why tree-shaking is possible at all (the graph is static).\n\n' +
    'The practical rule for the rest of the table: declare before use, always, and the differences\n' +
    'stop mattering. The reason to know them is debugging someone else\'s code.';
});

// ---------------------------------------------------------------------------
// 3. What a closure ACTUALLY retains. This is the lab.
// ---------------------------------------------------------------------------
const HOLD = [];

on('retain', async () => {
  HOLD.length = 0;
  log.head('— 20,000 closures created next to a big array —');

  const r = await measure('closures sharing a fat scope', () => {
    const keep = [];
    for (let i = 0; i < 20000; i++) {
      // A big object that the returned function NEVER MENTIONS.
      const bigPayload = new Array(500).fill(i);
      const smallValue = i;
      // Only `smallValue` is referenced... but see the readout.
      keep.push(() => smallValue + (Math.random() < 0 ? bigPayload.length : 0));
    }
    return keep;
  });
  HOLD.push(r.kept);

  renderTable('#results', [
    { case: '20,000 closures over a scope containing a 500-element array', retained: `${r.mb.toFixed(1)} MB` },
  ], { columns: ['case', 'retained'] });

  out.textContent =
    'Read the number, then read the code (it is in app.js).\n\n' +
    'Each closure "only uses" a single integer. Each one also keeps a 500-element array alive,\n' +
    'because in this construction the array is still REACHABLE from the closure\'s environment.\n\n' +
    'THE RULE, precisely: a closure holds a reference to the ENVIRONMENT RECORD it was created in.\n' +
    'Modern engines (V8 included) do optimise this — they analyse which variables are actually\n' +
    'referenced and can allocate a smaller "context" — but that analysis is defeated more easily\n' +
    'than people assume:\n\n' +
    '  · if ANY closure in the same scope references the big variable, the context keeps it for ALL\n' +
    '    of them (they share one context object)\n' +
    '  · `eval` or `with` anywhere in the scope disables the analysis entirely\n' +
    '  · a debugger statement, or having devtools open, can keep the full scope alive\n' +
    '  · the reference can be conditional and never executed — as it is here — and still count\n\n' +
    'This is the actual mechanism behind most "mysterious" SPA memory leaks: an event handler that\n' +
    'closes over a scope that also happens to contain a component, a big response, or a DOM node.\n' +
    'See spa-memory-leaks lab 03.\n\n' +
    'Now press the second button.';
});

on('retain-fix', async () => {
  HOLD.length = 0;
  log.head('— the same 20,000 closures, with the payload in its own scope —');

  const r = await measure('closures over a narrow scope', () => {
    const keep = [];
    const makeFn = (value) => () => value;      // a factory: its scope contains ONLY `value`
    for (let i = 0; i < 20000; i++) {
      const bigPayload = new Array(500).fill(i);
      void bigPayload.length;                    // used, then discarded with the iteration scope
      keep.push(makeFn(i));
    }
    return keep;
  });
  HOLD.push(r.kept);

  renderTable('#results', [
    { case: '20,000 closures created by a factory whose scope holds one value', retained: `${r.mb.toFixed(1)} MB` },
  ], { columns: ['case', 'retained'] });

  out.textContent =
    'Same number of closures, same work, a fraction of the memory.\n\n' +
    'The fix is structural, not clever: THE CLOSURE IS CREATED IN A SCOPE THAT CONTAINS ONLY WHAT IT\n' +
    'NEEDS. A factory function is the smallest way to say that.\n\n' +
    '  const makeHandler = (id) => () => doSomething(id);   // scope = { id }\n\n' +
    'versus creating the handler inline in a function that also holds a response body, a DOM node\n' +
    'and a component instance — where the scope is all of those.\n\n' +
    'Three practical rules that fall out of this:\n' +
    '  1. Create long-lived callbacks in a NARROW factory, not inline in a fat function.\n' +
    '  2. Null out big locals you no longer need before creating a closure (`data = null`), which\n' +
    '     genuinely works and looks like superstition until you have measured it.\n' +
    '  3. When hunting a leak, look at the RETAINERS panel in a heap snapshot, not at the object —\n' +
    '     the answer is almost always "a closure\'s context".';
});

on('shared', () => {
  function makeCounter() {
    let count = 0;                              // ONE binding
    return {
      inc: () => ++count,
      dec: () => --count,
      read: () => count,
    };
  }
  const a = makeCounter(); const b = makeCounter();
  a.inc(); a.inc(); a.inc(); b.inc();
  renderTable('#results', [
    { instance: 'counter a', calls: 'inc ×3', value: a.read() },
    { instance: 'counter b', calls: 'inc ×1', value: b.read() },
    { instance: 'a.inc and a.read', share: 'the same environment record', value: 'yes' },
  ], { columns: ['instance', 'calls', 'share', 'value'] });
  out.textContent =
    'Three functions, one shared environment. This is the whole basis of the module pattern, and it\n' +
    'is genuinely private state — not "private by convention" like an underscore prefix, and not\n' +
    'reachable by reflection like a `#field` is via a debugger.\n\n' +
    'What to notice: `count` is not on any object. There is no property to enumerate, no key to\n' +
    'Object.keys, nothing for JSON.stringify to find, nothing a Proxy can trap. That is a real\n' +
    'guarantee and also a real cost: you cannot serialise it, inspect it, or test it directly.\n\n' +
    'The modern alternatives, and when each is right:\n' +
    '  closures        true privacy, per-instance memory cost (one function object per method, per\n' +
    '                  instance) — see lab 02, where that cost is measured\n' +
    '  #privateFields  privacy enforced by the language, methods still on the prototype (cheap),\n' +
    '                  and a TypeError rather than undefined if you get it wrong\n' +
    '  WeakMap         privacy with prototype methods; the pattern libraries used before #fields\n' +
    '  _underscore     a comment with extra steps';
});

on('module', () => {
  out.textContent =
    'THE MODULE PATTERN, and what replaced it:\n\n' +
    '  const store = (() => {\n' +
    '    let state = {};                       // private\n' +
    '    const listeners = new Set();          // private\n' +
    '    return { get: (k) => state[k], set: (k, v) => { … } };\n' +
    '  })();\n\n' +
    'This was how JavaScript had modules for fifteen years, and the IIFE is doing exactly one job:\n' +
    'creating a scope. ES modules do that job for you — every module already has its own scope, and\n' +
    'a top-level `let` in a module is private unless you export it.\n\n' +
    'So in modern code the IIFE is usually redundant. Where the pattern still earns its keep:\n' +
    '  · a FACTORY that produces several independent instances with private state\n' +
    '  · capturing an expensive computation once: `const format = (() => { const f = new\n' +
    '    Intl.NumberFormat(locale); return (n) => f.format(n); })();`\n' +
    '  · anywhere you want a value to be genuinely unreachable rather than merely conventionally\n' +
    '    private\n\n' +
    'And the trap that survives from that era: a module-level `let` in an ES module is a SINGLETON.\n' +
    'It is shared by every importer, it persists across route changes, and in SSR it is shared\n' +
    'between REQUESTS — which is one of the most common and most severe bugs in server-rendered\n' +
    'JavaScript, because one user can see another user\'s data. Module scope is per-process, not\n' +
    'per-request.';
});
