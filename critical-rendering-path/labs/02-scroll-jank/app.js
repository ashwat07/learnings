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

// Same visual range the `width` version produced: 60px → 360px.
const scaleFor = y => (60 + (y % 300)) / 60;

// ---------------------------------------------------------------------------
// 2. rAF-coalesced — same width write, at most one pass per frame.
//    MEASURED: no improvement. `scroll` on the window is dispatched by the browser
//    during the frame's rendering steps, so it already fires at most once per frame —
//    there was never a duplicate pass inside a frame for the latch to suppress.
//    `events handled` ≈ `DOM update passes` is the proof.
// ---------------------------------------------------------------------------
function rafCoalesced() {
  let scheduled = false, y = 0, rafId = 0;
  const stop = listen('scroll', () => {
    eventCount++;
    y = window.scrollY;                        // read every event, latest wins
    if (scheduled) return;
    scheduled = true;
    rafId = requestAnimationFrame(() => {
      scheduled = false;
      updateCount++;
      rows.forEach(row => {
        row.style.width = 60 + (y % 300) + 'px'; // layout property write
      });
    });
  });
  return () => { stop(); cancelAnimationFrame(rafId); };
}

// ---------------------------------------------------------------------------
// 3. transform only — same coalescing, composited property.
//    WHICH ENTRY VANISHED: Layout. `transform` is not a layout property, so the write
//    dirties the paint/property trees but never invalidates geometry. Paint drops hard
//    too (the rasterized content is unchanged; only its transform node moves).
//    Recalculate style STAYS — we still set an inline style on all 10,000 rows, so
//    10,000 elements still get their computed style rebuilt. That's what step 4 fixes.
// ---------------------------------------------------------------------------
function transformOnly() {
  let scheduled = false, y = 0, rafId = 0;
  const stop = listen('scroll', () => {
    eventCount++;
    y = window.scrollY;
    if (scheduled) return;
    scheduled = true;
    rafId = requestAnimationFrame(() => {
      scheduled = false;
      updateCount++;
      const scale = scaleFor(y);
      rows.forEach(row => {
        row.style.transform = `scaleX(${scale})`;
      });
    });
  });
  return () => { stop(); cancelAnimationFrame(rafId); };
}

// ---------------------------------------------------------------------------
// 4. visible rows only — transform, coalesced, ~40 elements instead of 10,000.
//    IntersectionObserver computes intersections off the main thread and hands us the
//    result in a callback, so "which rows are visible" costs nothing per frame.
//    getBoundingClientRect() here would force a layout per row per event — that's
//    Lab 01 rebuilt inside Lab 02's handler.
// ---------------------------------------------------------------------------
function visibleOnly() {
  const visible = new Set();
  let scheduled = false, y = 0, rafId = 0;

  // rootMargin gives a buffer band above/below the viewport, so a row is already in
  // the Set (and already written) before it scrolls into view — no flash of a stale
  // transform on the way in.
  const io = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) visible.add(entry.target);
      else visible.delete(entry.target);
    }
  }, { rootMargin: '200px 0px' });

  rows.forEach(row => io.observe(row));

  const stop = listen('scroll', () => {
    eventCount++;
    y = window.scrollY;
    if (scheduled) return;
    scheduled = true;
    rafId = requestAnimationFrame(() => {
      scheduled = false;
      updateCount++;
      const scale = scaleFor(y);
      visible.forEach(row => {
        row.style.transform = `scaleX(${scale})`;
      });
    });
  });

  return () => {
    stop();
    cancelAnimationFrame(rafId);
    io.disconnect();
    visible.clear();
  };
}

// ---------------------------------------------------------------------------
// 5. cssOnly — no scroll listener, no rAF, no per-frame main-thread work at all.
//    The @keyframes + `animation-timeline: scroll()` live in index.html's <style>.
//    `events handled` and `DOM update passes` should both stay at 0.
// ---------------------------------------------------------------------------
function cssOnly() {
  if (!CSS.supports('animation-timeline', 'scroll()')) {
    // activate()'s catch reports this in the readout.
    throw new Error('no animation-timeline: scroll() support in this browser');
  }
  // Class name must match what activate() strips on teardown.
  rows.forEach(row => row.classList.add('scroll-driven'));
  return () => rows.forEach(row => row.classList.remove('scroll-driven'));
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
