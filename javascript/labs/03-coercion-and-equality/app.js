// Lab 03 — Coercion & equality.
//
// The spec algorithms, implemented and traced. Once you can run them by hand the "wat" talks stop
// being funny and start being obvious.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

const show = (v) => (typeof v === 'string' ? JSON.stringify(v) : typeof v === 'symbol' ? String(v) : Array.isArray(v) ? `[${v}]` : v === null ? 'null' : typeof v === 'object' ? '{}' : String(v));
// The spec's Type() operation, which is NOT typeof: null is its own type, and functions are
// objects.
const type = (v) => {
  if (v === null) return 'Null';
  if (Array.isArray(v)) return 'Object (Array)';
  switch (typeof v) {
    case 'undefined': return 'Undefined';
    case 'number': return 'Number';
    case 'string': return 'String';
    case 'boolean': return 'Boolean';
    case 'symbol': return 'Symbol';
    case 'bigint': return 'BigInt';
    case 'function': return 'Object (Function)';
    default: return 'Object';
  }
};

// ---------------------------------------------------------------------------
// ToPrimitive — the algorithm underneath almost every surprise.
// ---------------------------------------------------------------------------
function toPrimitive(input, hint = 'default', steps = []) {
  if (Object(input) !== input) { steps.push(`${show(input)} is already primitive`); return input; }
  const exotic = input[Symbol.toPrimitive];
  if (exotic) {
    const r = exotic.call(input, hint);
    steps.push(`Symbol.toPrimitive("${hint}") → ${show(r)}`);
    return r;
  }
  // OrdinaryToPrimitive: the METHOD ORDER depends on the hint. This is the whole trick.
  const order = hint === 'string' ? ['toString', 'valueOf'] : ['valueOf', 'toString'];
  steps.push(`hint "${hint}" → try ${order.join(', then ')}`);
  for (const name of order) {
    const fn = input[name];
    if (typeof fn !== 'function') continue;
    const r = fn.call(input);
    steps.push(`  ${name}() → ${show(r)}`);
    if (Object(r) !== r) return r;
    steps.push('  (returned an object — keep going)');
  }
  throw new TypeError('Cannot convert object to primitive value');
}

// ---------------------------------------------------------------------------
// Abstract equality (==), implemented from the spec.
// ---------------------------------------------------------------------------
function looseEquals(a, b, steps = []) {
  const ta = type(a), tb = type(b);
  steps.push(`Type(a) = ${ta}, Type(b) = ${tb}`);
  if (ta === tb) { steps.push('same type → strict equality'); return a === b; }
  if ((a === null && b === undefined) || (a === undefined && b === null)) {
    steps.push('null == undefined → TRUE (a special case, and the only one)'); return true;
  }
  if (ta === 'Number' && tb === 'String') { steps.push(`ToNumber(${show(b)}) → ${Number(b)}`); return looseEquals(a, Number(b), steps); }
  if (ta === 'String' && tb === 'Number') { steps.push(`ToNumber(${show(a)}) → ${Number(a)}`); return looseEquals(Number(a), b, steps); }
  if (ta === 'Boolean') { steps.push(`ToNumber(${show(a)}) → ${Number(a)} — booleans become NUMBERS, not truthiness`); return looseEquals(Number(a), b, steps); }
  if (tb === 'Boolean') { steps.push(`ToNumber(${show(b)}) → ${Number(b)} — booleans become NUMBERS, not truthiness`); return looseEquals(a, Number(b), steps); }
  if (['Number', 'String', 'BigInt', 'Symbol'].includes(ta) && tb.startsWith('Object')) {
    const p = toPrimitive(b, 'default', steps); steps.push(`ToPrimitive(b) → ${show(p)}`); return looseEquals(a, p, steps);
  }
  if (ta.startsWith('Object') && ['Number', 'String', 'BigInt', 'Symbol'].includes(tb)) {
    const p = toPrimitive(a, 'default', steps); steps.push(`ToPrimitive(a) → ${show(p)}`); return looseEquals(p, b, steps);
  }
  steps.push('no rule applies → FALSE');
  return false;
}

const CASES = [
  ['0', false], [0, '0'], ['', 0], [[], false], [[], ''], [[1], 1], [[1, 2], '1,2'],
  [null, undefined], [null, 0], [NaN, NaN], ['0', ''], [{}, '[object Object]'],
];
let caseIndex = 0;

