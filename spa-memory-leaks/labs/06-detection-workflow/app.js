// Lab 06 — The detection workflow.

import { $, on, Log, renderTable, fmt, sleep } from '/shared/lab-ui.js';
import {
  measureCycles, installListenerCounter, listenerReport, suspicionReport, sampleMemory,
  trackMount, trackUnmount,
} from './detector.js';

installListenerCounter();

const log = new Log('#log');
const out = $('out');
const stage = $('#stage');
const rows = [];

// ---------------------------------------------------------------------------
// Five scenarios. Deliberately unlabelled — work out which leak before revealing.
// ---------------------------------------------------------------------------

const holders = { alpha: [], bravo: new Map(), charlie: [], delta: [], echo: [] };

const SCENARIOS = {
  // Detached nodes retained by an array (lab 01).
  alpha() {
    const box = document.createElement('div');
    for (let i = 0; i < 200; i++) {
      const row = document.createElement('div');
      row.textContent = `alpha row ${i}`;
      box.append(row);
    }
    stage.textContent = '';
    stage.append(box);
    const id = trackMount('alpha', box);
    box.remove();
    trackUnmount(id);
    holders.alpha.push(box.firstElementChild);       // ONE child — retains the whole tree
  },

  // Clean: builds the same DOM, keeps nothing.
  bravo() {
    const box = document.createElement('div');
    for (let i = 0; i < 200; i++) {
      const row = document.createElement('div');
      row.textContent = `bravo row ${i}`;
      box.append(row);
    }
    stage.textContent = '';
    stage.append(box);
    const id = trackMount('bravo', box);
    box.remove();
    trackUnmount(id);
  },

  // Listener on window, never removed (lab 02).
  charlie() {
    const state = { rows: new Array(500).fill('charlie') };
    const id = trackMount('charlie', state);
    const handler = () => state.rows.length;
    window.addEventListener('scroll', handler);      // no signal, no removal
    holders.charlie.push(handler);
    trackUnmount(id);
  },

  // Unbounded cache keyed by a unique string (lab 04).
  delta() {
    const key = `delta-${Math.random()}`;
    const value = { key, rows: new Array(500).fill(key) };
    trackUnmount(trackMount('delta', value));
    holders.bravo.set(key, value);
  },

  // An interval, never cleared (lab 03).
  echo() {
    const state = { rows: new Array(300).fill('echo') };
    const id = trackMount('echo', state);
    const timer = setInterval(() => state.rows.length, 1000);
    holders.echo.push(timer);
    trackUnmount(id);
  },
};

const ANSWERS = {
  alpha: 'LEAKS — one retained child keeps the whole detached tree (lab 01, case C)',
  bravo: 'clean — same DOM work, nothing retained',
  charlie: 'LEAKS — a window listener per cycle, never removed (lab 02)',
  delta: 'LEAKS — an unbounded cache keyed by a unique string (lab 04)',
  echo: 'LEAKS — an interval per cycle, never cleared (lab 03)',
};

// ---------------------------------------------------------------------------

async function measure(name) {
  log.head(`— ${name} × ${$('cycles').value} cycles —`);
  const result = await measureCycles(SCENARIOS[name], { cycles: Number($('cycles').value) });

  const verdict = result.slope.nodes > 1 || result.slope.listeners > 0.5 || result.slope.heap > 50_000
    ? 'LEAK'
    : 'looks clean';

  rows.push({
    scenario: name,
    'nodes / cycle': result.slope.nodes.toFixed(2),
    'listeners / cycle': result.slope.listeners.toFixed(2),
    'heap / cycle': fmt.bytes(Math.max(result.slope.heap, 0)),
    verdict,
    _verdictClass: verdict === 'LEAK' ? 'no' : 'ok',
  });
  renderTable('#results', rows, {
    columns: ['scenario', 'nodes / cycle', 'listeners / cycle', 'heap / cycle', 'verdict'],
  });
  log.line(`${name}: nodes ${result.slope.nodes.toFixed(2)}/cycle, ` +
    `listeners ${result.slope.listeners.toFixed(2)}/cycle, heap ${fmt.bytes(result.slope.heap)}/cycle → ${verdict}`,
    verdict === 'LEAK' ? 'bad' : 'good');
  return result;
}

on('run', () => measure($('scenario').value).catch((e) => log.bad(e.message)));

on('runAll', async () => {
  for (const name of Object.keys(SCENARIOS)) {
    await measure(name);
    await sleep(200);
  }
  out.textContent =
    'The slope is the signal. A stable scenario has a slope near zero on all three measures; a\n' +
    'leaking one grows linearly with cycles.\n\n' +
    'Why a slope rather than before/after: the first cycles allocate things that never repeat\n' +
    '(lazy init, JIT, caches), and a GC may run at any moment. Two absolute measurements are\n' +
    'noisy in both directions; a line fitted through twenty is not.\n\n' +
    'Note also which measure caught which scenario — the heap slope is the least reliable of the\n' +
    'three, because performance.memory is coarse and GC timing is unpredictable. Node count and\n' +
    'listener count are far cleaner signals when they apply.';
});

on('reveal', () => {
  renderTable('#results', Object.entries(ANSWERS).map(([scenario, answer]) => ({ scenario, answer })),
    { columns: ['scenario', 'answer'] });
  rows.length = 0;
  out.textContent =
    'Now confirm each one properly in the Memory panel — the detector points at a suspect, a heap\n' +
    'snapshot convicts it:\n\n' +
    '  alpha   → snapshot, filter "Detached". Retainers pane shows the array.\n' +
    '  charlie → getEventListeners(window).scroll.length, or the Elements panel listener tab.\n' +
    '  delta   → snapshot, find the Map, check its retained size.\n' +
    '  echo    → the Performance panel shows repeating Timer Fired tasks; click one for the\n' +
    '            registration stack.\n\n' +
    'Getting from "something leaks" to "this line leaks" is the actual skill, and it is always\n' +
    'the retainer chain that closes the gap.';
});

on('memory', async () => {
  try {
    const sample = await sampleMemory();
    log.ok(JSON.stringify(sample, null, 2));
  } catch (err) {
    log.bad(err.message);
    log.muted(`crossOriginIsolated: ${self.crossOriginIsolated} · ` +
      `measureUserAgentSpecificMemory: ${typeof performance.measureUserAgentSpecificMemory}`);
    log.muted('Reload with ?isolate=1 to get the headers this API requires.');
  }
});

on('listeners', () => {
  try { log.ok(JSON.stringify(listenerReport(), null, 2)); }
  catch (err) { log.bad(err.message); }
});

on('suspicion', () => {
  try { log.ok(JSON.stringify(suspicionReport(), null, 2)); }
  catch (err) { log.bad(err.message); }
});

on('reset', () => location.reload());
