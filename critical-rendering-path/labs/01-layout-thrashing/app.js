// Lab 01 — Layout thrashing.
// One function is implemented (badly, on purpose). Three are yours to write.

PerfHUD.start({ countReflows: true, note: 'reads = candidate\nforced layouts' });

const stage = document.getElementById('stage');
const out = document.getElementById('out');
const countInput = document.getElementById('count');

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
  out.textContent = `${msg}\ngeometry reads so far: ${PerfHUD.stats.reflowReads}`;
}

/** Time a strategy and print the JS duration. The layout cost is *inside* this measurement
 *  when layout is forced — which is exactly why the broken version looks so bad. */
function run(label, fn) {
  const reads0 = PerfHUD.stats.reflowReads;
  const t0 = performance.now();
  performance.mark(`${label}:start`);
  const widths = fn();
  performance.mark(`${label}:end`);
  performance.measure(label, `${label}:start`, `${label}:end`);
  const dt = performance.now() - t0;
  const sum = widths ? widths.reduce((a, b) => a + b, 0) : 0;
  report(
    `${label}\n` +
    `  JS + forced layout: ${dt.toFixed(1)}ms\n` +
    `  geometry reads this run: ${PerfHUD.stats.reflowReads - reads0}\n` +
    `  checksum (sum of widths): ${Math.round(sum)}`
  );
}

// ---------------------------------------------------------------------------
// 1. BROKEN — write, read, write, read. One forced layout per box.
// ---------------------------------------------------------------------------
function thrash() {
  const widths = [];
  boxes.forEach(box => {
    box.style.width = Math.random() * 500 + 'px';
    widths.push(box.offsetWidth); // ← forces layout, every single iteration
  });
  return widths;
}

// ---------------------------------------------------------------------------
// 2. TODO — batched.
//    Produce the same array of widths with exactly ONE layout flush.
//    Rule: same visual result, same checksum semantics (a width per box).
//    Think about *which order* the passes have to be in.
// ---------------------------------------------------------------------------
function batched() {
  throw new Error('TODO: implement batched() — read pass and write pass, one Layout entry total');
}

// ---------------------------------------------------------------------------
// 3. TODO — batched + requestAnimationFrame.
//    Do the writes inside a single rAF callback and the reads in the frame after.
//    Return value can be a Promise<number[]>; run() will just print NaN for the
//    checksum, so print your own report from inside instead.
//
//    Then answer in a comment here: what does rAF buy you that batching alone does not?
// ---------------------------------------------------------------------------
function batchedRaf() {
  throw new Error('TODO: implement batchedRaf()');
}

// ---------------------------------------------------------------------------
// 4. TODO — cached read.
//    The realistic version of this bug: the read is loop-invariant. Every box is
//    sized relative to the CONTAINER width, which cannot change while you write
//    to children (the container is a flex row of fixed-height items — convince
//    yourself of that before you cache it, because caching a value that *can*
//    change is a correctness bug, not an optimisation).
//    Target: ZERO geometry reads inside the loop.
// ---------------------------------------------------------------------------
function cachedConstant() {
  throw new Error('TODO: implement cachedConstant() — hoist the invariant read out of the loop');
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

document.getElementById('rebuild').addEventListener('click', () => build(+countInput.value));
document.getElementById('reset').addEventListener('click', () => { PerfHUD.reset(); report('HUD reset'); });

build(+countInput.value);
