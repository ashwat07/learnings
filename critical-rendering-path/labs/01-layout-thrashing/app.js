// Lab 01 — Layout thrashing.

import FastDOM from './fast-dom.js';

PerfHUD.start({
  countReflows: true,
  note: 'reads = candidate\nforced layouts',
});

const stage = document.getElementById('stage');
const out = document.getElementById('out');
const countInput = document.getElementById('count');

const fd = new FastDOM();

let boxes = [];

function build(n) {
  stage.textContent = '';

  const frag = document.createDocumentFragment();

  for (let i = 0; i < n; i++) {
    const box = document.createElement('div');
    box.className = 'box';
    frag.appendChild(box);
  }

  stage.appendChild(frag);

  boxes = [...stage.children];

  report(`built ${n} boxes`);
}

function report(msg) {
  out.textContent =
    `${msg}\ngeometry reads so far: ${PerfHUD.stats.reflowReads}`;
}

/**
 * Time a strategy and print the JS duration.
 */
function run(label, fn) {
  const reads0 = PerfHUD.stats.reflowReads;
  const t0 = performance.now();

  performance.mark(`${label}:start`);

  const widths = fn();

  performance.mark(`${label}:end`);
  performance.measure(label, `${label}:start`, `${label}:end`);

  const dt = performance.now() - t0;

  const sum = widths
    ? widths.reduce((a, b) => a + b, 0)
    : 0;

  report(
    `${label}\n` +
    `  JS + forced layout: ${dt.toFixed(1)}ms\n` +
    `  geometry reads this run: ${PerfHUD.stats.reflowReads - reads0}\n` +
    `  checksum (sum of widths): ${Math.round(sum)}`
  );
}

// ---------------------------------------------------------------------------
// 1. BROKEN
//
// WRITE → READ → WRITE → READ
//
// Every offsetWidth read can force layout because the previous iteration
// dirtied the layout.
// ---------------------------------------------------------------------------

function thrash() {
  const widths = [];

  boxes.forEach((box) => {
    // WRITE
    box.style.width = Math.random() * 500 + 'px';

    // READ
    // Potentially forces layout.
    widths.push(box.offsetWidth);
  });

  return widths;
}

// ---------------------------------------------------------------------------
// 2. BATCHED
//
// WRITE → WRITE → WRITE
// READ  → READ  → READ
//
// There is only one forced layout: the first offsetWidth read.
// ---------------------------------------------------------------------------

function batched() {
  const widths = [];

  // -------------------------
  // WRITE PHASE
  // -------------------------

  boxes.forEach((box) => {
    box.style.width = Math.random() * 500 + 'px';
  });

  // -------------------------
  // READ PHASE
  // -------------------------

  boxes.forEach((box) => {
    widths.push(box.offsetWidth);
  });

  return widths;
}

// ---------------------------------------------------------------------------
// 3. BATCHED + rAF
//
// Frame N:
//   WRITE
//
// Browser performs its normal layout after the rAF callback.
//
// Frame N+1:
//   READ
//
// Therefore the reads don't need to synchronously force layout.
// ---------------------------------------------------------------------------

function batchedRaf() {
  requestAnimationFrame(() => {
    // -------------------------
    // Frame N — WRITE
    // -------------------------

    boxes.forEach((box) => {
      box.style.width = Math.random() * 500 + 'px';
    });

    // Schedule READS for the next frame.
    requestAnimationFrame(() => {
      // -------------------------
      // Frame N+1 — READ
      // -------------------------

      const widths = [];

      boxes.forEach((box) => {
        widths.push(box.offsetWidth);
      });

      const sum = widths.reduce((a, b) => a + b, 0);

      report(
        `batched + rAF\n` +
        `  checksum (sum of widths): ${Math.round(sum)}\n` +
        `  geometry reads: ${PerfHUD.stats.reflowReads}`
      );
    });
  });

  // The actual result doesn't exist yet.
  // The reads happen asynchronously in the next frame.
  return null;
}

// ---------------------------------------------------------------------------
// 4. CACHED READ
//
// Read the container width ONCE.
//
// Then calculate every box width from that cached value.
// There is no offsetWidth read inside the loop.
//
// ---------------------------------------------------------------------------

function cachedConstant() {
  const widths = [];

  // One geometry read.
  //
  // This happens BEFORE we make the children dirty.
  const containerWidth = stage.offsetWidth;

  boxes.forEach((box) => {
    const width = containerWidth * Math.random();

    // WRITE
    box.style.width = width + 'px';

    // We already know the width we wrote.
    // There is no reason to read offsetWidth again.
    widths.push(width);
  });

  return widths;
}

// ---------------------------------------------------------------------------

const strategies = {
  thrash: ['thrash (broken)', thrash],
  batched: ['batched', batched],
  batchedRaf: ['batched + rAF', batchedRaf],
  cached: ['cached read', cachedConstant],
};

for (const [id, [label, fn]] of Object.entries(strategies)) {
  document.getElementById(id).addEventListener('click', () => {
    try {
      run(label, fn);
    } catch (err) {
      out.textContent = `${label}\n  ${err.message}`;
      console.warn(err);
    }
  });
}

document.getElementById('rebuild').addEventListener('click', () => {
  build(+countInput.value);
});

document.getElementById('reset').addEventListener('click', () => {
  PerfHUD.reset();
  report('HUD reset');
});

build(+countInput.value);