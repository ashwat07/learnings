// Lab 17 — Style recalculation.
//
// All seven changes are implemented — this lab is an experiment, not a broken-code fix.
// The work is: measure, explain the differences, then do the fix list at the bottom.
//
// Important measurement caveat, and part of the lesson: there is NO web API that reports
// "how many elements were restyled". This file forces a style flush and times it, which is a
// proxy. The ground truth is the Performance panel's "Elements Affected". Where the two
// disagree, the panel is right — and the build challenge is about that gap.

PerfHUD.start();

const treeEl = document.getElementById('tree');
const bulkEl = document.getElementById('bulk');
const out = document.getElementById('out');
const tbody = document.querySelector('#results tbody');

let leaves = [];

// ---------------------------------------------------------------------------
// build a deep tree
// ---------------------------------------------------------------------------
function buildTree(total, depth) {
  treeEl.textContent = '';
  const perLevel = Math.max(1, Math.ceil(total / depth));
  let made = 0;
  let parent = treeEl;
  for (let d = 0; d < depth && made < total; d++) {
    const branch = document.createElement('div');
    branch.className = 'branch';
    const row = document.createElement('div');
    row.className = 'row';
    const n = Math.min(perLevel, total - made);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < n; i++) {
      const leaf = document.createElement('span');
      leaf.className = 'leaf';
      frag.appendChild(leaf);
    }
    row.appendChild(frag);
    branch.appendChild(row);
    parent.appendChild(branch);
    parent = branch;              // nest, so depth is real
    made += n;
  }
  leaves = [...treeEl.querySelectorAll('.leaf')];
  report(`built ${leaves.length.toLocaleString()} leaves, depth ${depth}, ` +
    `${document.getElementsByTagName('*').length.toLocaleString()} total DOM nodes`);
}

// ---------------------------------------------------------------------------
// generate a bulk stylesheet, so rule count is an independent variable
// ---------------------------------------------------------------------------
function buildBulk(count) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    // Realistic-looking rules that mostly don't match anything. They still raise the
    // per-element candidate-rule constant.
    parts.push(`.mod-${i % 97} .widget-${i} > .body .label-${i}{color:hsl(${i % 360} 50% 50%);` +
      `padding-left:${i % 7}px}`);
  }
  bulkEl.textContent = parts.join('\n');
}

// ---------------------------------------------------------------------------
// the seven changes
// ---------------------------------------------------------------------------
const CHANGES = {
  inlineLeaf: {
    label: '1 · inline style on a leaf',
    touches: 'one element. The cheap baseline — nothing else can be invalidated.',
    apply(i) { leaves[i % leaves.length].style.opacity = 0.5 + (i % 2) * 0.5; },
    cleanup() { leaves.forEach(l => { l.style.opacity = ''; }); },
  },

  classLeaf: {
    label: '2 · class on a leaf',
    touches: 'one element — .leaf.active has no descendant or sibling rules reaching outward.',
    apply(i) { leaves[i % leaves.length].classList.toggle('active'); },
    cleanup() { leaves.forEach(l => l.classList.remove('active')); },
  },

  classRoot: {
    label: '3 · class on <html>',
    touches: 'potentially every element. This is the theme-toggle pattern.',
    apply() { document.documentElement.classList.toggle('theme-warm'); },
    cleanup() { document.documentElement.classList.remove('theme-warm'); },
  },

  varRoot: {
    label: '4 · custom property on :root',
    touches: 'every descendant that READS the property — custom properties inherit.',
    apply(i) {
      document.documentElement.style.setProperty('--leaf-bg', i % 2 ? '#7c9cff44' : '#6ee7a844');
    },
    cleanup() { document.documentElement.style.removeProperty('--leaf-bg'); },
  },

  varLeaf: {
    label: '5 · custom property on the leaf',
    touches: 'one element. Same property, same value — only the scope differs.',
    apply(i) {
      leaves[i % leaves.length].style.setProperty('--leaf-bg', i % 2 ? '#7c9cff44' : '#6ee7a844');
    },
    cleanup() { leaves.forEach(l => l.style.removeProperty('--leaf-bg')); },
  },

  hasSelector: {
    label: '6 · :has() observed',
    touches: 'ANCESTORS of the changed element — invalidation travels upward.',
    apply(i) { leaves[i % leaves.length].classList.toggle('selected'); },
    cleanup() { leaves.forEach(l => l.classList.remove('selected')); },
  },

  siblingCombinator: {
    label: '7 · ~ observed',
    touches: 'every FOLLOWING sibling of the changed element.',
    apply(i) { leaves[i % leaves.length].classList.toggle('marker'); },
    cleanup() { leaves.forEach(l => l.classList.remove('marker')); },
  },
};

// ---------------------------------------------------------------------------
// measurement
//
// getComputedStyle forces a style flush. We read a NON-layout property (`color`) so we
// measure style recalc without dragging layout into the number — one of the few places
// where a forced read is the right tool rather than the bug.
// ---------------------------------------------------------------------------
function forceStyleFlush() {
  return getComputedStyle(treeEl).color;
}

function measureChange(key, repeats) {
  const change = CHANGES[key];
  change.cleanup();
  forceStyleFlush();

  // Warm up, so the first-run cost of new rules isn't in the sample.
  for (let i = 0; i < 3; i++) { change.apply(i); forceStyleFlush(); }

  performance.mark(`${key}:start`);
  const t0 = performance.now();
  for (let i = 0; i < repeats; i++) {
    change.apply(i);
    forceStyleFlush();           // flush per change, so each one is attributable
  }
  const dt = performance.now() - t0;
  performance.mark(`${key}:end`);
  performance.measure(`style: ${change.label}`, `${key}:start`, `${key}:end`);
  change.cleanup();
  forceStyleFlush();
  return { total: dt, per: dt / repeats };
}

