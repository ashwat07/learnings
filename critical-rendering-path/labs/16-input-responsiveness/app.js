// Lab 16 — Input responsiveness (INP).
//
// The four broken interactions are implemented. The four fixes are yours.
// The INP tracker below is real — it uses the same Event Timing grouping that the
// `web-vitals` library uses, so you can reconcile your numbers against it later.

PerfHUD.start();

const out = document.getElementById('out');
const rowsEl = document.getElementById('rows');
const inpTag = document.getElementById('inp-tag');
const tbtTag = document.getElementById('tbt-tag');

const ITEMS = Array.from({ length: 5000 }, (_, i) => ({
  id: i,
  label: `item-${i.toString(36)}-${(i * 7919) % 9973}`,
}));

// ---------------------------------------------------------------------------
// INP tracking, the real way.
//
// Several events share one `interactionId` (pointerdown, pointerup, click). The
// interaction's latency is the MAX duration across that group — not the sum, and not
// any single event.
// ---------------------------------------------------------------------------
const interactions = new Map();   // interactionId → { duration, inputDelay, processing, presentation, type, cardId }
let pendingCard = null;           // which demo card the user is currently touching

function trackInteraction(entry) {
  const id = entry.interactionId;
  const inputDelay = entry.processingStart - entry.startTime;
  const processing = entry.processingEnd - entry.processingStart;
  const presentation = entry.startTime + entry.duration - entry.processingEnd;
  const prev = interactions.get(id);

  // Attribute to a demo card via the event target, falling back to whatever the user
  // last touched (pointerup/click targets can differ from pointerdown's).
  const card = entry.target?.closest?.('.card') || pendingCard;
  const cardId = card?.dataset.id || prev?.cardId || null;

  if (!prev || entry.duration > prev.duration) {
    interactions.set(id, {
      duration: entry.duration,
      inputDelay, processing, presentation,
      type: entry.name,
      cardId,
    });
  } else if (cardId && !prev.cardId) {
    prev.cardId = cardId;
  }
  renderSplits();
}

try {
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) {
      if (!entry.interactionId) continue;    // not an interaction — e.g. a plain scroll or mousemove
      trackInteraction(entry);
    }
  }).observe({ type: 'event', durationThreshold: 0, buffered: true });
} catch (err) {
  out.textContent = 'Event Timing API unavailable in this browser — use Chrome for this lab.';
  console.warn('[lab16]', err);
}

/** INP as the spec defines it: ~p98, with one interaction excluded per 50. */
function computeINP() {
  const durations = [...interactions.values()].map(i => i.duration).sort((a, b) => b - a);
  if (!durations.length) return null;
  const allowance = Math.floor(interactions.size / 50);   // high-interaction allowance
  return durations[Math.min(allowance, durations.length - 1)];
}

let tbt = 0;
try {
  new PerformanceObserver(list => {
    for (const e of list.getEntries()) tbt += Math.max(0, e.duration - 50);
  }).observe({ type: 'longtask', buffered: true });
} catch { /* no longtask support */ }

function bar(i) {
  const total = Math.max(1, i.duration);
  const pct = v => `${Math.max(0, (v / total) * 100).toFixed(1)}%`;
  return `<div class="bar">` +
    `<i class="delay" style="width:${pct(i.inputDelay)}"></i>` +
    `<i class="proc" style="width:${pct(i.processing)}"></i>` +
    `<i class="pres" style="width:${pct(i.presentation)}"></i></div>`;
}

function renderSplits() {
  const worstByCard = new Map();
  for (const i of interactions.values()) {
    if (!i.cardId) continue;
    const prev = worstByCard.get(i.cardId);
    if (!prev || i.duration > prev.duration) worstByCard.set(i.cardId, i);
  }
  for (const card of document.querySelectorAll('.card')) {
    const i = worstByCard.get(card.dataset.id);
    const el = card.querySelector('[data-split]');
    if (!i) { el.innerHTML = ''; continue; }
    const dominant = i.inputDelay >= i.processing && i.inputDelay >= i.presentation ? 'input delay'
      : i.processing >= i.presentation ? 'processing' : 'presentation';
    el.innerHTML =
      `<span>worst</span><span>${i.duration.toFixed(0)}ms (${i.type})` +
      `${i.duration > 200 ? '  ← above the 200ms INP threshold' : ''}</span>` +
      `<span>input delay</span><span>${i.inputDelay.toFixed(0)}ms</span>` +
      `<span>processing</span><span>${i.processing.toFixed(0)}ms</span>` +
      `<span>presentation</span><span>${i.presentation.toFixed(0)}ms</span>` +
      `<span>dominant</span><span>${dominant}</span>` +
      `<span></span><span>${bar(i)}</span>`;
  }
  const inp = computeINP();
  inpTag.textContent = `INP ${inp == null ? '—' : inp.toFixed(0) + 'ms'} (${interactions.size} interactions)`;
  tbtTag.textContent = `TBT ${tbt.toFixed(0)}ms`;
}

