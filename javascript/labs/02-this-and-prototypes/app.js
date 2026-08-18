// Lab 02 — `this` & prototypes.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
const heapMB = () => (performance.memory ? performance.memory.usedJSHeapSize / 1048576 : NaN);
const settle = () => new Promise((r) => setTimeout(r, 250));

// ---------------------------------------------------------------------------
// The four rules, resolved by actually running each form.
// ---------------------------------------------------------------------------
on('rules', () => {
  function whoAmI() { return this === undefined ? 'undefined (strict)' : this === globalThis ? 'globalThis' : this?.name ?? String(this); }
  const obj = { name: 'obj', whoAmI };
  const other = { name: 'other' };
  class C { constructor() { this.name = 'new instance'; } m() { return whoAmI.call(this); } }

  renderTable('#results', [
    { rule: '1. new', call: 'new C()', this: new C().name, note: 'a fresh object, prototype-linked to C.prototype' },
    { rule: '2. explicit', call: 'whoAmI.call(other)', this: whoAmI.call(other), note: 'call / apply / bind win over everything except new' },
    { rule: '3. implicit', call: 'obj.whoAmI()', this: obj.whoAmI(), note: 'the object BEFORE THE DOT, decided at CALL time' },
    { rule: '4. default', call: 'whoAmI()', this: whoAmI(), note: 'undefined in strict mode and in modules; globalThis in sloppy mode' },
    { rule: 'arrow', call: '(() => this)()', this: 'the enclosing this', note: 'not a rule — arrows have NO this binding at all' },
  ], { columns: ['rule', 'call', 'this', 'note'] });

  out.textContent =
    'The rules in precedence order: new → explicit (call/apply/bind) → implicit (the dot) → default.\n\n' +
    'The one that matters in practice is rule 3, and the precise wording is what people get wrong:\n' +
    '`this` IS THE OBJECT BEFORE THE DOT AT THE CALL SITE. Not where the function was defined, not\n' +
    'where it lives, not what it is a property of — where it was CALLED from.\n\n' +
    'Note the fourth row. This page is an ES module, and modules are always strict, so a bare call\n' +
    'gives `undefined` rather than `globalThis`. That is why the "lost this" bug produces\n' +
    '"Cannot read properties of undefined" in modern code and silently wrote to `window` in 2014 —\n' +
    'the loud version is a large improvement.\n\n' +
    'And the arrow row is not a fifth rule. An arrow function has no `this` binding whatsoever, so\n' +
    '`this` inside it resolves lexically, exactly like any other variable. This also means you\n' +
    'cannot change it: call/apply/bind on an arrow are silently ignored.';
});

on('lost', () => {
  class Button {
    constructor() { this.label = 'Save'; }
    handleClick() { return this?.label ?? 'THIS WAS LOST'; }
    handleBound = () => this.label;              // a class FIELD holding an arrow function
  }
  const b = new Button();
  const detached = b.handleClick;
  const boundManually = b.handleClick.bind(b);

  renderTable('#results', [
    { form: 'b.handleClick()', result: b.handleClick(), why: 'called with the dot — implicit binding applies' },
    { form: 'const f = b.handleClick; f()', result: detached(), why: 'THE FUNCTION WAS EXTRACTED. No dot at the call site, so no implicit binding.' },
    { form: 'setTimeout(b.handleClick)', result: '(same as above)', why: 'passing a method as a callback IS extracting it' },
    { form: 'b.handleClick.bind(b)()', result: boundManually(), why: 'explicit binding, permanent' },
    { form: 'b.handleBound()', result: b.handleBound(), why: 'a per-instance arrow that closed over the constructor\'s this' },
    { form: '() => b.handleClick()', result: (() => b.handleClick())(), why: 'the call site keeps the dot — usually the best fix' },
  ], { columns: ['form', 'result', 'why'] });

  out.textContent =
    'Every "lost this" bug is the same shape: THE FUNCTION WAS SEPARATED FROM ITS OBJECT, and\n' +
    '`this` is decided at the call site.\n\n' +
    '  onClick={this.handleClick}      // extracted → lost\n' +
    '  addEventListener("x", obj.m)    // extracted → lost\n' +
    '  const { map } = arr             // extracted → lost\n' +
    '  promise.then(obj.handle)        // extracted → lost\n\n' +
    'Four fixes, ranked:\n' +
    '  1. WRAP AT THE CALL SITE: `() => obj.method()`. The dot survives, nothing is allocated per\n' +
    '     instance, and it reads as what it is.\n' +
    '  2. A CLASS FIELD ARROW: `handle = () => …`. Convenient, and it costs a function object PER\n' +
    '     INSTANCE — press "class fields vs prototype methods" to see how much.\n' +
    '  3. bind IN THE CONSTRUCTOR: the pre-2019 version of 2, same cost.\n' +
    '  4. Do not write methods that need `this` when a plain function taking an argument would do.\n\n' +
    'And the reason this bug is so common in JavaScript and rare in most other languages: in Python\n' +
    'or Ruby, extracting a method gives you a BOUND method. In JavaScript, methods are just\n' +
    'properties that happen to hold functions, and functions get their receiver from the call.';
});

