// Lab 06 — Budgets.

import { $, on, Log, renderTable, fmt } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

const PROFILES = {
  slow4g: { name: 'Slow 4G', bytesPerSec: 400 * 1024 / 8, rtt: 400 },
  fast4g: { name: 'Fast 4G', bytesPerSec: 1.5 * 1024 * 1024, rtt: 150 },
  cable: { name: 'Cable', bytesPerSec: 5 * 1024 * 1024, rtt: 30 },
};

on('calc', () => {
  const p = PROFILES[$('profile').value];
  const target = Number($('target').value);

  // A deliberately crude model, and crude is the point — it is a planning tool, not a simulator.
  //   DNS + TCP + TLS ≈ 3 RTT for a new origin
  //   the HTML request itself ≈ 1 RTT + server time
  //   then the critical assets have to arrive
  const handshake = p.rtt * 3;
  const htmlRtt = p.rtt;
  const serverTime = 200;
  const overhead = handshake + htmlRtt + serverTime;
  const remaining = Math.max(target - overhead, 0);
  const criticalBytes = remaining * (p.bytesPerSec / 1000);

  // A defensible split of the critical-path allowance.
  const split = [
    ['HTML', 0.10, 'the document itself'],
    ['CSS', 0.10, 'render-blocking by definition'],
    ['JS (critical)', 0.20, 'anything that must run before the page is usable'],
    ['LCP image', 0.45, 'the thing the metric is named after'],
    ['fonts', 0.10, 'above-the-fold faces only'],
    ['everything else', 0.05, 'icons, the rest'],
  ];

  const rows = split.map(([what, share, note]) => ({
    'asset type': what,
    'share': `${(share * 100).toFixed(0)}%`,
    'budget': fmt.bytes(criticalBytes * share),
    'download time': `${Math.round((criticalBytes * share) / p.bytesPerSec * 1000)}ms`,
    note,
  }));

  renderTable('#results', [
    ...rows,
    { 'asset type': 'TOTAL on the critical path', share: '100%', budget: fmt.bytes(criticalBytes),
      'download time': `${Math.round(remaining)}ms`, note: `+${Math.round(overhead)}ms of overhead = ${target}ms` },
  ], { columns: ['asset type', 'share', 'budget', 'download time', 'note'] });

  log.head(`— ${p.name}, LCP target ${target}ms —`);
  log.line(`connection overhead ${Math.round(overhead)}ms (3 RTT handshake + 1 RTT request + 200ms server)`, 'macro');
  log.line(`leaves ${Math.round(remaining)}ms of transfer = ${fmt.bytes(criticalBytes)} on the critical path`,
    criticalBytes < 200000 ? 'bad' : 'good');

  out.textContent =
    `On ${p.name}, hitting a ${target}ms LCP means everything on the critical path fits in about\n` +
    `${fmt.bytes(criticalBytes)}.\n\n` +
    `Note where the time went before any bytes moved: ${Math.round(overhead)}ms of handshake,\n` +
    'request and server time. On Slow 4G that overhead alone is over a second, which is why\n' +
    'reducing ROUND TRIPS (resource-hints) matters as much as reducing bytes on slow connections.\n\n' +
    'What makes this budget usable rather than decorative:\n' +
    '  • it is per-TYPE, so it can be assigned to the people who own each type\n' +
    '  • it is about the CRITICAL PATH, not the whole page. Lazy-loaded images below the fold are\n' +
    '    not in it, which is what makes lazy loading valuable\n' +
    '  • it is checkable by a script (budget-check.mjs), so it is a build failure and not an\n' +
    '    opinion in a retro\n\n' +
    'And the honest caveat: this is a planning model, not a simulator. Real LCP depends on\n' +
    'discovery order, priority, CPU, and where the image sits in the waterfall. Use the model to\n' +
    'set the budget; use the field data to check it.';
});

on('audit', async () => {
  log.head('— auditing sandbox pages (byte totals from the HTML, no JS execution) —');
  const targets = [
    ['CSR product page', '/render/csr/product/3'],
    ['SSR product page', '/render/ssr-par/product/3'],
    ['image lab, baseline', '/asset-optimization/labs/02-image-loading/?case=baseline'],
    ['image lab, lazy thumbs', '/asset-optimization/labs/02-image-loading/?case=lazyrest'],
  ];
  const rows = [];

  for (const [label, url] of targets) {
    const html = await (await fetch(url, { cache: 'no-store' })).text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const urls = new Set();
    for (const el of doc.querySelectorAll('script[src]')) urls.add(el.getAttribute('src'));
    for (const el of doc.querySelectorAll('link[rel=stylesheet][href]')) urls.add(el.getAttribute('href'));
    for (const el of doc.querySelectorAll('img[src]')) {
      if (el.loading !== 'lazy') urls.add(el.getAttribute('src'));     // lazy images are not on the critical path
    }

    let bytes = new TextEncoder().encode(html).length;
    let counted = 0;
    for (const u of urls) {
      try {
        const res = await fetch(new URL(u, location.origin + url), { method: 'HEAD', cache: 'no-store' });
        bytes += Number(res.headers.get('content-length') || 0);
        counted++;
      } catch { /* ignore */ }
    }

    rows.push({
      page: label,
      'HTML bytes': fmt.bytes(new TextEncoder().encode(html).length),
      'eager subresources': counted,
      'critical-path bytes': fmt.bytes(bytes),
      'Fast 4G transfer': `${Math.round(bytes / (1.5 * 1024 * 1024) * 1000)}ms`,
      _criticalClass: bytes > 900000 ? 'no' : bytes > 400000 ? 'meh' : 'ok',
    });
    renderTable('#results', rows, {
      columns: ['page', 'HTML bytes', 'eager subresources', 'critical-path bytes', 'Fast 4G transfer'],
    });
    log.line(`${label.padEnd(26)} ${fmt.bytes(bytes)}`, bytes > 900000 ? 'bad' : 'good');
  }

  out.textContent =
    'Compare the two image-lab rows. Identical content; one lazy-loads the thumbnails and one does\n' +
    'not, and the critical-path bytes differ by an order of magnitude.\n\n' +
    'That is what a budget is for: it makes the difference between those two pages a NUMBER that\n' +
    'a build can check, rather than something a reviewer might notice.\n\n' +
    'Note also that the CSR page has tiny critical-path bytes and the worst LCP (rendering-\n' +
    'strategies lab 01). A byte budget is necessary and not sufficient — pair it with a real\n' +
    'browser measurement of LCP/CLS/TBT. Bytes are what you can enforce cheaply on every commit;\n' +
    'Core Web Vitals are what you verify nightly.';
});

on('clear', () => { log.clear(); $('#results').textContent = ''; });
