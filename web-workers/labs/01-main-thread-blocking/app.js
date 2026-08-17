// Lab 01 — Main-thread blocking (page side).

import { $, on, Log, renderTable, fmt } from '/shared/lab-ui.js';

PerfHUD.start({ note: 'watch worst frame\nand long tasks' });

const log = new Log('#log');
const out = $('out');
const rows = [];

// ---------------------------------------------------------------------------
// Liveness probes
// ---------------------------------------------------------------------------

let frames = 0, clicks = 0, worstFrame = 0, lastFrame = performance.now();
const jsSpinner = $('#jsSpinner');
(function tick(now) {
  const dt = now - lastFrame; lastFrame = now; frames++;
  if (dt > worstFrame) worstFrame = dt;
  jsSpinner.style.transform = `rotate(${(now / 4) % 360}deg)`;
  requestAnimationFrame(tick);
})(performance.now());

on('poke', () => { clicks++; $('poke').textContent = `poke me (${clicks} handled)`; });

const url = () => `/api/rows?n=${$('rows').value}`;

// ---------------------------------------------------------------------------
// The transform, main-thread copy of the worker's.
// ---------------------------------------------------------------------------

function summarise(rows_) {
  const byTeam = new Map();
  for (const row of rows_) {
    let b = byTeam.get(row.team);
    if (!b) byTeam.set(row.team, b = { team: row.team, n: 0, score: 0, active: 0, tags: new Set() });
    b.n++; b.score += row.score;
    if (row.active) b.active++;
    for (const t of row.tags) b.tags.add(t);
  }
  return [...byTeam.values()]
    .map((b) => ({ team: b.team, n: b.n, avg: +(b.score / b.n).toFixed(2), active: b.active, tags: b.tags.size }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 12);
}

function showSummary(summary) {
  $('#summary').textContent = summary
    .map((s) => `${s.team.padEnd(10)} n=${String(s.n).padStart(6)}  avg=${String(s.avg).padStart(8)}  active=${s.active}`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Measurement wrapper
// ---------------------------------------------------------------------------

async function measure(label, fn) {
  const f0 = frames, c0 = clicks;
  worstFrame = 0;
  log.head(`— ${label} —`);
  log.muted('mash the poke button while this runs');
  const t0 = performance.now();
  const detail = await fn();
  const wall = performance.now() - t0;
  const painted = frames - f0;

  rows.push({
    strategy: label,
    'wall ms': Math.round(wall),
    'frames painted': painted,
    fps: Number((painted / (wall / 1000)).toFixed(1)),
    'clicks handled': clicks - c0,
    'worst frame ms': Math.round(worstFrame),
    _fpsClass: painted / (wall / 1000) > 45 ? 'ok' : 'no',
  });
  renderTable('#results', rows, {
    columns: ['strategy', 'wall ms', 'frames painted', 'fps', 'clicks handled', 'worst frame ms'],
  });
  log.line(`${label}: ${fmt.ms(wall)} wall, ${painted} frames, worst frame ${Math.round(worstFrame)}ms` +
    (detail ? `  [${detail}]` : ''),
    painted / (wall / 1000) > 45 ? 'good' : 'bad');
}

// ---------------------------------------------------------------------------
// A. Everything on the main thread
// ---------------------------------------------------------------------------

on('main', () => measure('A. main thread', async () => {
  const res = await fetch(url());
  const t0 = performance.now();
  const data = await res.json();          // ← the biggest single block, and it is unavoidable here
  const tParse = performance.now() - t0;
  const summary = summarise(data.rows);
  showSummary(summary);
  return `parse ${fmt.ms(tParse)}`;
}).then(() => {
  out.textContent =
    'One long task containing the JSON parse and the transform. The rAF spinner froze; your clicks\n' +
    'queued up and all fired at the end (that is an INP of the whole duration).\n\n' +
    'Note that response.json() is not chunkable — it is a single synchronous parse inside the\n' +
    'engine. You cannot yield inside it, which is exactly why this is the canonical worker use\n' +
    'case: the one operation you cannot break up.';
}));

// ---------------------------------------------------------------------------
// B. Chunked on the main thread — the alternative people reach for first
// ---------------------------------------------------------------------------

const yieldToBrowser = globalThis.scheduler?.yield
  ? () => scheduler.yield()
  : () => new Promise((r) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => { ch.port1.close(); r(); };
    ch.port2.postMessage(null);
  });

on('chunked', () => measure('B. chunked, main thread', async () => {
  const res = await fetch(url());
  const t0 = performance.now();
  const data = await res.json();          // still one unavoidable block
  const tParse = performance.now() - t0;

  // The transform CAN be chunked.
  const byTeam = new Map();
  let start = performance.now();
  for (let i = 0; i < data.rows.length; i++) {
    const row = data.rows[i];
    let b = byTeam.get(row.team);
    if (!b) byTeam.set(row.team, b = { team: row.team, n: 0, score: 0, active: 0, tags: new Set() });
    b.n++; b.score += row.score;
    if (row.active) b.active++;
    for (const t of row.tags) b.tags.add(t);
    if ((i & 8191) === 0 && performance.now() - start > 5) {
      await yieldToBrowser();
      start = performance.now();
    }
  }
  showSummary([...byTeam.values()]
    .map((b) => ({ team: b.team, n: b.n, avg: +(b.score / b.n).toFixed(2), active: b.active, tags: b.tags.size }))
    .sort((a, b) => b.avg - a.avg).slice(0, 12));
  return `parse ${fmt.ms(tParse)} (unchunkable)`;
}).then(() => {
  out.textContent =
    'Chunking fixed the transform and did nothing for the parse — look at the worst frame: it is\n' +
    'still roughly the length of JSON.parse().\n\n' +
    'This is the honest comparison people skip. Chunking is cheaper than a worker and often\n' +
    'enough. It is NOT enough when a single unbreakable operation (a big parse, a crypto call, a\n' +
    'regex over a huge string, an image decode) dominates.';
}));

// ---------------------------------------------------------------------------
// C. In a worker, fetching inside the worker
// ---------------------------------------------------------------------------

let worker = null;
function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    log.muted('worker spawned (this costs 10–50ms, once — reuse it)');
  }
  return worker;
}