on('trace', () => {
  const [a, b] = CASES[caseIndex++ % CASES.length];
  const steps = [];
  const result = looseEquals(a, b, steps);
  log.head(`${show(a)} == ${show(b)}  →  ${result}`);
  renderTable('#results', steps.map((s, i) => ({ step: i + 1, operation: s })), { columns: ['step', 'operation'] });
  out.textContent =
    `${show(a)} == ${show(b)} is ${result}, and every step is in the table.\n\n` +
    'Press the button repeatedly to walk through a dozen cases. The rules are only six lines long:\n\n' +
    '  1. same type            → strict comparison, done\n' +
    '  2. null == undefined    → true. The ONLY special case, and it is why `x == null` is a\n' +
    '                            legitimate idiom meaning "null or undefined".\n' +
    '  3. number vs string     → ToNumber(string)\n' +
    '  4. either is boolean    → ToNumber(boolean). NOT truthiness — this is why [] == false is\n' +
    '                            true while [] is truthy, which is the single most confusing\n' +
    '                            consequence of the whole algorithm.\n' +
    '  5. object vs primitive  → ToPrimitive(object), then start again\n' +
    '  6. otherwise            → false\n\n' +
    'Notice what is NOT in that list: any notion of "similar", "looks like", or truthiness. == is a\n' +
    'precise algorithm; it is just an algorithm nobody wants.';
});

on('plus', () => {
  const cases = [[1, '2'], [[], {}], [[], []], [1, [2]], [{}, []], [true, 1], [null, 1], [undefined, 1], ['a', { toString: () => 'b' }]];
  const rows = cases.map(([a, b]) => {
    const steps = [];
    const pa = toPrimitive(a, 'default', steps);
    const pb = toPrimitive(b, 'default', steps);
    const eitherString = typeof pa === 'string' || typeof pb === 'string';
    let result;
    try { result = a + b; } catch (e) { result = e.name; }
    return {
      expression: `${show(a)} + ${show(b)}`,
      'ToPrimitive(a)': show(pa),
      'ToPrimitive(b)': show(pb),
      then: eitherString ? 'either is a string → CONCATENATE' : 'both numeric → ADD',
      result: show(result),
    };
  });
  renderTable('#results', rows, { columns: ['expression', 'ToPrimitive(a)', 'ToPrimitive(b)', 'then', 'result'] });
  out.textContent =
    'The `+` algorithm is two steps and explains every famous example:\n\n' +
    '  1. ToPrimitive both operands with hint "default"\n' +
    '  2. if EITHER is now a string → concatenate. Otherwise ToNumber both and add.\n\n' +
    'So [] + {} is "[object Object]" because ToPrimitive([]) is "" (Array.prototype.toString joins,\n' +
    'and an empty array joins to an empty string) and ToPrimitive({}) is "[object Object]".\n\n' +
    'And [] + [] is "" for the same reason — not because "arrays are weird", but because\n' +
    'Array.prototype.join of nothing is the empty string.\n\n' +
    'Two related facts that fall out of the same algorithm:\n' +
    '  · The `-` operator has NO string branch, so [] - [] is 0 while [] + [] is "". The asymmetry\n' +
    '    is entirely in `+`.\n' +
    '  · `+x` is ToNumber and `${x}` is ToString, and they can call DIFFERENT methods on the same\n' +
    '    object (valueOf vs toString) — which is the next button.';
});

on('toprimitive', () => {
  const money = {
    amount: 42,
    valueOf() { return this.amount; },
    toString() { return `£${this.amount}`; },
  };
  const explicit = {
    [Symbol.toPrimitive](hint) { return hint === 'number' ? 99 : hint === 'string' ? 'ninety-nine' : 'default!'; },
  };
  renderTable('#results', [
    { expression: 'money + 1', hint: 'default → valueOf first', result: show(money + 1) },
    { expression: '`${money}`', hint: 'string → toString first', result: show(`${money}`) },
    { expression: '+money', hint: 'number → valueOf first', result: show(+money) },
    { expression: 'money == 42', hint: 'default', result: show(money == 42) },
    { expression: 'explicit + 1', hint: 'default', result: show(explicit + 1) },
    { expression: '+explicit', hint: 'number', result: show(+explicit) },
    { expression: '`${explicit}`', hint: 'string', result: show(`${explicit}`) },
    { expression: 'new Date() + 1', hint: 'default → STRING for Date (the one exception)', result: 'a concatenated string' },
  ], { columns: ['expression', 'hint', 'result'] });
  out.textContent =
    'THREE HINTS, and the hint decides which method is tried first:\n\n' +
    '  "number"   valueOf, then toString   — arithmetic, unary +, comparison operators\n' +
    '  "string"   toString, then valueOf   — template literals, String(), property keys\n' +
    '  "default"  valueOf, then toString   — `+` and `==`\n\n' +
    'Date is the ONE built-in that overrides "default" to behave like "string", which is why\n' +
    '`date + 1` concatenates while `date - 1` gives a timestamp. It is a special case in the spec,\n' +
    'not a rule you can derive.\n\n' +
    'Symbol.toPrimitive lets you take control of all three, and it is genuinely useful for value\n' +
    'objects — a Money, a Duration, a Temperature — where you want `+` to be meaningful and\n' +
    '`${}` to be formatted. It is also how you make a class that throws on accidental coercion,\n' +
    'which is a good defensive move for anything that must never be silently stringified.';
});

