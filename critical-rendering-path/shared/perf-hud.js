/**
 * perf-hud.js — a live performance overlay for the labs.
 *
 * Shows: FPS, worst frame time in the last second, long-task count, and a count of
 * layout-forcing property reads (opt-in, see below).
 *
 * Use it for fast iteration. Use the Performance panel for the real answer — the HUD itself
 * costs a little main-thread time, and its reflow counter only sees reads that go through the
 * patched getters.
 *
 * Usage:
 *   <script src="../../shared/perf-hud.js"></script>
 *   PerfHUD.start();                       // FPS + long tasks
 *   PerfHUD.start({ countReflows: true }); // also patch geometry getters and count reads
 *   PerfHUD.mark('render 100k rows', fn);  // time a block, print to HUD + console
 */
(function () {
  const state = {
    frames: 0,
    fps: 0,
    worst: 0,
    worstEver: 0,
    longTasks: 0,
    longestTask: 0,
    reflowReads: 0,
    warmup: 5,
    running: false,
  };

  let el, rows;

  function ui() {
    el = document.createElement('div');
    el.id = 'perf-hud';
    el.innerHTML = `
      <div class="hud-title">PERF <button type="button" data-reset>reset</button></div>
      <div class="hud-grid">
        <span>FPS</span><b data-fps>–</b>
        <span>worst frame (1s)</span><b data-worst>–</b>
        <span>worst frame (ever)</span><b data-worst-ever>–</b>
        <span>long tasks &gt;50ms</span><b data-tasks>0</b>
        <span>longest task</span><b data-longest>–</b>
        <span class="hud-reflow-row">geometry reads</span><b data-reflows class="hud-reflow-row">off</b>
      </div>
      <div class="hud-note" data-note></div>`;
    Object.assign(el.style, {
      position: 'fixed', top: '8px', right: '8px', zIndex: 2147483647,
      font: '11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace',
      background: 'rgba(10,10,14,.92)', color: '#e8e8ef',
      padding: '8px 10px', borderRadius: '8px', minWidth: '190px',
      border: '1px solid rgba(255,255,255,.14)', pointerEvents: 'auto',
      boxShadow: '0 6px 24px rgba(0,0,0,.4)', backdropFilter: 'none',
    });
    const style = document.createElement('style');
    style.textContent = `
      #perf-hud .hud-title{display:flex;justify-content:space-between;align-items:center;
        letter-spacing:.12em;opacity:.6;margin-bottom:6px;font-size:10px}
      #perf-hud .hud-title button{font:inherit;background:transparent;color:inherit;
        border:1px solid rgba(255,255,255,.25);border-radius:4px;padding:0 4px;cursor:pointer;opacity:.8}
      #perf-hud .hud-grid{display:grid;grid-template-columns:1fr auto;gap:2px 10px}
      #perf-hud .hud-grid span{opacity:.65}
      #perf-hud .hud-grid b{font-variant-numeric:tabular-nums;text-align:right}
      #perf-hud .hud-note{margin-top:6px;opacity:.65;max-width:200px;white-space:pre-wrap}
      #perf-hud b.bad{color:#ff6b6b}
      #perf-hud b.warn{color:#ffd166}
      #perf-hud b.good{color:#6ee7a8}
      #perf-hud .hud-reflow-row.off{display:none}`;
    document.head.appendChild(style);
    document.body.appendChild(el);
    rows = {
      fps: el.querySelector('[data-fps]'),
      worst: el.querySelector('[data-worst]'),
      worstEver: el.querySelector('[data-worst-ever]'),
      tasks: el.querySelector('[data-tasks]'),
      longest: el.querySelector('[data-longest]'),
      reflows: el.querySelector('[data-reflows]'),
      note: el.querySelector('[data-note]'),
    };
    el.querySelector('[data-reset]').addEventListener('click', reset);
  }

  function grade(node, value, warnAt, badAt, invert) {
    node.classList.remove('bad', 'warn', 'good');
    const bad = invert ? value < badAt : value > badAt;
    const warn = invert ? value < warnAt : value > warnAt;
    node.classList.add(bad ? 'bad' : warn ? 'warn' : 'good');
  }

  function reset() {
    state.worst = state.worstEver = state.longTasks = state.longestTask = state.reflowReads = 0;
    state.warmup = 5;
  }

  let last = 0, secondStart = 0;

  function tick(now) {
    if (!state.running) return;
    if (last) {
      const dt = now - last;
      if (state.warmup > 0) state.warmup--;
      else {
        state.worst = Math.max(state.worst, dt);
        state.worstEver = Math.max(state.worstEver, dt);
      }
      state.frames++;
    }
    last = now;
    if (now - secondStart >= 1000) {
      state.fps = Math.round((state.frames * 1000) / (now - secondStart));
      render();
      state.frames = 0;
      state.worst = 0;
      secondStart = now;
    }
    requestAnimationFrame(tick);
  }

  function render() {
    rows.fps.textContent = state.fps;
    grade(rows.fps, state.fps, 55, 40, true);
    rows.worst.textContent = state.worst.toFixed(1) + 'ms';
    grade(rows.worst, state.worst, 17, 50);
    rows.worstEver.textContent = state.worstEver.toFixed(1) + 'ms';
    grade(rows.worstEver, state.worstEver, 17, 50);
    rows.tasks.textContent = state.longTasks;
    grade(rows.tasks, state.longTasks, 0, 5);
    rows.longest.textContent = state.longestTask ? state.longestTask.toFixed(0) + 'ms' : '–';
    grade(rows.longest, state.longestTask, 50, 200);
    if (rows.reflows.dataset.on) {
      rows.reflows.textContent = state.reflowReads;
      grade(rows.reflows, state.reflowReads, 10, 100);
    }
  }

  /**
   * Count reads of layout-dependent properties. This does NOT prove a forced layout happened
   * (the browser only flushes when the tree is actually dirty) — it counts *candidates*.
   * A read count of 10,000 during one interaction is a smell regardless.
   */
  const GEOMETRY_PROPS = [
    ['Element', 'clientWidth'], ['Element', 'clientHeight'],
    ['Element', 'clientTop'], ['Element', 'clientLeft'],
    ['Element', 'scrollWidth'], ['Element', 'scrollHeight'],
    ['Element', 'scrollTop'], ['Element', 'scrollLeft'],
    ['HTMLElement', 'offsetWidth'], ['HTMLElement', 'offsetHeight'],
    ['HTMLElement', 'offsetTop'], ['HTMLElement', 'offsetLeft'],
    ['HTMLElement', 'offsetParent'],
  ];
  const GEOMETRY_METHODS = [
    ['Element', 'getBoundingClientRect'], ['Element', 'getClientRects'],
    ['Element', 'scrollIntoView'],
  ];

  function patchReads() {
    const byProp = new Map();
    for (const [ctor, prop] of GEOMETRY_PROPS) {
      const C = window[ctor];
      if (!C) continue;
      const desc = Object.getOwnPropertyDescriptor(C.prototype, prop);
      if (!desc || !desc.get) continue;
      Object.defineProperty(C.prototype, prop, {
        ...desc,
        get() { state.reflowReads++; byProp.set(prop, (byProp.get(prop) || 0) + 1); return desc.get.call(this); },
      });
    }
    for (const [ctor, method] of GEOMETRY_METHODS) {
      const C = window[ctor];
      if (!C || typeof C.prototype[method] !== 'function') continue;
      const orig = C.prototype[method];
      C.prototype[method] = function (...args) {
        state.reflowReads++;
        byProp.set(method, (byProp.get(method) || 0) + 1);
        return orig.apply(this, args);
      };
    }
    const origComputed = window.getComputedStyle;
    window.getComputedStyle = function (...args) {
      state.reflowReads++;
      byProp.set('getComputedStyle', (byProp.get('getComputedStyle') || 0) + 1);
      return origComputed.apply(this, args);
    };
    PerfHUD.breakdown = () => Object.fromEntries([...byProp].sort((a, b) => b[1] - a[1]));
    rows.reflows.dataset.on = '1';
    el.querySelectorAll('.hud-reflow-row').forEach(n => n.classList.remove('off'));
  }

  const PerfHUD = {
    start(opts = {}) {
      if (state.running) return PerfHUD;
      const boot = () => {
        ui();
        if (!opts.countReflows) el.querySelectorAll('.hud-reflow-row').forEach(n => n.classList.add('off'));
        state.running = true;
        secondStart = performance.now();
        requestAnimationFrame(tick);
        if (opts.countReflows) patchReads();
        if (opts.note) PerfHUD.note(opts.note);
        try {
          new PerformanceObserver(list => {
            for (const e of list.getEntries()) {
              state.longTasks++;
              state.longestTask = Math.max(state.longestTask, e.duration);
            }
          }).observe({ type: 'longtask', buffered: true });
        } catch { /* Safari/Firefox: no longtask observer */ }
      };
      if (document.body) boot();
      else document.addEventListener('DOMContentLoaded', boot, { once: true });
      return PerfHUD;
    },

    note(text) {
      const set = () => { if (rows) rows.note.textContent = text; };
      if (rows) set(); else document.addEventListener('DOMContentLoaded', set, { once: true });
      return PerfHUD;
    },

    reset,

    /** Time a synchronous block. Returns its return value. */
    mark(label, fn) {
      const a = `${label}:start`, b = `${label}:end`;
      performance.mark(a);
      const out = fn();
      performance.mark(b);
      const m = performance.measure(label, a, b);
      console.log(`⏱ ${label}: ${m.duration.toFixed(1)}ms`);
      PerfHUD.note(`${label}\n${m.duration.toFixed(1)}ms (JS only)`);
      return out;
    },

    /**
     * Time a block through to the frame it actually paints in. Use this whenever the JS is
     * fast but the layout/paint it causes is not (Lab 05).
     */
    markToPaint(label, fn) {
      return new Promise(resolve => {
        const t0 = performance.now();
        performance.mark(`${label}:start`);
        fn();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const dt = performance.now() - t0;
          performance.mark(`${label}:end`);
          performance.measure(`${label} (to paint)`, `${label}:start`, `${label}:end`);
          console.log(`⏱ ${label} to paint: ${dt.toFixed(1)}ms`);
          PerfHUD.note(`${label}\n${dt.toFixed(1)}ms (to paint)`);
          resolve(dt);
        }));
      });
    },

    get stats() { return { ...state }; },
  };

  window.PerfHUD = PerfHUD;
})();