on('arrow', () => {
  const obj = {
    name: 'obj',
    regular() { return this?.name; },
    arrow: () => (typeof this === 'undefined' ? 'undefined (module scope)' : String(this)),
    nested() { return [1].map(() => this.name)[0]; },
    nestedOld() { const self = this; return [1].map(function () { return self.name; })[0]; },
  };
  renderTable('#results', [
    { form: 'obj.regular()', result: obj.regular(), note: 'implicit binding' },
    { form: 'obj.arrow()', result: obj.arrow(), note: 'NO binding — resolves lexically to module scope. An arrow as an object method is almost always a bug.' },
    { form: 'obj.nested() — arrow inside a method', result: obj.nested(), note: 'the arrow inherits the method\'s this. THE reason arrows exist.' },
    { form: 'the 2014 version (var self = this)', result: obj.nestedOld(), note: 'what arrows replaced' },
    { form: 'arrow.call(other)', result: String(obj.arrow.call({ name: 'other' })), note: 'ignored — you cannot rebind an arrow' },
  ], { columns: ['form', 'result', 'note'] });
  out.textContent =
    'Arrows are not "functions with nicer this". They are functions WITHOUT this, and everything\n' +
    'follows from that:\n\n' +
    '  · no `this`, so it resolves lexically like any variable — which is why they fixed the\n' +
    '    `var self = this` era\n' +
    '  · no `arguments` (use rest params)\n' +
    '  · no `prototype` property, so they cannot be used with `new`\n' +
    '  · no `super`, no `new.target`\n' +
    '  · call/apply/bind cannot change `this` — they are not ignored entirely (arguments still\n' +
    '    pass) but the receiver is fixed\n\n' +
    'The two places an arrow is WRONG:\n' +
    '  1. as an object literal method, where you almost certainly wanted the object\n' +
    '  2. as a prototype method (same reason)\n' +
    'And the place it is right: any callback inside a method, and any function you want to be\n' +
    'permanently attached to its defining scope.';
});

// ---------------------------------------------------------------------------
// The prototype chain.
// ---------------------------------------------------------------------------
on('chain', () => {
  class Animal { speak() { return 'generic noise'; } }
  class Dog extends Animal { speak() { return 'woof'; } }
  const d = new Dog();

  const chain = [];
  for (let o = d; o; o = Object.getPrototypeOf(o)) {
    chain.push({
      link: chain.length === 0 ? 'the instance' : `[[Prototype]] ×${chain.length}`,
      identity: o === d ? 'd' : o.constructor?.name ? `${o.constructor.name}.prototype` : 'Object.prototype',
      ownKeys: Object.getOwnPropertyNames(o).slice(0, 6).join(', ') || '(none)',
    });
  }
  chain.push({ link: `[[Prototype]] ×${chain.length}`, identity: 'null', ownKeys: 'the end of every chain' });
  renderTable('#results', chain, { columns: ['link', 'identity', 'ownKeys'] });

  out.textContent =
    'Property lookup walks that list until it finds an own property or reaches null. That is the\n' +
    'entire mechanism — `class` is syntax over it.\n\n' +
    'The distinction to keep straight:\n' +
    '  obj.__proto__ / Object.getPrototypeOf(obj)   the object THIS object inherits from\n' +
    '  Fn.prototype                                 the object instances of Fn will inherit from\n' +
    'They are different things with confusingly similar names. `Fn.prototype` is not Fn\'s prototype;\n' +
    'Fn\'s prototype is Function.prototype.\n\n' +
    'Two things worth knowing that the table shows:\n' +
    '  · METHODS LIVE ON THE PROTOTYPE, so 100,000 dogs share ONE `speak`. That is the memory story\n' +
    '    in the next button.\n' +
    '  · The instance\'s own keys are only its FIELDS. If you see methods listed there, someone used\n' +
    '    class fields, and you are paying per instance.\n\n' +
    'And never use Object.setPrototypeOf or assign to __proto__ on a live object: it invalidates\n' +
    'every inline cache that touched it and V8 explicitly warns about it. Set the prototype at\n' +
    'creation (Object.create, class extends) instead.';
});

