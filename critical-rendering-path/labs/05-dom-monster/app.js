// Lab 05 — DOM monster.
// Strategies 0 and 1 are implemented. 2–5 are yours.

PerfHUD.start();

const viewport = document.getElementById('viewport');
const rowsEl = document.getElementById('rows');
const out = document.getElementById('out');

/** Deterministic pseudo-random so every run renders the same data. */
function seeded(i) { return ((i * 2654435761) % 1000) / 1000; }
function datum(i) {
  return { id: i, name: `item-${i.toString(36)}-${(i * 7919) % 99991}`, val: (seeded(i) * 1000) | 0 };
}

let teardown = () => {};

function clear() {
  teardown();
  teardown = () => {};
  rowsEl.textContent = '';
  rowsEl.style.height = '';
  viewport.scrollTop = 0;
}

function report(lines) { out.textContent = lines.join('\n'); }

/** Measure JS time AND time-to-paint. The gap between them is the lesson of this lab. */
function measure(label, n, fn) {
  clear();
  const t0 = performance.now();
  performance.mark(`${label}:js-start`);
  fn(n);
  performance.mark(`${label}:js-end`);
  performance.measure(`${label} (JS)`, `${label}:js-start`, `${label}:js-end`);
  const js = performance.now() - t0;
  report([`${label} — ${n.toLocaleString()} rows`, `  JS:       ${js.toFixed(1)}ms`, `  to paint: measuring…`]);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const toPaint = performance.now() - t0;
    performance.mark(`${label}:paint`);
    performance.measure(`${label} (to paint)`, `${label}:js-start`, `${label}:paint`);
    report([
      `${label} — ${n.toLocaleString()} rows`,
      `  JS:       ${js.toFixed(1)}ms`,
      `  to paint: ${toPaint.toFixed(1)}ms   ← the number that matters`,
      `  ratio:    ${(toPaint / js).toFixed(1)}× the JS time`,
      `  DOM nodes: ${document.getElementsByTagName('*').length.toLocaleString()}`,
      `  now scroll for 3s and read FPS off the HUD.`,
    ]);
  }));
}

function rowHtml(d) {
  return `<div class="row"><span class="id">${d.id}</span>` +
    `<span class="name">${d.name}</span>` +
    `<span class="val">${d.val}</span>` +
    `<span class="bar" style="width:${d.val / 8}px"></span></div>`;
}

function rowNode(d, node) {
  const el = node || document.createElement('div');
  if (!node) {
    el.className = 'row';
    el.innerHTML = '<span class="id"></span><span class="name"></span><span class="val"></span><span class="bar"></span>';
  }
  const [id, name, val, bar] = el.children;
  id.textContent = d.id;
  name.textContent = d.name;
  val.textContent = d.val;
  bar.style.width = d.val / 8 + 'px';
  return el;
}

// ---------------------------------------------------------------------------
// 0. WORST — string concatenation into innerHTML. O(n²): serialise + reparse the whole
//    subtree on every single iteration. Try it with 20,000 rows, not 100,000, unless you
//    enjoy waiting.
// ---------------------------------------------------------------------------
function renderInnerHtml(n) {
  for (let i = 0; i < n; i++) rowsEl.innerHTML += rowHtml(datum(i));
}

// ---------------------------------------------------------------------------
// 1. BROKEN (but normal-looking) — one appendChild per row, straight into the live tree.
// ---------------------------------------------------------------------------
function renderNaive(n) {
  for (let i = 0; i < n; i++) rowsEl.appendChild(rowNode(datum(i)));
}

// ---------------------------------------------------------------------------
// 2. TODO — DocumentFragment.
//    Build off-tree, append once. Predict the improvement first: is the win big or small,
//    and which stage does it actually help? (The answer is more interesting than you think —
//    appendChild to a live parent doesn't force layout, it only marks dirty.)
// ---------------------------------------------------------------------------
function renderFragment(n) {
  throw new Error('TODO: renderFragment() — and predict the size of the win before measuring');
}

// ---------------------------------------------------------------------------
// 3. TODO — content-visibility.
//    Same DOM as strategy 2, plus one CSS declaration on the rows (add the class in
//    index.html). Then find its two downsides and write them here:
//      downside 1: ______________________
//      downside 2: ______________________
// ---------------------------------------------------------------------------
function renderContentVisibility(n) {
  throw new Error('TODO: renderContentVisibility() — one CSS line, then find the catch');
}

// ---------------------------------------------------------------------------
// 4. TODO — pagination.
//    200 rows per page, with prev/next controls you create here. Trivially fast.
//    Note in a comment what it costs the USER, not the browser.
// ---------------------------------------------------------------------------
function renderPaginated(n) {
  throw new Error('TODO: renderPaginated() — 200 per page + controls');
}

// ---------------------------------------------------------------------------
// 5. TODO — virtualization. The real one.
//    Requirements:
//      · #rows gets the full scroll height so the scrollbar is honest
//      · only the visible window + overscan exists in the DOM (assert ≤ 200 nodes)
//      · rows are positioned with transform: translateY, not top (Lab 03)
//      · scroll updates are rAF-coalesced with no geometry reads per event (Labs 01 & 02)
//      · recycle nodes via rowNode(d, existingNode) instead of recreating them
//      · assign `teardown` so switching strategies removes your scroll listener
//    Start with a fixed 28px row height. Then, once it works, try variable heights.
// ---------------------------------------------------------------------------
function renderVirtualized(n) {
  throw new Error('TODO: renderVirtualized() — windowing, node recycling, honest scrollbar');
}

// ---------------------------------------------------------------------------

const strategies = {
  innerHTML: ['innerHTML +=', renderInnerHtml],
  naive: ['appendChild per row', renderNaive],
  fragment: ['DocumentFragment', renderFragment],
  cv: ['content-visibility', renderContentVisibility],
  paginated: ['paginated', renderPaginated],
  virtualized: ['virtualized', renderVirtualized],
};

document.getElementById('render').addEventListener('click', () => {
  const key = document.getElementById('strategy').value;
  const [label, fn] = strategies[key];
  const n = +document.getElementById('count').value;
  if (key === 'innerHTML' && n > 20000 &&
      !confirm(`innerHTML += with ${n.toLocaleString()} rows will hang the tab for a long time. Continue?`)) return;
  try {
    measure(label, n, fn);
  } catch (err) {
    report([label, `  ${err.message}`]);
    console.warn(err);
  }
});

document.getElementById('clear').addEventListener('click', () => { clear(); report(['cleared']); });
document.getElementById('nodes').addEventListener('click', () => {
  report([
    `DOM nodes: ${document.getElementsByTagName('*').length.toLocaleString()}`,
    `rows in DOM: ${rowsEl.querySelectorAll('.row').length.toLocaleString()}`,
    `scrollTop: ${viewport.scrollTop} / ${viewport.scrollHeight}`,
  ]);
});
document.getElementById('reset').addEventListener('click', () => { PerfHUD.reset(); report(['reset']); });
