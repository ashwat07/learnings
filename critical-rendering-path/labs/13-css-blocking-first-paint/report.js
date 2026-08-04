// Shared reporter for Lab 13. Prints paint timings and stylesheet accounting.
(function () {
  const metrics = {};
  function set(k, v) { metrics[k] = v; draw(); }

  try {
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) set(e.name, `${e.startTime.toFixed(0)}ms`);
    }).observe({ type: 'paint', buffered: true });
    new PerformanceObserver(list => {
      const last = list.getEntries().at(-1);
      set('largest-contentful-paint', `${last.startTime.toFixed(0)}ms`);
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    let cls = 0;
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) cls += e.value;
      set('cumulative-layout-shift', cls.toFixed(4) + (cls > 0.1 ? '  ← FAILING' : ''));
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (err) { console.warn('[lab13]', err); }

  function draw() {
    const el = document.getElementById('out');
    if (!el) return;
    const css = performance.getEntriesByType('resource').filter(r => r.name.endsWith('.css'));
    const fonts = performance.getEntriesByType('resource')
      .filter(r => /\.(woff2?|ttf|otf)$/i.test(r.name));
    const bytes = css.reduce((a, r) => a + (r.transferSize || 0), 0);
    const slowest = css.reduce((a, r) => (r.responseEnd > (a?.responseEnd ?? 0) ? r : a), null);
    const nav = performance.getEntriesByType('navigation')[0];

    el.textContent = [
      ...Object.entries(metrics).map(([k, v]) => `${k.padEnd(26)} ${v}`),
      nav ? `${'DOMContentLoaded'.padEnd(26)} ${nav.domContentLoadedEventEnd.toFixed(0)}ms` : '',
      '',
      `stylesheets:            ${css.length}`,
      `CSS transferred:        ${(bytes / 1024).toFixed(0)} kB`,
      slowest ? `slowest stylesheet:     ${slowest.name.split('/').pop()} finished at ` +
        `${slowest.responseEnd.toFixed(0)}ms  ← your FCP floor` : '',
      `font requests:          ${fonts.length}` +
        (fonts.length ? ` (last finished ${Math.max(...fonts.map(f => f.responseEnd)).toFixed(0)}ms)` : ''),
      `document.fonts.status:  ${document.fonts?.status ?? 'n/a'}`,
      '',
      `protocol: ${nav?.nextHopProtocol || 'unknown'}`,
      '',
      'Now open Coverage (⌘⇧P → Show Coverage) and reload. How much of that CSS was used?',
    ].filter(Boolean).join('\n');
  }

  addEventListener('load', () => setTimeout(draw, 100));
  document.fonts?.ready.then(() => { set('fonts ready', `${performance.now().toFixed(0)}ms`); });
  setInterval(draw, 1000);
  draw();
})();