// ---------------------------------------------------------------------------
// THE measurement: class fields vs prototype methods.
// ---------------------------------------------------------------------------
const HOLD = [];
on('cost', async () => {
  HOLD.length = 0;
  const N = 100000;

  class WithPrototype {
    constructor(id) { this.id = id; }
    onClick() { return this.id; }
    onHover() { return this.id; }
    onFocus() { return this.id; }
  }
  class WithFields {
    constructor(id) { this.id = id; }
    onClick = () => this.id;                    // a NEW function object per instance
    onHover = () => this.id;
    onFocus = () => this.id;
  }

  const build = (Cls) => { const a = new Array(N); for (let i = 0; i < N; i++) a[i] = new Cls(i); return a; };

  await settle();
  let before = heapMB();
  HOLD.push(build(WithPrototype));
  await settle();
  const protoMB = heapMB() - before;

  await settle();
  before = heapMB();
  HOLD.push(build(WithFields));
  await settle();
  const fieldMB = heapMB() - before;

  const t = (Cls) => { const o = new Cls(1); const s = performance.now(); let x = 0; for (let i = 0; i < 2e6; i++) x += o.onClick(); return { ms: performance.now() - s, x }; };

  renderTable('#results', [
    { form: '3 prototype methods', instances: N, heap: `${protoMB.toFixed(1)} MB`, perInstance: `${(protoMB * 1048576 / N).toFixed(0)} bytes`, callMs: `${t(WithPrototype).ms.toFixed(0)}ms / 2M calls` },
    { form: '3 arrow class fields', instances: N, heap: `${fieldMB.toFixed(1)} MB`, perInstance: `${(fieldMB * 1048576 / N).toFixed(0)} bytes`, callMs: `${t(WithFields).ms.toFixed(0)}ms / 2M calls` },
    { form: 'ratio', instances: '', heap: `${(fieldMB / protoMB).toFixed(1)}×`, perInstance: '', callMs: '' },
  ], { columns: ['form', 'instances', 'heap', 'perInstance', 'callMs'] });

  log.bad(`class fields cost ${(fieldMB / protoMB).toFixed(1)}× the heap of prototype methods here`);

  out.textContent =
    'This is the number nobody measures, and it is the reason the lab exists.\n\n' +
    'A PROTOTYPE METHOD IS ONE FUNCTION OBJECT, SHARED BY EVERY INSTANCE. A class field holding an\n' +
    'arrow function is a NEW FUNCTION OBJECT, WITH ITS OWN CLOSURE, PER INSTANCE — so three\n' +
    'auto-bound handlers on 100,000 instances is 300,000 function objects and 300,000 contexts.\n\n' +
    'When this actually matters:\n' +
    '  · large collections of instances — list items, graph nodes, particles, grid cells, records\n' +
    '  · anything you create per frame or per row\n' +
    '  · React class components with many auto-bound handlers, at scale\n\n' +
    'When it does not: a handful of long-lived objects, which is most application code. The\n' +
    'convenience is real and you should not contort a codebase over 40 bytes.\n\n' +
    'The rule worth internalising is the general one: FIELDS ARE PER INSTANCE, PROTOTYPE MEMBERS ARE\n' +
    'SHARED. That is also why a `#private` field plus a prototype method is the memory-efficient way\n' +
    'to get privacy, and why the closure-based module pattern in lab 01 has exactly the same cost\n' +
    'profile as class fields — one function object per instance per method.';
});

