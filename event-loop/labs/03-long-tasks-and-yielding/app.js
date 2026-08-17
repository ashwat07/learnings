// Lab 03 — Long tasks & yielding.
//
// The app works. The app is also unusable on a mid-range phone. Fix INP without changing
// what the user sees.

import { $, on, Log, fmt, busy } from '/shared/lab-ui.js';

PerfHUD.start({ note: 'watch long tasks\nwhile you type' });

const log = new Log('#log');

// ---------------------------------------------------------------------------
// INP measurement
//
// An 'event' timing entry gives you all three phases:
//
//   input delay  = processingStart - startTime      main thread was busy; you weren't even called
//   processing   = processingEnd - processingStart   your handler
//   presentation = (startTime + duration) - processingEnd   style/layout/paint of the result
//
// Knowing which phase dominates tells you which fix to reach for. Fixing the wrong phase is
// the most common way teams "optimise" INP and move the number by 3%.
// ---------------------------------------------------------------------------

const worst = { inp: 0, delay: 0, proc: 0, present: 0 };

function renderCards() {
  $('inp').textContent = worst.inp ? fmt.ms(worst.inp) : '–';
  $('delay').textContent = worst.delay ? fmt.ms(worst.delay) : '–';
  $('proc').textContent = worst.proc ? fmt.ms(worst.proc) : '–';
  $('present').textContent = worst.present ? fmt.ms(worst.present) : '–';
  $('inp').className = 'big ' + (worst.inp > 500 ? 'no' : worst.inp > 200 ? 'meh' : 'ok');
}

try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (!e.interactionId) continue;               // not a real user interaction
      const delay = e.processingStart - e.startTime;
      const proc = e.processingEnd - e.processingStart;
      const present = e.startTime + e.duration - e.processingEnd;

      worst.inp = Math.max(worst.inp, e.duration);
      worst.delay = Math.max(worst.delay, delay);
      worst.proc = Math.max(worst.proc, proc);
      worst.present = Math.max(worst.present, present);
      renderCards();

      log.line(
        `${e.name.padEnd(9)} total ${fmt.ms(e.duration).padStart(7)}  ` +
        `= delay ${fmt.ms(delay).padStart(7)} + processing ${fmt.ms(proc).padStart(7)} + present ${fmt.ms(present).padStart(7)}`,
        e.duration > 200 ? 'bad' : 'good');
    }
  }).observe({ type: 'event', durationThreshold: 16, buffered: true });
} catch {
  log.bad('Event Timing API not supported here — use Chrome for this lab.');
}

try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) log.muted(`long task ${fmt.ms(e.duration)} (${e.name})`);
  }).observe({ type: 'longtask', buffered: true });
} catch { /* no longtask support */ }

// ---------------------------------------------------------------------------
// The data + the expensive filter
// ---------------------------------------------------------------------------

let items = [];

function build(n) {
  const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel',
    'india', 'juliet', 'kilo', 'lima', 'mike', 'november', 'oscar', 'papa'];
  items = new Array(n);
  for (let i = 0; i < n; i++) {
    items[i] = {
      id: i,
      label: `${WORDS[i % WORDS.length]}-${WORDS[(i * 7) % WORDS.length]}-${i.toString(36)}`,
      score: (i * 2654435761) % 1000,
    };
  }
  log.muted(`built ${n} rows`);
}

/**
 * Deliberately expensive: normalises and scores every row. This is a stand-in for the real
 * thing you'll meet at work — fuzzy matching, i18n collation, a date parse per row.
 */
function score(item, q) {
  const hay = item.label.toLowerCase().normalize('NFC');
  const idx = hay.indexOf(q);
  if (idx === -1) return -1;
  return 1000 - idx * 10 - hay.length + (item.score % 7);
}

function filterAll(q) {
  const needle = q.toLowerCase().normalize('NFC');
  const hits = [];
  for (const item of items) {
    const s = score(item, needle);
    if (s >= 0) hits.push({ item, s });
  }
  hits.sort((a, b) => b.s - a.s);
  return hits;
}

const listEl = $('list');

function renderList(hits, q) {
  const frag = document.createDocumentFragment();
  for (const { item } of hits.slice(0, 200)) {
    const row = document.createElement('div');
    const i = item.label.toLowerCase().indexOf(q.toLowerCase());
    if (q && i >= 0) {
      row.append(item.label.slice(0, i));
      const m = document.createElement('mark');
      m.textContent = item.label.slice(i, i + q.length);
      row.append(m, item.label.slice(i + q.length));
    } else {
      row.textContent = item.label;
    }
    frag.append(row);
  }
  listEl.textContent = '';
  listEl.append(frag);
  if (!hits.length) listEl.textContent = 'no matches';
}

// ---------------------------------------------------------------------------
// A. NAIVE — everything, synchronously, in the input handler.
// ---------------------------------------------------------------------------

function naive(q) {
  const hits = filterAll(q);
  renderList(hits, q);
}

// ---------------------------------------------------------------------------
// B. TODO — debounced.
//
// The cheapest fix and usually the right first move. But note what it does NOT fix:
// the interaction that finally runs is still one long task. Debouncing improves the
// *number* of long tasks, not the length of the worst one — so it moves INP less than
// you expect. Measure it and see.
// ---------------------------------------------------------------------------

function debounced(q) {
  throw new Error('TODO: implement debounced() — see the README');
}

// ---------------------------------------------------------------------------
// C. TODO — chunked with yielding.
//
// Break filterAll() into time-sliced chunks that yield to the browser, and make a newer
// keystroke cancel the in-flight run. Requirements:
//   - no task longer than ~10ms at 4× CPU throttle
//   - results identical to naive()
//   - typing fast must not queue up N full scans
// ---------------------------------------------------------------------------

function chunked(q) {
  throw new Error('TODO: implement chunked() — see the README');
}

// ---------------------------------------------------------------------------
// D. TODO — paint first, then work.
//
// The trick that fixes *presentation delay*: show the user the cheap feedback (the typed
// character, a spinner, the disabled button) and let the browser paint BEFORE you start the
// expensive part. The interaction ends at that first paint, so INP is measured against the
// cheap update, not the expensive one.
//
// Careful: this is only honest if the cheap update is genuinely meaningful feedback. Painting
// a spinner and then freezing for 400ms is a better INP score and the same bad experience.
// ---------------------------------------------------------------------------

function paintFirst(q) {
  throw new Error('TODO: implement paintFirst() — see the README');
}

// ---------------------------------------------------------------------------

const modes = { naive, debounced, chunked, paintFirst };

on($('q'), 'input', (e) => {
  const mode = $('mode').value;
  try {
    modes[mode](e.target.value);
  } catch (err) {
    listEl.textContent = err.message;
  }
});

// A second, unrelated interaction. Its latency is pure INPUT DELAY caused by whatever else
// is hogging the thread — which is the phase people forget exists.
let clicks = 0;
on('count', () => {
  clicks++;
  $('count').textContent = `counter: ${clicks}`;
});

let pressureTimer = null;
on($('pressure'), 'change', (e) => {
  clearInterval(pressureTimer);
  if (e.target.checked) {
    pressureTimer = setInterval(() => busy(200), 400);
    log.bad('background pressure ON — a 200ms task every 400ms, like an analytics beacon or a poll');
  } else {
    log.ok('background pressure off');
  }
});

on('rebuild', () => build(Number($('rows').value)));
on('reset', () => {
  worst.inp = worst.delay = worst.proc = worst.present = 0;
  renderCards();
  log.clear();
});

build(Number($('rows').value));
renderCards();