let baseline = null;

function addRow(key, result) {
  const change = CHANGES[key];
  const ratio = baseline ? result.per / baseline : 1;
  tbody.insertAdjacentHTML('beforeend', `<tr>
    <td><strong>${change.label}</strong></td>
    <td>${change.touches}</td>
    <td class="num">${result.total.toFixed(1)}</td>
    <td class="num">${result.per.toFixed(3)}</td>
    <td class="num">${baseline ? ratio.toFixed(1) + '×' : '—'}</td>
    <td class="hint">read it from the trace tooltip — this page cannot know it</td>
  </tr>`);
}

function report(msg) {
  out.textContent = msg;
}

// ---------------------------------------------------------------------------
// wiring
// ---------------------------------------------------------------------------
document.addEventListener('click', e => {
  const key = e.target.closest('button[data-change]')?.dataset.change;
  if (!key) return;
  const repeats = +document.getElementById('repeats').value;
  const result = measureChange(key, repeats);
  if (key === 'inlineLeaf') baseline = result.per;
  addRow(key, result);
  report(`${CHANGES[key].label}: ${result.per.toFixed(3)}ms per change over ${repeats} repeats.\n` +
    `Now record a trace of this and read Elements Affected. That is the number that explains it.`);
});

document.getElementById('runAll').addEventListener('click', () => {
  const repeats = +document.getElementById('repeats').value;
  tbody.innerHTML = '';
  baseline = measureChange('inlineLeaf', repeats).per;
  for (const key of Object.keys(CHANGES)) {
    const result = key === 'inlineLeaf' ? { total: baseline * repeats, per: baseline } : measureChange(key, repeats);
    addRow(key, result);
  }
  report([
    `all seven measured, ${repeats} repeats each, ${leaves.length.toLocaleString()} leaves, ` +
      `${document.getElementById('rules').value} bulk rules.`,
    '',
    'Now do the actual work:',
    '  1. record a trace over "run all" and fill in Elements Affected per change',
    '  2. explain the 4-vs-5 gap (same property, same value)',
    '  3. explain why 6 invalidates upward',
    '  4. re-run at 500 rules and at 40,000 — did cost PER ELEMENT change much?',
    '  5. identify which two of the seven are style-only (no Layout entry follows)',
  ].join('\n'));
});

/**
 * The O(n²) shape that ships constantly: :nth-child striping plus a sibling combinator
 * means each append can restyle everything after it.
 */
document.getElementById('appendTest').addEventListener('click', () => {
  const row = treeEl.querySelector('.row');
  const t0 = performance.now();
  performance.mark('append:start');
  for (let i = 0; i < 1000; i++) {
    const leaf = document.createElement('span');
    leaf.className = 'leaf';
    row.appendChild(leaf);
    forceStyleFlush();           // simulate a framework that reads styles between appends
  }
  performance.mark('append:end');
  performance.measure('append 1,000 with striping', 'append:start', 'append:end');
  const dt = performance.now() - t0;
  leaves = [...treeEl.querySelectorAll('.leaf')];
  report([
    `appended 1,000 leaves in ${dt.toFixed(0)}ms (${(dt / 1000).toFixed(2)}ms each).`,
    '',
    'Now: comment out the `:nth-child(odd)` and `.leaf.marker ~ .leaf` rules in index.html',
    'and run this again. The difference is the O(n²) you just measured.',
    'Then work out whether it scales linearly or worse by trying 2,000 and 4,000.',
  ].join('\n'));
});

document.getElementById('rebuild').addEventListener('click', () => {
  buildTree(+document.getElementById('leaves').value, +document.getElementById('depth').value);
  tbody.innerHTML = '';
  baseline = null;
});

document.getElementById('rules').addEventListener('change', e => {
  buildBulk(+e.target.value);
  tbody.innerHTML = '';
  baseline = null;
  report(`bulk stylesheet is now ${(+e.target.value).toLocaleString()} rules. ` +
    `Re-run all and compare cost per change — this isolates rule count from element count.`);
});

document.getElementById('reset').addEventListener('click', () => {
  Object.values(CHANGES).forEach(c => c.cleanup());
  tbody.innerHTML = '';
  baseline = null;
  PerfHUD.reset();
  report('reset');
});

buildBulk(+document.getElementById('rules').value);
buildTree(+document.getElementById('leaves').value, +document.getElementById('depth').value);
report('Enable CSS selector stats, then click "run all". Predict the ordering of the seven first.');

// ---------------------------------------------------------------------------
// TODO — the fix work (see README for the full brief):
//
// [ ] Scope the theme toggle (change 3). Options: smallest subtree, color-scheme, or accept
//     one restyle but guarantee it never lands mid-animation.
//     elements affected before: ______  after: ______
//
// [ ] Fix the custom-property scope: get change 4 down to change 5's cost with no visual change.
//     before: ______ms/change   after: ______ms/change
//
// [ ] Replace the :has() rule (change 6) with a parent class toggled in JS. Measure.
//     Then argue the other side: when is :has() worth its cost? ____________________
//
// [ ] Remove the sibling/nth-child invalidation and re-run appendTest.
//     1,000 appends before: ______ms   after: ______ms   scaling: linear / worse?
//
// [ ] Apply `contain: style` to .branch and re-measure changes 3, 6, 7. What did it actually
//     contain? (Read the spec — it is narrower than most people assume.) ____________________
//
// [ ] Cut the bulk stylesheet to ~2,000 live rules and re-measure everything. Then RANK your
//     fixes by impact and write down which you would do first on a real project, and why.
// ---------------------------------------------------------------------------