on('lookup', () => {
  // Build chains of increasing depth and time the same property access.
  const make = (depth) => {
    let proto = { value: 42 };
    for (let i = 0; i < depth; i++) proto = Object.create(proto);
    return Object.create(proto);
  };
  const time = (obj) => {
    let x = 0;
    const s = performance.now();
    for (let i = 0; i < 5e6; i++) x += obj.value;
    return { ms: performance.now() - s, x };
  };
  const own = { value: 42 };
  const rows = [{ chain: 'own property', ms: `${time(own).ms.toFixed(0)}ms` }];
  for (const d of [1, 3, 10, 30]) rows.push({ chain: `${d} links deep`, ms: `${time(make(d)).ms.toFixed(0)}ms` });
  renderTable('#results', rows, { columns: ['chain', 'ms'] });

  out.textContent =
    'Look at how flat that is. A property ten prototypes deep is not ten times slower.\n\n' +
    'The reason is INLINE CACHES. After the first lookup at a given call site, V8 remembers the\n' +
    '"shape" (hidden class) of the object and where the property was found, and subsequent accesses\n' +
    'skip the walk entirely. A monomorphic access — same shape every time — is close to a direct\n' +
    'memory read regardless of depth.\n\n' +
    'Which means the usual advice ("flatten your prototype chains for speed") is mostly obsolete.\n' +
    'What DOES cost you is defeating the cache, and that is lab 08:\n' +
    '  · passing objects of DIFFERENT shapes to the same code path\n' +
    '  · adding or deleting properties after construction\n' +
    '  · mutating a prototype at runtime\n' +
    '  · `delete obj.x`, which can push an object into dictionary mode\n\n' +
    'The honest summary: depth is cheap, SHAPE INSTABILITY is expensive.';
});

on('descriptors', () => {
  const o = {};
  Object.defineProperty(o, 'hidden', { value: 1, enumerable: false, writable: false, configurable: false });
  Object.defineProperty(o, 'computed', { get() { return 2; }, enumerable: true });
  o.normal = 3;
  const frozen = Object.freeze({ a: 1, nested: { b: 2 } });
  frozen.a = 99;
  frozen.nested.b = 99;                          // freeze is SHALLOW

  renderTable('#results', [
    { prop: 'normal', descriptor: JSON.stringify(Object.getOwnPropertyDescriptor(o, 'normal')) },
    { prop: 'hidden', descriptor: JSON.stringify(Object.getOwnPropertyDescriptor(o, 'hidden')) },
    { prop: 'computed', descriptor: 'get: ƒ, enumerable: true, configurable: false' },
    { prop: 'Object.keys(o)', descriptor: Object.keys(o).join(', ') },
    { prop: 'JSON.stringify(o)', descriptor: JSON.stringify(o) },
    { prop: 'frozen.a after assignment', descriptor: String(frozen.a) },
    { prop: 'frozen.nested.b after assignment', descriptor: `${frozen.nested.b} — freeze is SHALLOW` },
  ], { columns: ['prop', 'descriptor'] });

  out.textContent =
    'Every property has four attributes, and the defaults differ depending on how you created it:\n\n' +
    '  obj.x = 1              writable, enumerable, configurable — ALL true\n' +
    '  defineProperty         ALL false unless you say otherwise. This catches everyone.\n\n' +
    'What each one actually controls:\n' +
    '  writable       assignment silently fails (sloppy) or throws (strict)\n' +
    '  enumerable     visible to Object.keys, for...in, spread and JSON.stringify\n' +
    '  configurable   can be deleted or redefined. FALSE IS PERMANENT — there is no way back.\n\n' +
    'Two consequences worth carrying around:\n' +
    '  · NON-ENUMERABLE IS HOW THE PLATFORM HIDES ITS METHODS. That is why `for...in` over an array\n' +
    '    does not give you `map`, and why spreading a class instance gives you fields but no\n' +
    '    methods — methods are non-enumerable prototype properties, and spread copies own\n' +
    '    enumerable ones only.\n' +
    '  · FREEZE IS SHALLOW (last row). `Object.freeze` on a config object with nested objects\n' +
    '    protects nothing meaningful. A deep freeze is a recursive walk, and it is usually cheaper\n' +
    '    to not share the object.\n\n' +
    'And getters look like data and are code: a getter that does work runs on every access,\n' +
    'including the ones your framework makes while diffing, and including the one the debugger\n' +
    'makes while you hover over it.';
});
