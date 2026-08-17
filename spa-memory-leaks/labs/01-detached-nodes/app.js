// Lab 01 — Detached DOM nodes.

import { $, on, Log, renderTable, fmt, sleep } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
const view = $('#view');
const rows = [];

// The leaks. Each of these is a real pattern from real code.
const leaked = {
  array: [],          // "keep the rendered rows so we can update them later"
  cache: new Map(),   // "cache the element by id so lookups are fast"
  oneChild: [],       // "keep a reference to the selected row"
  closures: [],       // "register a handler that closes over the view"
};

const rowCount = () => Number($('rows').value);
const cycles = () => Number($('cycles').value);

/** Render a list. Every variant renders exactly the same DOM. */
function render() {
  view.textContent = '';
  const frag = document.createDocumentFragment();
  const nodes = [];
  for (let i = 0; i < rowCount(); i++) {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.id = String(i);
    const label = document.createElement('span');
    label.textContent = `row ${i} — ${'payload '.repeat(6)}`;
    row.append(label);
    frag.append(row);
    nodes.push(row);
  }
  view.append(frag);
  return nodes;
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

async function measure(label) {
  // Give the browser a chance to collect. There is no way to force a GC from a page (window.gc
  // requires --js-flags="--expose-gc"), so this is a best effort — the reliable way to force
  // one is to take a heap snapshot in DevTools, which always GCs first.
  await sleep(120);
  const mem = performance.memory;         // Chrome-only, coarse, but useful for a trend
  const nodeCount = document.getElementsByTagName('*').length;
  const detachedApprox = leaked.array.length + leaked.cache.size + leaked.oneChild.length;

  rows.push({
    point: label,
    'DOM nodes in document': nodeCount,
    'JS heap': mem ? fmt.bytes(mem.usedJSHeapSize) : 'n/a',
    'refs we are holding': detachedApprox,
  });
  renderTable('#results', rows, {
    columns: ['point', 'DOM nodes in document', 'JS heap', 'refs we are holding'],
  });
  log.line(`${label.padEnd(30)} nodes=${nodeCount}  heap=${mem ? fmt.bytes(mem.usedJSHeapSize) : 'n/a'}`, 'macro');
}

on('stats', () => measure('measure'));

on('gc', async () => {
  if (globalThis.gc) { globalThis.gc(); log.ok('forced a GC (--expose-gc is enabled)'); }
  else {
    log.muted('window.gc is unavailable. Take a HEAP SNAPSHOT in the Memory panel instead — ' +
      'snapshotting forces a full GC first, which is why "the leak disappeared when I snapshotted" ' +
      'means it was never a leak.');
  }
  await measure('after GC attempt');
});

// ---------------------------------------------------------------------------
// The leaks
// ---------------------------------------------------------------------------

on('leak-array', async () => {
  log.head(`— A. keeping every rendered node in an array × ${cycles()} —`);
  for (let i = 0; i < cycles(); i++) {
    const nodes = render();
    leaked.array.push(...nodes);      // the entire previous list is now unreachable-but-retained
    await sleep(0);
  }
  await measure(`after A × ${cycles()}`);
  out.textContent =
    'The document has one list in it. JavaScript is holding ' + leaked.array.length + ' nodes.\n\n' +
    'Every previous render is detached — removed from the document, invisible, and immortal.\n' +
    'Each retained node also retains its children, its listeners, and any expando properties.\n\n' +
    'In the Memory panel: take a snapshot and type "Detached" in the class filter. You will see\n' +
    'the count, the retained size, and — in the Retainers pane at the bottom — the exact chain\n' +
    'from a GC root to the node. That chain names the variable holding it.';
});

on('leak-cache', async () => {
  log.head(`— B. caching elements by id × ${cycles()} —`);
  for (let i = 0; i < cycles(); i++) {
    const nodes = render();
    for (const node of nodes) leaked.cache.set(`${i}:${node.dataset.id}`, node);
    await sleep(0);
  }
  await measure(`after B × ${cycles()}`);
  out.textContent =
    'The "element cache" — a Map from id to DOM node, added on render, never cleaned on unmount.\n' +
    'It is written for a good reason (querySelector in a loop is slow) and it turns every render\n' +
    'into a permanent allocation.\n\n' +
    'A Map holds STRONG references to both keys and values. WeakMap holds its KEYS weakly, so\n' +
    '`new WeakMap()` keyed BY the node would be safe — but a Map keyed by string with the node as\n' +
    'the value is not, and that is the shape people write. Lab 04 goes into this properly.';
});

on('leak-parent', async () => {
  log.head(`— C. keeping ONE child of each tree × ${cycles()} —`);
  for (let i = 0; i < cycles(); i++) {
    const nodes = render();
    leaked.oneChild.push(nodes[0]);       // one node out of `rowCount()`
    await sleep(0);
  }
  await measure(`after C × ${cycles()}`);
  out.textContent =
    `We kept ${leaked.oneChild.length} nodes — one per render. But each one has a parentNode, and\n` +
    'that parent has every sibling. So one reference retains the ENTIRE detached tree:\n' +
    `${leaked.oneChild.length} × ${rowCount()} nodes.\n\n` +
    'This is why "we only keep a reference to the selected row" is not a defence, and why the\n' +
    'RETAINED size column matters more than the shallow size. A 200-byte node can retain 8MB.\n\n' +
    'The same applies to an Event object you stored: event.target → the node → its whole tree.';
});

on('leak-closure', async () => {
  log.head(`— D. closures over the container × ${cycles()} —`);
  for (let i = 0; i < cycles(); i++) {
    const nodes = render();
    const container = view.cloneNode(true);           // a detached copy of the whole list
    // A callback that captures `container`. Registered globally, never removed.
    const handler = () => container.childElementCount;
    leaked.closures.push(handler);
    window.addEventListener('resize', handler);
    await sleep(0);
  }
  await measure(`after D × ${cycles()}`);
  out.textContent =
    'The array only holds functions — a few hundred bytes each. But each function closes over\n' +
    '`container`, which is a full detached copy of the list.\n\n' +
    'Closures are the hardest leaks to see because the retaining object looks trivial. In a heap\n' +
    'snapshot the retainer chain runs through a "context" object — that is the closure scope, and\n' +
    'expanding it shows every variable the function captured.\n\n' +
    'A JavaScript closure captures the whole scope, not only the variables it uses (engines\n' +
    'optimise this, but not reliably, and not across a debugger). Keep callbacks small and defined\n' +
    'outside big scopes.';
});

on('clean', async () => {
  log.head(`— E. the same renders, no retention × ${cycles()} —`);
  for (let i = 0; i < cycles(); i++) {
    render();                                   // nothing kept
    await sleep(0);
  }
  await measure(`after E × ${cycles()}`);
  out.textContent =
    'Identical DOM work, identical number of renders, and the heap comes back down (take a\n' +
    'snapshot to force a GC and measure again).\n\n' +
    'That difference — same work, no growth — is the definition of "not a leak". High memory is\n' +
    'not a leak; memory that grows with usage and never returns is.';
});

on('release', async () => {
  for (const h of leaked.closures) window.removeEventListener('resize', h);
  leaked.array.length = 0;
  leaked.cache.clear();
  leaked.oneChild.length = 0;
  leaked.closures.length = 0;
  view.textContent = '';
  log.ok('released every reference — now take a heap snapshot and confirm the detached nodes are gone');
  await measure('after release');
  out.textContent =
    'Everything is released. Take a snapshot and filter for Detached: it should be empty (or\n' +
    'close to it — the snapshot itself and DevTools hold a few).\n\n' +
    'This is the shape of every leak fix: find the retainer, drop the reference. The hard part is\n' +
    'never the fix, it is finding which of the forty things you wrote is holding it.';
});

measure('baseline');
