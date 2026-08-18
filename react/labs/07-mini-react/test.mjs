/**
 * A headless test for mini-react.js: a 25-line DOM shim, then assertions about the things that are
 * hard to be sure of by clicking — reconciliation by key, effect ordering, cleanup on unmount, and
 * the state corruption that index keys cause.
 *
 *   node test.mjs
 *
 * Being able to test a renderer without a browser is the point of the DOM adapter being the only
 * browser-specific part of the file.
 */

class N {
  constructor(tag) { this.tag = tag; this.childNodes = []; this.style = {}; this.attrs = {}; this.listeners = {}; }
  appendChild(c) { this.childNodes = this.childNodes.filter((x) => x !== c); this.childNodes.push(c); c.parent = this; return c; }
  removeChild(c) { this.childNodes = this.childNodes.filter((x) => x !== c); return c; }
  insertBefore(c, ref) {
    this.childNodes = this.childNodes.filter((x) => x !== c);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i === -1) this.childNodes.push(c); else this.childNodes.splice(i, 0, c);
    c.parent = this; return c;
  }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); }
  removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] ?? []).filter((f) => f !== fn); }
  get firstChild() { return this.childNodes[0] ?? null; }
  get nextSibling() { const s = this.parent?.childNodes ?? []; return s[s.indexOf(this) + 1] ?? null; }
  get text() { return this.tag === '#text' ? this.nodeValue : this.childNodes.map((c) => c.text).join(''); }
}
globalThis.document = { createElement: (t) => new N(t), createTextNode: () => Object.assign(new N('#text'), { nodeValue: '' }) };

const { h, render, useState, useEffect } = await import('./mini-react.js');

let pass = 0, fail = 0;
const assert = (label, cond, extra = '') => {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${label} ${extra}`); }
};
const tick = () => new Promise((r) => setTimeout(r, 5));

// ---------------------------------------------------------------------------
// A component with per-item state, so we can see which fiber an element continued.
// ---------------------------------------------------------------------------
function Child({ label }) {
  const [seeded] = useState(label);          // captured on the FIRST render only
  return h('li', null, `${label}:${seeded}`);
}

async function scenario(keyMode) {
  const root = new N('root');
  let setOrder;
  let effects = 0, cleanups = 0, unmounts = 0;

  function App() {
    const [reversed, set] = useState(false);
    setOrder = set;
    useEffect(() => { effects++; return () => { cleanups++; }; }, [reversed]);
    const items = reversed ? ['b', 'a'] : ['a', 'b'];
    return h('ul', null, ...items.map((l, i) => h(Child, { key: keyMode === 'index' ? i : l, label: l })));
  }
  render(h(App, null), root);
  void unmounts;
  return { root, setOrder: (v) => setOrder(v), stats: () => ({ effects, cleanups }) };
}

console.log('\n\x1b[1mkeyed by id\x1b[0m');
{
  const s = await scenario('id');
  assert('mounted in order', s.root.text === 'a:ab:b', `→ "${s.root.text}"`);
  assert('effect ran once, after commit', s.stats().effects === 1);
  s.setOrder(true); await tick();
  assert('DOM reordered', s.root.text.startsWith('b:'), `→ "${s.root.text}"`);
  assert('state followed its item', s.root.text === 'b:ba:a', `→ "${s.root.text}"`);
  assert('cleanup ran before the next effect', s.stats().cleanups === 1);
  assert('no nodes were recreated', s.root.childNodes[0].childNodes.length === 2);
}

console.log('\n\x1b[1mkeyed by index — the bug\x1b[0m');
{
  const s = await scenario('index');
  assert('mounted in order', s.root.text === 'a:ab:b', `→ "${s.root.text}"`);
  s.setOrder(true); await tick();
  // The element at index 0 is now `b`, but it continued the fiber that was seeded with 'a'.
  assert('state stayed with the POSITION, not the item', s.root.text === 'b:aa:b', `→ "${s.root.text}"`);
  console.log('      ^ the label changed and the seeded state did not — that is the corruption');
}

console.log('\n\x1b[1munmount cleanup\x1b[0m');
{
  const root = new N('root');
  let hide; let cleanups = 0;
  function WithEffect() {
    useEffect(() => () => { cleanups++; }, []);
    return h('span', null, 'x');
  }
  function App2() {
    const [shown, set] = useState(true);
    hide = set;
    return h('div', null, shown ? h(WithEffect, null) : null);
  }
  render(h(App2, null), root);
  hide(false); await tick();
  assert('cleanup ran when the subtree was removed', cleanups === 1, `cleanups=${cleanups}`);
  assert('the node was removed from the DOM', root.text === '', `→ "${root.text}"`);
}

console.log(`\n${fail ? `\x1b[31m${fail} failing\x1b[0m, ` : ''}${pass} passing\n`);
process.exit(fail ? 1 : 0);