on('quiz', () => {
  const q = [
    ['0.1 + 0.2 === 0.3', 0.1 + 0.2 === 0.3, 'binary floating point cannot represent 0.1'],
    ['typeof NaN', typeof NaN, 'NaN is a Number — it means "not a valid number", not "not a number type"'],
    ['NaN === NaN', NaN === NaN, 'the only value not equal to itself. Use Number.isNaN or Object.is'],
    ['[] == false', [] == false, 'ToNumber(false)=0, ToPrimitive([])="", ToNumber("")=0'],
    ['[] ? "truthy" : "falsy"', [] ? 'truthy' : 'falsy', 'ALL objects are truthy — including empty ones'],
    ['null == 0', null == 0, 'null only loosely equals undefined. It is NOT coerced to 0 by ==.'],
    ['null >= 0', null >= 0, 'but RELATIONAL operators DO coerce it: ToNumber(null) is 0'],
    ['typeof null', typeof null, 'a bug from 1995, kept for compatibility forever'],
    ['0 === -0', 0 === -0, 'true — but Object.is(0, -0) is false, and 1/-0 is -Infinity'],
    ['"" == "0"', '' == '0', 'both strings → strict comparison, no coercion'],
    ['[1,2] == "1,2"', [1, 2] == '1,2', 'ToPrimitive uses Array.prototype.join'],
    ['{} + []  (as an expression)', ({}) + [], 'in expression position this is object + array → "[object Object]"'],
  ];
  renderTable('#results', q.map(([expr, val, why]) => ({ expression: expr, result: show(val), why })), { columns: ['expression', 'result', 'why'] });
  out.textContent =
    'None of these is a quirk you have to memorise. Every one falls out of an algorithm you can now\n' +
    'run by hand.\n\n' +
    'The two rows worth staring at together:\n\n' +
    '  null == 0    is FALSE   (== has one special case: null == undefined, and nothing else)\n' +
    '  null >= 0    is TRUE    (relational operators use ToNumber, and ToNumber(null) is 0)\n\n' +
    'So `null` is simultaneously not-equal-to and greater-than-or-equal-to zero. That is not a\n' +
    'paradox; it is two different algorithms. It is also an excellent argument for never comparing\n' +
    'values whose type you are unsure of.\n\n' +
    'And the floating point one is not a JavaScript flaw — 0.1 + 0.2 !== 0.3 in Python, Java, C and\n' +
    'anything else using IEEE 754 doubles. For money, use integers (minor units) or a decimal\n' +
    'library; never a float. See i18n lab 01.';
});

on('rules', () => {
  renderTable('#results', [
    { rule: 'use === always', except: '`x == null` to mean "null or undefined" — the one idiom worth keeping' },
    { rule: 'Number.isNaN, not isNaN', why: 'the global isNaN coerces first: isNaN("foo") is true' },
    { rule: 'Object.is for -0 and NaN', why: 'the only comparison that treats both correctly' },
    { rule: 'Number(x) / String(x), not +x / x+""', why: 'explicit, greppable, and it does not depend on the hint' },
    { rule: 'Array.isArray, not typeof', why: 'typeof [] is "object"; there is no useful typeof for arrays' },
    { rule: 'never rely on truthiness for 0 or ""', why: 'the classic bug: `if (count)` skips a legitimate zero' },
    { rule: 'use ?? not || for defaults', why: '`||` replaces 0 and "" too; `??` only replaces null/undefined' },
    { rule: 'integers (minor units) for money', why: 'floats cannot represent 0.1' },
  ], { columns: ['rule', 'except', 'why'] });
  out.textContent =
    'The `??` row is the one that catches modern code most often:\n\n' +
    '  const timeout = opts.timeout || 3000;    // a caller who passes 0 gets 3000\n' +
    '  const timeout = opts.timeout ?? 3000;    // 0 is respected\n\n' +
    'The same applies to `""`, `false` and `NaN`. Any config value that has a meaningful falsy\n' +
    'value — a count, a delay, a flag, a label — needs `??`.\n\n' +
    'And the honest position on `==`: knowing the algorithm is worth an hour because you will read\n' +
    'code that uses it, and because the interview question is common. Writing it is not worth it —\n' +
    'the one case where it is genuinely clearer (`x == null`) is the case linters explicitly allow\n' +
    '(eslint eqeqeq has a `smart`/`allow-null` option for exactly this).';
});
