// Shared reporter for Lab 12's pages. Prints module execution span and resource stats.
(function () {
  function draw() {
    const el = document.getElementById('out');
    if (!el) return;
    const lab = globalThis.__lab12 || { order: [], firstAt: null, lastAt: null };
    const scripts = performance.getEntriesByType('resource')
      .filter(r => r.initiatorType === 'script' || r.name.endsWith('.js'));
    const transferred = scripts.reduce((a, r) => a + (r.transferSize || 0), 0);
    const decoded = scripts.reduce((a, r) => a + (r.decodedBodySize || 0), 0);
    const stalled = scripts.map(r => r.requestStart - r.startTime).filter(n => n >= 0);
    const maxStall = stalled.length ? Math.max(...stalled) : 0;
    const nav = performance.getEntriesByType('navigation')[0];

    // Detect out-of-order execution, which is the async/chain hazard made visible.
    const inOrder = lab.order.every((v, i) => i === 0 || v >= lab.order[i - 1]);

    el.textContent = [
      `modules executed:   ${lab.order.length}`,
      `first module at:    ${lab.firstAt ? lab.firstAt.toFixed(0) + 'ms' : '–'}`,
      `last module at:     ${lab.lastAt ? lab.lastAt.toFixed(0) + 'ms' : '–'}`,
      `execution span:     ${lab.firstAt && lab.lastAt ? (lab.lastAt - lab.firstAt).toFixed(0) + 'ms' : '–'}`,
      `executed in order:  ${inOrder ? 'yes' : 'NO — the delivery order won'}`,
      '',
      `JS requests:        ${scripts.length}`,
      `transferred:        ${(transferred / 1024).toFixed(0)} kB`,
      `uncompressed:       ${(decoded / 1024).toFixed(0)} kB` +
        (decoded ? `   (ratio ${(decoded / Math.max(1, transferred)).toFixed(2)}×)` : ''),
      `worst queue/stall:  ${maxStall.toFixed(0)}ms   ← the HTTP/1.1 connection limit shows up here`,
      '',
      nav ? `DOMContentLoaded:   ${nav.domContentLoadedEventEnd.toFixed(0)}ms` : '',
      nav ? `load:               ${nav.loadEventEnd ? nav.loadEventEnd.toFixed(0) + 'ms' : 'pending'}` : '',
      '',
      `protocol: ${nav?.nextHopProtocol || 'unknown'}   ` +
        `← if this says http/1.1, run the HTTP/2 comparison too`,
    ].filter(Boolean).join('\n');
  }

  globalThis.__lab12_report = draw;
  addEventListener('load', () => setTimeout(draw, 50));
  setInterval(draw, 1000);
  draw();
})();
