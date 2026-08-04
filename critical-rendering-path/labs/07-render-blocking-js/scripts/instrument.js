// Loaded first, inline-ish and tiny, so it can observe everything that follows.
// Prints FP/FCP/LCP/DCL/long tasks and an execution-order log onto the page.
(function () {
  const log = [];
  const t0 = performance.now();

  window.LabLog = {
    note(msg) {
      log.push(`${(performance.now()).toFixed(0).padStart(6)}ms  ${msg}`);
      console.log(`[lab07] +${performance.now().toFixed(0)}ms ${msg}`);
      render();
    },
  };

  const metrics = {};

  function render() {
    const el = document.getElementById('lab-metrics');
    if (!el) return;
    const rows = Object.entries(metrics).map(([k, v]) => `  ${k.padEnd(22)} ${v}`);
    el.textContent =
      `metrics\n${rows.join('\n') || '  (waiting…)'}\n\nexecution order\n${log.join('\n')}`;
  }

  function set(name, value) { metrics[name] = value; render(); }

  try {
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) set(e.name, `${e.startTime.toFixed(0)}ms`);
    }).observe({ type: 'paint', buffered: true });

    new PerformanceObserver(list => {
      const last = list.getEntries().at(-1);
      set('largest-contentful-paint', `${last.startTime.toFixed(0)}ms  <${last.element?.tagName?.toLowerCase() ?? '?'}>`);
    }).observe({ type: 'largest-contentful-paint', buffered: true });

    let tbt = 0, count = 0, longest = 0;
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        count++;
        longest = Math.max(longest, e.duration);
        tbt += Math.max(0, e.duration - 50);
      }
      set('long tasks', `${count}  (longest ${longest.toFixed(0)}ms, blocking ${tbt.toFixed(0)}ms)`);
    }).observe({ type: 'longtask', buffered: true });
  } catch (err) {
    console.warn('[lab07] PerformanceObserver unavailable for some types', err);
  }

  addEventListener('DOMContentLoaded', () => {
    set('DOMContentLoaded', `${performance.now().toFixed(0)}ms`);
    render();
  });
  addEventListener('load', () => {
    set('load', `${performance.now().toFixed(0)}ms`);
    const nav = performance.getEntriesByType('navigation')[0];
    if (nav) set('navigation duration', `${nav.duration.toFixed(0)}ms`);
    // Per-script accounting: transfer size and duration for every JS resource.
    const scripts = performance.getEntriesByType('resource').filter(r => r.initiatorType === 'script');
    for (const s of scripts) {
      set(`↳ ${s.name.split('/').pop()}`, `${s.duration.toFixed(0)}ms, ${(s.transferSize / 1024).toFixed(1)}kB`);
    }
    render();
  });

  window.LabLog.note('instrument.js executed');
  console.log(`[lab07] instrument.js at +${(performance.now() - t0).toFixed(1)}ms`);
})();
