/**
 * report.js — the measurement harness shared by every variant page in this course.
 *
 * Renders a real waterfall from PerformanceResourceTiming (the same data the Network panel
 * draws, minus the parts only the browser process knows), plus the milestones that matter:
 * FCP, LCP, DOMContentLoaded, load.
 *
 * Include it at the END of <body>:
 *   <script src="/resource-hints/report.js"></script>
 */
(function () {
  const PHASES = [
    ['redirect', 'redirectStart', 'redirectEnd', '#6b6b85'],
    ['queue/stall', 'startTime', 'domainLookupStart', '#4a4a5e'],
    ['dns', 'domainLookupStart', 'domainLookupEnd', '#a06bd6'],
    ['connect', 'connectStart', 'connectEnd', '#d69a6b'],
    ['tls', 'secureConnectionStart', 'connectEnd', '#d6c46b'],
    ['request→ttfb', 'requestStart', 'responseStart', '#6b9cd6'],
    ['download', 'responseStart', 'responseEnd', '#6ee7a8'],
  ];

  const milestones = {};
  const style = document.createElement('style');
  style.textContent = `
    #hint-report { margin-top: 24px; max-width: 1100px; font: 12px/1.5 ui-monospace, Menlo, monospace; }
    #hint-report h2 { font-size: 13px; letter-spacing: .04em; color: #9a9ab0; margin: 18px 0 8px; }
    #hint-report .wf { display: grid; grid-template-columns: minmax(210px, max-content) 1fr; gap: 3px 10px; align-items: center; }
    #hint-report .wf .n { color: #9a9ab0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #hint-report .wf .t { position: relative; height: 16px; background: #0a0a10; border-radius: 3px; }
    #hint-report .wf .t i { position: absolute; top: 0; bottom: 0; }
    #hint-report .wf .t b { position: absolute; right: 4px; top: 1px; color: #9a9ab0; font-weight: 400; font-size: 11px; }
    #hint-report .wf .t u { position: absolute; top: -2px; bottom: -2px; width: 2px; background: #ff6b6b; text-decoration: none; }
    #hint-report table { border-collapse: collapse; width: 100%; }
    #hint-report td, #hint-report th { padding: 3px 8px; border-bottom: 1px solid #2a2a38; text-align: left; color: #e9e9f2; }
    #hint-report th { color: #9a9ab0; font-weight: 500; }
    #hint-report .key { display: flex; flex-wrap: wrap; gap: 12px; color: #9a9ab0; margin-bottom: 8px; }
    #hint-report .key span::before { content: ''; display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
    #hint-report .big { font-size: 20px; color: #e9e9f2; }
  `;
  document.head.appendChild(style);

  function observe(type, cb, extra = {}) {
    try {
      new PerformanceObserver((l) => l.getEntries().forEach(cb)).observe({ type, buffered: true, ...extra });
    } catch { /* unsupported */ }
  }

  observe('paint', (e) => { milestones[e.name] = e.startTime; });
  observe('largest-contentful-paint', (e) => { milestones.lcp = e.startTime; milestones.lcpElement = e.element?.tagName; });
  observe('layout-shift', (e) => { if (!e.hadRecentInput) milestones.cls = (milestones.cls || 0) + e.value; });

  function render() {
    const nav = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource')
      .filter((e) => !e.name.includes('/report.js'))
      .sort((a, b) => a.startTime - b.startTime);

    const max = Math.max(
      nav ? nav.loadEventEnd : 0,
      milestones.lcp || 0,
      ...resources.map((r) => r.responseEnd),
    ) * 1.02 || 1;

    const box = document.createElement('div');
    box.id = 'hint-report';

    const key = PHASES.map(([n, , , c]) => `<span style="--c:${c}"><i></i>${n}</span>`).join('');
    box.innerHTML = `
      <h2>milestones</h2>
      <table>
        <tr><th>metric</th><th>ms</th><th>note</th></tr>
        <tr><td>first contentful paint</td><td class="big">${fmt(milestones['first-contentful-paint'])}</td><td>first text/image painted</td></tr>
        <tr><td>largest contentful paint</td><td class="big">${fmt(milestones.lcp)}</td><td>${milestones.lcpElement || '–'}</td></tr>
        <tr><td>DOMContentLoaded</td><td>${fmt(nav?.domContentLoadedEventEnd)}</td><td>HTML parsed, deferred scripts run</td></tr>
        <tr><td>load</td><td>${fmt(nav?.loadEventEnd)}</td><td>every subresource done</td></tr>
        <tr><td>cumulative layout shift</td><td>${(milestones.cls || 0).toFixed(3)}</td><td>–</td></tr>
        <tr><td>requests</td><td>${resources.length}</td><td>critical path depth is what matters, not the count</td></tr>
      </table>
      <h2>waterfall</h2>
      <div class="key">${key}</div>
      <div class="wf"></div>`;

    const wf = box.querySelector('.wf');
    for (const r of resources) {
      const n = document.createElement('div');
      n.className = 'n';
      n.textContent = shorten(r.name);
      n.title = r.name;

      const t = document.createElement('div');
      t.className = 't';
      for (const [, from, to, colour] of PHASES) {
        const a = r[from], b = r[to];
        if (!a || !b || b <= a) continue;
        const bar = document.createElement('i');
        bar.style.left = `${(a / max) * 100}%`;
        bar.style.width = `${Math.max(((b - a) / max) * 100, 0.3)}%`;
        bar.style.background = colour;
        t.append(bar);
      }
      const label = document.createElement('b');
      label.textContent = `${Math.round(r.startTime)}→${Math.round(r.responseEnd)}ms` +
        (r.initiatorType ? `  ${r.initiatorType}` : '');
      t.append(label);
      wf.append(n, t);
    }

    // Milestone markers across the whole chart.
    for (const [label, at, colour] of [
      ['FCP', milestones['first-contentful-paint'], '#ffd166'],
      ['LCP', milestones.lcp, '#ff6b6b'],
      ['load', nav?.loadEventEnd, '#7c9cff'],
    ]) {
      if (!at) continue;
      const n = document.createElement('div');
      n.className = 'n';
      n.textContent = `— ${label} @ ${Math.round(at)}ms`;
      n.style.color = colour;
      const t = document.createElement('div');
      t.className = 't';
      const mark = document.createElement('u');
      mark.style.left = `${(at / max) * 100}%`;
      mark.style.background = colour;
      t.append(mark);
      wf.append(n, t);
    }

    document.body.append(box);

    // Colour swatches in the key.
    box.querySelectorAll('.key span').forEach((s, i) => {
      s.style.setProperty('--c', PHASES[i][3]);
      s.firstChild.style.background = PHASES[i][3];
    });

    console.table(resources.map((r) => ({
      name: shorten(r.name),
      start: Math.round(r.startTime),
      dns: Math.round(r.domainLookupEnd - r.domainLookupStart),
      connect: Math.round(r.connectEnd - r.connectStart),
      ttfb: Math.round(r.responseStart - r.requestStart),
      download: Math.round(r.responseEnd - r.responseStart),
      end: Math.round(r.responseEnd),
      initiator: r.initiatorType,
      size: r.transferSize,
    })));
  }

  function fmt(v) { return v == null ? '–' : Math.round(v); }
  function shorten(url) {
    try {
      const u = new URL(url);
      const name = u.searchParams.get('name') || u.pathname.split('/').pop();
      const delay = u.searchParams.get('delay');
      return `${u.port === location.port ? '' : `:${u.port} `}${name}${delay ? ` (${delay}ms)` : ''}`;
    } catch { return url; }
  }

  addEventListener('load', () => setTimeout(render, 300));
})();