// Remember which card the pointer went down on, for attribution.
document.addEventListener('pointerdown', e => { pendingCard = e.target.closest('.card'); }, true);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function block(ms) {
  const t = performance.now();
  let acc = 0;
  while (performance.now() - t < ms) acc += Math.sqrt(acc + 1) % 3;
  return acc;
}

function status(cardId, text) {
  document.querySelector(`.card[data-id="${cardId}"] [data-status]`).textContent = text;
}

/** Yield in a way that guarantees the browser PAINTED first. See the README hint —
 *  this is not the same as setTimeout(0) or scheduler.yield(). */
const yieldToPaint = () =>
  new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

/** Yield to the scheduler: stays interruptible, but does NOT wait for a paint. */
const yieldToMain = () =>
  globalThis.scheduler?.yield?.() ?? new Promise(r => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// 1. BROKEN — all the work, then the DOM update. Pure processing time.
// ---------------------------------------------------------------------------
function slowHandler() {
  status('slowHandler', 'working…');       // never painted: the thread never yields
  block(300);
  status('slowHandler', `done — ${new Date().toLocaleTimeString()}`);
}

// TODO — fixSlowHandler()
//   Step 1: feedback-first ordering. Update the DOM, await yieldToPaint(), THEN block(300).
//           Measure INP before/after. Same work; explain why the number moved.
//   Step 2: chunk the 300ms into ~5ms slices with yieldToMain() between them. Measure INP
//           AND wall-clock time to completion. You are trading one for the other — say which
//           matters here and why.
//   Then answer: which of the two steps did more for INP? Which did more for the user?
function fixSlowHandler() {
  throw new Error('TODO: fixSlowHandler() — feedback first, then yield to paint, then work');
}

// ---------------------------------------------------------------------------
// 2. BROKEN — the handler is 1ms. The problem is somewhere else entirely.
// ---------------------------------------------------------------------------
let busyTimer = null;
function startBusyJob() {
  busyTimer = setInterval(() => block(200), 250);   // saturates the main thread
}
function stopBusyJob() { clearInterval(busyTimer); busyTimer = null; }

function fastHandler() {
  block(1);
  status('busyThread', `handled at ${performance.now().toFixed(0)}ms — the handler took 1ms`);
}

// TODO — fixBusyThread()
//   Fix the BACKGROUND work, not the handler. Two implementations:
//     a) chunk the interval's 200ms into slices with yieldToMain() between them
//     b) move it into a Worker
//   Measure interaction 2's input delay for each. Then answer: which keeps input latency
//   lowest, and why is the worker not automatically the right answer?
function fixBusyThread() {
  throw new Error('TODO: fixBusyThread() — chunk or offload the BACKGROUND job');
}

// ---------------------------------------------------------------------------
// 3. BROKEN — a 2ms handler that commits 5,000 rows. Pure presentation delay.
// ---------------------------------------------------------------------------
function bigCommit() {
  const frag = document.createDocumentFragment();
  for (const item of ITEMS) {
    const row = document.createElement('div');
    row.textContent = `${item.id} · ${item.label} · ${'▇'.repeat(item.id % 12)}`;
    frag.appendChild(row);
  }
  rowsEl.textContent = '';
  rowsEl.appendChild(frag);
  status('bigCommit', `committed ${ITEMS.length} rows — the JS was fast, watch the frame`);
}

// TODO — fixBigCommit()
//   Two approaches, both measured:
//     a) commit only what's visible (~30 rows) — reuse your Lab 05 virtualization
//     b) keep all 5,000 but add content-visibility: auto + contain-intrinsic-size
//   Which wins, and by how much? Is (b) enough on its own?
function fixBigCommit() {
  throw new Error('TODO: fixBigCommit() — commit less, or let the browser skip the off-screen work');
}

// ---------------------------------------------------------------------------
// 4. BROKEN — 500ms debounce, then a synchronous filter + full re-render.
//    TBT will look excellent. Type a sentence and see how it feels.
// ---------------------------------------------------------------------------
let debounceTimer = null;
function debouncedSearch(e) {
  clearTimeout(debounceTimer);
  status('debouncedSearch', 'waiting 500ms after you stop typing…');
  const q = e.target.value.toLowerCase();
  debounceTimer = setTimeout(() => {
    const matches = ITEMS.filter(i => i.label.includes(q));
    block(60);                       // stand-in for real per-result work
    rowsEl.textContent = '';
    const frag = document.createDocumentFragment();
    for (const m of matches) {
      const row = document.createElement('div');
      row.textContent = `${m.id} · ${m.label}`;
      frag.appendChild(row);
    }
    rowsEl.appendChild(frag);
    status('debouncedSearch', `${matches.length} matches — and how long did that feel?`);
  }, 500);
}

// TODO — fixDebouncedSearch()
//   Requirements:
//     · the input's own value updates with ZERO added delay on every keystroke
//     · results may lag, but must feel responsive (aim: first results within ~100ms)
//     · cap the rendered result set; do not commit thousands of rows
//   Implement twice — rAF-coalesced with a capped render, and with the filter in a Worker —
//   then compare FELT latency, not just the metric. Note where INP and feel disagree.
function fixDebouncedSearch(e) {
  throw new Error('TODO: fixDebouncedSearch() — instant input, lagging-but-fast results');
}

// ---------------------------------------------------------------------------
// wiring
// ---------------------------------------------------------------------------
const actions = {
  slowHandler, fixSlowHandler,
  fastHandler, fixBusyThread,
  bigCommit, fixBigCommit,
  clearRows: () => { rowsEl.textContent = ''; status('bigCommit', 'cleared'); },
  debouncedSearch, fixDebouncedSearch,
};

document.addEventListener('click', e => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action || !(action in actions) || e.target.tagName === 'INPUT') return;
  try { actions[action](e); } catch (err) {
    status(e.target.closest('.card').dataset.id, err.message);
    console.warn(err);
  }
});

