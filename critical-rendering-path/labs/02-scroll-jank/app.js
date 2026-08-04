// Lab 02 — Scroll jank.
// `broken` is implemented. Strategies 2–5 are yours.

PerfHUD.start({ countReflows: true });

const list = document.getElementById('list');
const out = document.getElementById('out');
const strategySelect = document.getElementById('strategy');
const passiveBox = document.getElementById('passive');
const blockerBox = document.getElementById('blocker');

let rows = [];
let detach = () => {};          // teardown for whichever strategy is active
let eventCount = 0;
let updateCount = 0;            // how many times we touched the DOM

function build(n) {
  list.textContent = '';
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) {
    const row = document.createElement('div');
    row.className = 'row';
    frag.appendChild(row);
  }
  list.appendChild(frag);
  rows = [...list.children];
  report(`built ${n} rows`);
}

function report(extra = '') {
  out.textContent =
    `events handled: ${eventCount}   DOM update passes: ${updateCount}   ` +
    `geometry reads: ${PerfHUD.stats.reflowReads}\n${extra}`;
}
setInterval(() => report(), 500);

function listen(type, handler) {
  const opts = { passive: passiveBox.checked };
  window.addEventListener(type, handler, opts);
  return () => window.removeEventListener(type, handler, opts);
}

// ---------------------------------------------------------------------------
// 1. BROKEN — width write for every row, on every scroll event, no coalescing.
// ---------------------------------------------------------------------------
function broken() {
  return listen('scroll', () => {
    eventCount++;
    updateCount++;
    const y = window.scrollY;                 // layout-dependent read
    rows.forEach(row => {
      row.style.width = 60 + (y % 300) + 'px'; // layout property write
    });
  });
}

// ---------------------------------------------------------------------------
// 2. TODO — rAF-coalesced.
//    Same width write, but at most one pass per frame. Read scrollY once per event,
//    stash it, and let a single rAF callback do the writing.
//    Predict the improvement BEFORE you measure. Then measure. Were you right?
// ---------------------------------------------------------------------------
function rafCoalesced() {
  throw new Error('TODO: rafCoalesced() — coalesce writes into one rAF per frame');
}

// ---------------------------------------------------------------------------
// 3. TODO — transform only.
//    Same coalescing, but write `transform: scaleX(...)` (or translateX) instead of width.
//    Which trace entry vanished? Write the answer in a comment.
// ---------------------------------------------------------------------------
function transformOnly() {
  throw new Error('TODO: transformOnly() — composite-friendly property, still coalesced');
}

// ---------------------------------------------------------------------------
// 4. TODO — visible rows only.
//    Maintain a Set of rows currently intersecting the viewport with IntersectionObserver,
//    and only update those. Do NOT call getBoundingClientRect in the scroll handler.
//    Remember to disconnect the observer in your teardown.
// ---------------------------------------------------------------------------
function visibleOnly() {
  throw new Error('TODO: visibleOnly() — IntersectionObserver + transform, visible rows only');
}

// ---------------------------------------------------------------------------
// 5. TODO — no JS at all.
//    Drive the effect from CSS with a scroll-progress timeline. Add a class here and put
//    the @keyframes + animation-timeline: scroll() in index.html's <style>.
//    Feature-detect with CSS.supports('animation-timeline', 'scroll()') and report if
//    the browser can't do it.
// ---------------------------------------------------------------------------
function cssOnly() {
  throw new Error('TODO: cssOnly() — scroll-driven CSS animation, zero scroll handlers');
}

// ---------------------------------------------------------------------------

const strategies = { broken, raf: rafCoalesced, transform: transformOnly, visible: visibleOnly, css: cssOnly };

function activate(name) {
  detach();
  detach = () => {};
  eventCount = updateCount = 0;
  PerfHUD.reset();
  rows.forEach(r => { r.style.cssText = ''; r.classList.remove('scroll-driven'); });
  if (name === 'off') return report('no strategy active');
  try {
    detach = strategies[name]() || (() => {});
    report(`strategy: ${name}`);
  } catch (err) {
    report(`strategy: ${name}\n  ${err.message}`);
    console.warn(err);
  }
}

// A main-thread blocker, so you can prove which strategies survive a busy main thread.
let blockerTimer = null;
blockerBox.addEventListener('change', () => {
  clearInterval(blockerTimer);
  if (!blockerBox.checked) return;
  blockerTimer = setInterval(() => {
    const t = performance.now();
    while (performance.now() - t < 500) { /* deliberately blocking */ }
  }, 3000);
});

strategySelect.addEventListener('change', () => activate(strategySelect.value));
passiveBox.addEventListener('change', () => activate(strategySelect.value));
document.getElementById('rebuild').addEventListener('click', () => {
  build(+document.getElementById('count').value);
  activate(strategySelect.value);
});
document.getElementById('reset').addEventListener('click', () => {
  PerfHUD.reset(); eventCount = updateCount = 0; report('reset');
});

build(+document.getElementById('count').value);
activate('broken');
