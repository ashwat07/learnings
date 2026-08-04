// Lab 10 — Event listener leaks.
// Modes 1–3 are implemented. Mode 4 (delegation) is yours, as is the audit tool.

PerfHUD.start();

const panel = document.getElementById('panel');
const out = document.getElementById('out');

// ---------------------------------------------------------------------------
// A minimal listener registry, so you can count without leaving the page.
// It uses WeakRef on purpose: an audit tool that holds strong references to the nodes it
// audits is itself a leak. Read that sentence twice — it's the trap in the build challenge.
// ---------------------------------------------------------------------------
const registry = new Set();
const origAdd = EventTarget.prototype.addEventListener;
const origRemove = EventTarget.prototype.removeEventListener;

EventTarget.prototype.addEventListener = function (type, fn, opts) {
  registry.add({ ref: new WeakRef(this), type, label: describe(this) });
  return origAdd.call(this, type, fn, opts);
};
EventTarget.prototype.removeEventListener = function (type, fn, opts) {
  for (const rec of registry) {
    if (rec.type === type && rec.ref.deref() === this) { registry.delete(rec); break; }
  }
  return origRemove.call(this, type, fn, opts);
};

function describe(target) {
  if (target === window) return 'window';
  if (target === document) return 'document';
  if (target instanceof Element) return target.tagName.toLowerCase() + (target.id ? `#${target.id}` : '');
  return String(target);
}