function ask(w, message, transfer = []) {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2);
    const onMessage = (e) => {
      if (e.data.id !== id) return;                       // ← the reason lab 04 exists
      w.removeEventListener('message', onMessage);
      resolve(e.data);
    };
    w.addEventListener('message', onMessage);
    w.addEventListener('error', reject, { once: true });
    w.postMessage({ ...message, id }, transfer);
  });
}

on('worker', () => measure('C. worker (fetch inside)', async () => {
  const w = getWorker();
  const { summary, timings } = await ask(w, { url: url() });
  showSummary(summary);
  return `worker parse ${fmt.ms(timings.parse)}, transform ${fmt.ms(timings.transform)}`;
}).then(() => {
  out.textContent =
    'Same work, same wall time (or slightly worse), 60fps throughout, every click handled.\n\n' +
    'That is the trade, stated honestly: a worker rarely makes the job FASTER. It makes the page\n' +
    'RESPONSIVE while the job runs. Report both numbers or someone will correctly point out that\n' +
    'your optimisation did not reduce total time.\n\n' +
    'The design detail that matters: the fetch happens INSIDE the worker, so the JSON bytes never\n' +
    'touch the main thread. Compare with strategy D.';
}));

// ---------------------------------------------------------------------------
// D. Worker, but the main thread does the fetching — the common half-fix
// ---------------------------------------------------------------------------

on('workerNaive', () => measure('D. worker, main-thread fetch', async () => {
  const res = await fetch(url());
  const t0 = performance.now();
  const data = await res.json();             // ← parse still on the main thread!
  const tParse = performance.now() - t0;

  const w = getWorker();
  const t1 = performance.now();
  const { summary } = await ask(w, { rows: data.rows, url: null });
  const tRound = performance.now() - t1;
  showSummary(summary ?? []);
  return `main-thread parse ${fmt.ms(tParse)}, clone+round trip ${fmt.ms(tRound)}`;
}).then(() => {
  out.textContent =
    'The worst of both worlds, and an extremely common mistake:\n' +
    '  • the parse still happened on the main thread (the expensive part)\n' +
    '  • and then the whole 200,000-row array was STRUCTURED CLONED into the worker, which is\n' +
    '    another large synchronous cost on the main thread\n\n' +
    'Rule: move the DATA BOUNDARY, not just the loop. If the worker can fetch it, decode it, or\n' +
    'generate it, let it. The best message is a URL and a number, not a payload.\n\n' +
    '(This variant may also just fail — the worker expects a url. Check the console: a worker\n' +
    'error is silent from the page unless you listen for it, which is Lab 04\'s problem.)';
}));

on('reset', () => {
  rows.length = 0;
  renderTable('#results', rows);
  log.clear();
  clicks = 0;
  $('poke').textContent = 'poke me (0 handled)';
});
