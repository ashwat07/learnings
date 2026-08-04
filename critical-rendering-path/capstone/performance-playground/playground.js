// Performance playground — the harness.
//
// This is provided so you can spend your time on the demos rather than on plumbing.
// It is deliberately small; extend it as you need. Two rules:
//
//   1. The harness must cost < 1ms per frame. Profile it. A slow performance playground is
//      not a funny joke.
//   2. teardown() must be complete. You are building leak demos; if the harness leaks, every
//      measurement lies. Verify with the heap test described in README.md.

import layoutThrashing from './demos/layout-thrashing.js';

// ---------------------------------------------------------------------------
// The registry. Add each demo as you write it.
// The `todo` entries are your worklist — replace each with a real import.
// ---------------------------------------------------------------------------
const DEMOS = [layoutThrashing];

const TODO = [
  { id: 'scroll-jank', title: 'Scroll jank', stage: 'Layout', lab: 2 },
  { id: 'wrong-property', title: 'Animating the wrong property', stage: 'Composite', lab: 3 },
  { id: 'paint-area', title: 'Paint area', stage: 'Paint', lab: 4 },
  { id: 'paint-cost', title: 'Per-pixel paint cost', stage: 'Paint', lab: 6 },
  { id: 'dom-size', title: 'DOM size', stage: 'Layout', lab: 5 },
  { id: 'containment', title: 'Containment', stage: 'Layout', lab: 5 },
  { id: 'blocking-js', title: 'Render-blocking JS', stage: 'JS', lab: 7 },
  { id: 'blocking-css', title: 'Render-blocking CSS', stage: 'Network', lab: 13 },
  { id: 'waterfall', title: 'Network waterfall', stage: 'Network', lab: 12 },
  { id: 'images', title: 'Images', stage: 'Network', lab: 11 },
  { id: 'layout-shift', title: 'Layout shift', stage: 'Layout', lab: 11 },
  { id: 'memory-leak', title: 'Memory leak', stage: 'Memory', lab: 9 },
  { id: 'listener-leak', title: 'Listener leak', stage: 'Memory', lab: 10 },
  { id: 'layers', title: 'Composite layers', stage: 'Composite', lab: 15 },
  { id: 'rerender', title: 'Framework re-render', stage: 'JS', lab: 8 },
  { id: 'long-tasks', title: 'Long tasks', stage: 'JS', lab: 7 },
  { id: 'web-font', title: 'Web font loading', stage: 'Network', lab: 13 },
];

const STAGES = ['Style', 'Layout', 'Paint', 'Composite', 'JS', 'Network', 'Memory'];

// ---------------------------------------------------------------------------
const el = {
  nav: document.getElementById('nav'),
  stage: document.getElementById('stage'),
  blurb: document.getElementById('blurb'),
  metric: document.getElementById('metric'),
  tip: document.getElementById('devtools-tip'),
  stageTag: document.getElementById('stage-tag'),
  predict: document.getElementById('predict'),
  predictText: document.getElementById('predict-text'),
  predictReveal: document.getElementById('predict-reveal'),
  modeBroken: document.getElementById('mode-broken'),
  modeFixed: document.getElementById('mode-fixed'),
  run: document.getElementById('run'),
  reset: document.getElementById('reset'),
};

let current = null;
let mode = 'broken';
const results = new Map();   // `${id}:${mode}` → measurement string

PerfHUD.start();

function renderNav() {
  const byStage = new Map(STAGES.map(s => [s, []]));
  for (const d of DEMOS) byStage.get(d.stage)?.push({ ...d, ready: true });
  for (const d of TODO) byStage.get(d.stage)?.push({ ...d, ready: false });

  el.nav.innerHTML = STAGES.map(stage => {
    const items = byStage.get(stage);
    if (!items?.length) return '';
    return `<h3>${stage}</h3>` + items.map(d =>
      `<a href="#/${d.id}" class="${d.ready ? '' : 'todo'}" data-id="${d.id}">` +
      `${d.title}${d.ready ? '' : ' · todo'}<span class="hint"> lab ${String(d.lab).padStart(2, '0')}</span></a>`
    ).join('');
  }).join('');
}

function setMode(next) {
  mode = next;
  el.modeBroken.setAttribute('aria-pressed', String(mode === 'broken'));
  el.modeFixed.setAttribute('aria-pressed', String(mode === 'fixed'));
  syncHash();
  if (current) mount(current.id, { keepMeasurement: true });
}