document.addEventListener('input', e => {
  const action = e.target.dataset.action;
  if (!action || !(action in actions)) return;
  try { actions[action](e); } catch (err) {
    status('debouncedSearch', err.message);
    console.warn(err);
  }
});

document.getElementById('toggle-busy').addEventListener('click', e => {
  if (busyTimer) {
    stopBusyJob();
    e.target.setAttribute('aria-pressed', 'false');
    e.target.textContent = 'start background job';
    status('busyThread', 'background job stopped');
  } else {
    startBusyJob();
    e.target.setAttribute('aria-pressed', 'true');
    e.target.textContent = 'stop background job';
    status('busyThread', 'background job running — now click "click me" and read the input delay');
  }
});

// The propagation-path experiment: three slow listeners you don't own.
let extraAbort = null;
document.getElementById('extra-listeners').addEventListener('change', e => {
  if (!e.target.checked) {
    extraAbort?.abort();
    extraAbort = null;
    out.textContent = 'extra document listeners removed';
    return;
  }
  extraAbort = new AbortController();
  for (let i = 0; i < 3; i++) {
    document.addEventListener('click', () => block(20), { signal: extraAbort.signal });
  }
  out.textContent =
    'Three 20ms listeners now sit on `document`. Nothing about the buttons changed.\n' +
    'Re-click interaction 1 and 2 and watch PROCESSING time grow by ~60ms.\n' +
    'This is what a third-party analytics script does to your INP.';
});

document.getElementById('reset').addEventListener('click', () => {
  interactions.clear();
  tbt = 0;
  PerfHUD.reset();
  renderSplits();
  out.textContent = 'measurements reset';
});

renderSplits();
out.textContent =
  'Throttle CPU to 4×, then work through the four interactions in order.\n' +
  'For each one, read which colour dominates BEFORE you decide on a fix — ' +
  'three of the four possible fixes cannot help, and knowing which is the skill.';