function listenerReport() {
  const byTarget = new Map();
  let collected = 0, detached = 0;
  for (const rec of registry) {
    const t = rec.ref.deref();
    if (!t) { collected++; registry.delete(rec); continue; }
    if (t instanceof Element && !t.isConnected) detached++;
    const key = `${rec.label} · ${rec.type}`;
    byTarget.set(key, (byTarget.get(key) || 0) + 1);
  }
  const top = [...byTarget].sort((a, b) => b[1] - a[1]).slice(0, 8);
  out.textContent = [
    `tracked listeners still alive: ${registry.size.toLocaleString()}`,
    `  on DETACHED elements:        ${detached.toLocaleString()}   ← leak candidates`,
    `  entries whose target was collected (healthy): ${collected.toLocaleString()}`,
    '',
    'top targets:',
    ...top.map(([k, n]) => `  ${String(n).padStart(6)}  ${k}`),
    '',
    'Note: "collected" entries prove the node was freed WITHOUT removeEventListener.',
    'That is the mode-1 answer. Compare with the detached count for modes 2 and 3.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// The leaky retainers — deliberately module-scoped so they show up as roots.
// ---------------------------------------------------------------------------
const retainedHandlers = [];
const documentHandlers = [];
let delegationTeardown = null;

function makeButtons(n) {
  const frag = document.createDocumentFragment();
  const buttons = [];
  for (let i = 0; i < n; i++) {
    const b = document.createElement('button');
    b.textContent = `#${i}`;
    b.dataset.id = i;
    b.dataset.action = i % 3 === 0 ? 'delete' : 'select';
    frag.appendChild(b);
    buttons.push(b);
  }
  panel.appendChild(frag);
  return buttons;
}

// ---------------------------------------------------------------------------
// MODE 1 — per-node listener, no other references. Does this leak?
// ---------------------------------------------------------------------------
function mountPerNodeClean(n) {
  const buttons = makeButtons(n);
  for (const b of buttons) {
    b.addEventListener('click', () => { b.dataset.clicked = '1'; });
  }
  return () => { panel.textContent = ''; };  // nothing else holds the nodes
}

// ---------------------------------------------------------------------------
// MODE 2 — same listeners, but the handler closures are retained in a module array.
// Each closure captures `b`, so every button stays alive, detached, forever.
// ---------------------------------------------------------------------------
function mountPerNodeRetained(n) {
  const buttons = makeButtons(n);
  for (const b of buttons) {
    const handler = () => { b.dataset.clicked = '1'; };
    retainedHandlers.push(handler);      // ← the bug
    b.addEventListener('click', handler);
  }
  return () => { panel.textContent = ''; };
}

// ---------------------------------------------------------------------------
// MODE 3 — each button also registers a DOCUMENT-level listener closing over the button.
// `document` is a root, so all 1,000 buttons are permanently reachable — and worse, all
// 1,000 handlers still RUN on every click in the page, forever.
// ---------------------------------------------------------------------------
function mountDocumentLevel(n) {
  const buttons = makeButtons(n);
  for (const b of buttons) {
    const onDocClick = e => { if (e.target === b) b.dataset.clicked = '1'; };
    document.addEventListener('click', onDocClick);   // never removed
    documentHandlers.push(onDocClick);
  }
  return () => { panel.textContent = ''; };
}

// ---------------------------------------------------------------------------
// MODE 4 — TODO: delegation.
//   · exactly ONE listener on `panel`, regardless of button count
//   · use e.target.closest('button[data-action]') so clicks on child elements work
//   · read the payload from data attributes, not from a captured variable
//   · return a teardown that removes the single listener (use an AbortController)
//   · then verify: after unmount, `listenerReport()` shows ZERO detached listeners
//
// After it works, go find delegation's limits — see the README checklist. Add a
// `focusin` handler and a `mouseenter`-equivalent to this mode and note what you had to do
// differently for each.
// ---------------------------------------------------------------------------
function mountDelegated(n) {
  throw new Error('TODO: mountDelegated() — one listener on #panel, closest() matching, AbortController teardown');
}

// ---------------------------------------------------------------------------

const modes = {
  perNodeClean: mountPerNodeClean,
  perNodeRetained: mountPerNodeRetained,
  documentLevel: mountDocumentLevel,
  delegated: mountDelegated,
};

let unmount = () => { panel.textContent = ''; };

function mount() {
  const mode = document.getElementById('mode').value;
  const n = +document.getElementById('count').value;
  const t0 = performance.now();
  try {
    unmount();
    unmount = modes[mode](n) || (() => { panel.textContent = ''; });
    const dt = performance.now() - t0;
    out.textContent = `mounted ${n.toLocaleString()} buttons (${mode}) in ${dt.toFixed(1)}ms\n` +
      `mount cost per button: ${(dt / n * 1000).toFixed(1)}µs — compare across modes.`;
  } catch (err) {
    out.textContent = `${mode}\n  ${err.message}`;
    console.warn(err);
  }
}

document.getElementById('mount').addEventListener('click', mount);
document.getElementById('unmount').addEventListener('click', () => {
  unmount();
  out.textContent = 'unmounted. Now: force GC in the Memory tab, then click "listener report"\n' +
    'and open Memory → Detached elements.';
});

document.getElementById('cycle').addEventListener('click', () => {
  const mode = document.getElementById('mode').value;
  const n = +document.getElementById('count').value;
  const t0 = performance.now();
  for (let i = 0; i < 10; i++) {
    unmount();
    try { unmount = modes[mode](n) || (() => { panel.textContent = ''; }); }
    catch (err) { out.textContent = `${mode}\n  ${err.message}`; return; }
  }
  unmount();
  out.textContent = `10 mount/unmount cycles of ${n.toLocaleString()} buttons (${mode}) ` +
    `in ${(performance.now() - t0).toFixed(0)}ms.\n` +
    `Force GC, then take a heap snapshot and search for "Detached HTMLButtonElement".`;
});

function stats() {
  out.textContent = [
    `DOM nodes:        ${document.getElementsByTagName('*').length.toLocaleString()}`,
    `buttons in panel: ${panel.children.length.toLocaleString()}`,
    `retained handler closures: ${retainedHandlers.length.toLocaleString()}`,
    `document-level handlers:   ${documentHandlers.length.toLocaleString()}`,
    `tracked live listeners:    ${registry.size.toLocaleString()}`,
    performance.memory
      ? `JS heap: ${(performance.memory.usedJSHeapSize / 1048576).toFixed(1)} MB (coarse)`
      : 'JS heap: performance.memory unavailable',
  ].join('\n');
}

document.getElementById('report').addEventListener('click', listenerReport);
document.getElementById('stats').addEventListener('click', stats);
stats();