function syncHash() {
  const id = current?.id;
  if (id) history.replaceState(null, '', `#/${id}?mode=${mode}`);
}

function showMetric() {
  const broken = results.get(`${current.id}:broken`);
  const fixed = results.get(`${current.id}:fixed`);
  el.metric.innerHTML =
    `metric: <b>${current.metric}</b><br>` +
    `broken: <b>${broken ?? '– run it –'}</b><br>` +
    `fixed:  <b>${fixed ?? '– run it –'}</b>`;
}

function mount(id, { keepMeasurement = false } = {}) {
  const demo = DEMOS.find(d => d.id === id);
  const todo = TODO.find(d => d.id === id);

  // Teardown must be total. This is the part that makes the leak demos trustworthy.
  if (current?.teardown) {
    try { current.teardown(el.stage); } catch (err) { console.error('[playground] teardown threw', err); }
  }
  el.stage.textContent = '';
  PerfHUD.reset();

  el.nav.querySelectorAll('a').forEach(a =>
    a.setAttribute('aria-current', String(a.dataset.id === id)));

  if (!demo) {
    current = null;
    el.stageTag.textContent = todo?.stage ?? '—';
    el.blurb.textContent = todo
      ? `Not written yet. Create demos/${todo.id}.js exporting the demo interface (see ` +
        `demos/layout-thrashing.js), then add it to the registry in playground.js. Source material: Lab ${todo.lab}.`
      : 'Pick a demo.';
    el.metric.textContent = '';
    el.tip.textContent = '';
    el.predict.hidden = true;
    return;
  }

  current = demo;
  if (!keepMeasurement) { results.delete(`${id}:broken`); results.delete(`${id}:fixed`); }
  el.stageTag.textContent = `${demo.stage} · lab ${String(demo.lab).padStart(2, '0')}`;
  el.blurb.textContent = demo.blurb;
  el.tip.textContent = demo.devtools ?? '';
  el.predict.hidden = !demo.predict;
  if (demo.predict) {
    el.predictText.textContent = demo.predict;
    el.predictReveal.hidden = false;
    el.metric.style.filter = 'blur(4px)';
  } else {
    el.metric.style.filter = '';
  }
  try { demo.setup?.(el.stage, mode); } catch (err) { console.error('[playground] setup threw', err); }
  showMetric();
  syncHash();
}

el.run.addEventListener('click', async () => {
  if (!current) return;
  try {
    const result = await current.run(el.stage, mode);
    if (result != null) {
      results.set(`${current.id}:${mode}`, String(result));
      showMetric();
    }
  } catch (err) {
    el.metric.textContent = `error: ${err.message}`;
    console.error('[playground]', err);
  }
});

el.reset.addEventListener('click', () => {
  if (!current) return;
  results.delete(`${current.id}:broken`);
  results.delete(`${current.id}:fixed`);
  PerfHUD.reset();
  showMetric();
});

el.predictReveal.addEventListener('click', () => {
  el.metric.style.filter = '';
  el.predictReveal.hidden = true;
});

el.modeBroken.addEventListener('click', () => setMode('broken'));
el.modeFixed.addEventListener('click', () => setMode('fixed'));

function route() {
  const [, path = '', query = ''] = location.hash.match(/^#\/([^?]*)\??(.*)$/) || [];
  const wanted = new URLSearchParams(query).get('mode');
  if (wanted === 'broken' || wanted === 'fixed') {
    mode = wanted;
    el.modeBroken.setAttribute('aria-pressed', String(mode === 'broken'));
    el.modeFixed.setAttribute('aria-pressed', String(mode === 'fixed'));
  }
  mount(path || DEMOS[0]?.id);
}

addEventListener('hashchange', route);
renderNav();
route();

// ---------------------------------------------------------------------------
// TODO — harness work of your own:
//
// [ ] A heap self-test: switch through every demo 50 times, force GC, and assert the heap
//     and detached-node count are flat. Put it behind a button.
// [ ] Profile the harness itself and prove it costs < 1ms/frame. Write the number in README.
// [ ] A CPU-throttle nag: if a demo runs suspiciously fast, remind the visitor to throttle.
//     (You can't read the throttle setting from JS — think about how to infer it. A calibration
//     benchmark on first load is one option; say what its limitations are.)
// [ ] Per-demo "what to look for in DevTools" text for every demo. Non-negotiable: the goal is
//     to make people open the Performance panel, not to replace it.
// ---------------------------------------------------------------------------
