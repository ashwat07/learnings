/**
 * measure.js — the scoreboard every rendering lab uses.
 *
 * Shows the six numbers that decide a rendering-strategy argument, in a fixed corner box:
 *
 *   TTFB   how long the server made the browser wait for the first byte
 *   FCP    first contentful paint — was there anything to paint without JS?
 *   LCP    largest contentful paint — the metric users feel
 *   DCL    DOMContentLoaded
 *   TBT    total blocking time (sum of long-task time over 50ms) — hydration shows up here
 *   JS     bytes of JavaScript transferred, and how long it was executing
 *
 * Deliberately a classic script, not a module: it must start measuring before any module has
 * been fetched, and `type=module` is deferred.
 */
(function () {
  const m = {
    ttfb: null, fcp: null, lcp: null, lcpElement: null, dcl: null, load: null,
    tbt: 0, longTasks: 0, jsBytes: 0, jsEval: 0, cls: 0, inp: null,
    slots: [], hydration: null, islands: 0,
  };

  const box = () => document.getElementById('perf');

  function observe(type, cb, extra = {}) {
    try {
      new PerformanceObserver((l) => { l.getEntries().forEach(cb); render(); })
        .observe({ type, buffered: true, ...extra });
    } catch { /* not supported */ }
  }

  observe('paint', (e) => { if (e.name === 'first-contentful-paint') m.fcp = e.startTime; });
  observe('largest-contentful-paint', (e) => { m.lcp = e.startTime; m.lcpElement = e.element?.tagName; });
  observe('layout-shift', (e) => { if (!e.hadRecentInput) m.cls += e.value; });
  observe('longtask', (e) => { m.longTasks++; m.tbt += Math.max(0, e.duration - 50); });
  observe('event', (e) => {
    if (e.interactionId) m.inp = Math.max(m.inp ?? 0, e.duration);
  }, { durationThreshold: 16 });
  observe('resource', (e) => {
    if (e.initiatorType === 'script' || /\.m?js(\?|$)/.test(e.name)) {
      m.jsBytes += e.transferSize || e.encodedBodySize || 0;
    }
  });
  observe('mark', (e) => {
    if (e.name.startsWith('slot:')) m.slots.push({ name: e.name.slice(5), at: e.startTime });
    if (e.name === 'hydration:end') m.hydration = e.startTime;
    if (e.name === 'island:hydrated') m.islands++;
  });

  addEventListener('DOMContentLoaded', () => {
    const nav = performance.getEntriesByType('navigation')[0];
    if (nav) { m.ttfb = nav.responseStart; m.dcl = nav.domContentLoadedEventEnd; }
    render();
  });

  addEventListener('load', () => {
    const nav = performance.getEntriesByType('navigation')[0];
    if (nav) m.load = nav.loadEventEnd;
    // Sum script evaluation time where the browser exposes it.
    m.jsEval = performance.getEntriesByType('measure')
      .filter((e) => e.name.startsWith('js:'))
      .reduce((a, e) => a + e.duration, 0);
    render();
    setTimeout(render, 1200);         // catch a late LCP
  });

  const ms = (v) => (v == null ? '–' : `${Math.round(v)}ms`);
  const kb = (v) => `${(v / 1024).toFixed(1)}KB`;

  function render() {
    const el = box();
    if (!el) return;
    const grade = (v, good, bad) => (v == null ? '' : v <= good ? 'ok' : v <= bad ? 'meh' : 'no');
    el.innerHTML = `
      <table>
        <tr><th>TTFB</th><td class="${grade(m.ttfb, 200, 600)}">${ms(m.ttfb)}</td>
            <th>FCP</th><td class="${grade(m.fcp, 1000, 2500)}">${ms(m.fcp)}</td></tr>
        <tr><th>LCP</th><td class="${grade(m.lcp, 2500, 4000)}">${ms(m.lcp)}</td>
            <th>CLS</th><td class="${grade(m.cls, 0.1, 0.25)}">${m.cls.toFixed(3)}</td></tr>
        <tr><th>DCL</th><td>${ms(m.dcl)}</td><th>load</th><td>${ms(m.load)}</td></tr>
        <tr><th>TBT</th><td class="${grade(m.tbt, 200, 600)}">${ms(m.tbt)}</td>
            <th>long tasks</th><td>${m.longTasks}</td></tr>
        <tr><th>JS</th><td>${kb(m.jsBytes)}</td>
            <th>hydration</th><td>${m.hydration ? ms(m.hydration) : (m.islands ? `${m.islands} islands` : '–')}</td></tr>
        ${m.inp != null ? `<tr><th>INP</th><td class="${grade(m.inp, 200, 500)}">${ms(m.inp)}</td><th></th><td></td></tr>` : ''}
        ${m.slots.length ? `<tr><th>slots</th><td colspan="3">${m.slots.map((s) => `${s.name} ${Math.round(s.at)}ms`).join(' · ')}</td></tr>` : ''}
      </table>
      <div class="hint">LCP element: ${m.lcpElement || '–'} · mode: ${document.body.dataset.mode}</div>`;
  }

  window.__perf = m;
  render();
})();
