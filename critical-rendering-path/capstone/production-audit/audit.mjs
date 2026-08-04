#!/usr/bin/env node
/**
 * audit.mjs — the automation scaffold for Capstone 21.
 *
 * What's implemented: environment control (CPU + network throttling), cold/warm load
 * measurement with Core Web Vitals, long-task collection, CDP counters (layout count,
 * style recalc count, heap, nodes, listeners), N runs with medians, and JSON output.
 *
 * What's TODO — the interesting half: interaction measurement with INP breakdown, the
 * sustained-use leak loop, third-party attribution, and layer-tree collection.
 *
 * Setup:
 *   npm init -y && npm i -D playwright && npx playwright install chromium
 *
 * Usage:
 *   node audit.mjs https://example.com
 *   node audit.mjs https://example.com --runs 5 --profile low-end
 *
 * BEFORE YOU POINT THIS AT ANYTHING: read the "Rules of engagement" section of README.md.
 * Human-scale traffic only. Default is 3 loads per profile, which is ordinary browsing.
 * If you raise --runs a lot, use a local copy of the app instead of someone's production.
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'appendix');

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const url = args.find(a => a.startsWith('http'));
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

if (!url) {
  console.error('usage: node audit.mjs <url> [--runs 3] [--profile mid-tier|low-end|desktop]');
  process.exit(1);
}

const RUNS = Number(flag('runs', 3));
const PROFILE_NAME = flag('profile', 'mid-tier');

const PROFILES = {
  // Throughput in bytes/sec, latency in ms — the same shapes DevTools' presets use.
  'mid-tier': {
    cpu: 4,
    net: { downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, latency: 150 },
    viewport: { width: 390, height: 844 },
  },
  'low-end': {
    cpu: 6,
    net: { downloadThroughput: (400 * 1024) / 8, uploadThroughput: (400 * 1024) / 8, latency: 400 },
    viewport: { width: 390, height: 844 },
  },
  desktop: {
    cpu: 1,
    net: null,
    viewport: { width: 1440, height: 900 },
  },
};

const profile = PROFILES[PROFILE_NAME];
if (!profile) {
  console.error(`unknown profile "${PROFILE_NAME}". Options: ${Object.keys(PROFILES).join(', ')}`);
  process.exit(1);
}

const median = xs => {
  const s = xs.filter(n => typeof n === 'number' && !Number.isNaN(n)).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// ---------------------------------------------------------------------------
// In-page collector. Installed before any page script runs, so it sees everything.
// ---------------------------------------------------------------------------
const COLLECTOR = () => {
  window.__audit = { lcp: 0, cls: 0, longTasks: [], shifts: [], inp: [] };

  const obs = (type, fn, extra = {}) => {
    try { new PerformanceObserver(fn).observe({ type, buffered: true, ...extra }); }
    catch { /* type unsupported in this browser */ }
  };

  obs('largest-contentful-paint', list => {
    const last = list.getEntries().at(-1);
    window.__audit.lcp = last.startTime;
    window.__audit.lcpElement = last.element?.tagName?.toLowerCase() ?? null;
    window.__audit.lcpUrl = last.url || null;
  });

  // Real session-window CLS, same algorithm as Lab 18.
  let windows = [];
  obs('layout-shift', list => {
    for (const e of list.getEntries()) {
      if (e.hadRecentInput) continue;
      const w = windows.at(-1);
      if (!w || e.startTime - w.last > 1000 || e.startTime - w.first > 5000) {
        windows.push({ first: e.startTime, last: e.startTime, sum: e.value });
      } else {
        w.last = e.startTime; w.sum += e.value;
      }
      window.__audit.shifts.push({
        at: e.startTime,
        value: e.value,
        sources: (e.sources || []).map(s => s.node?.tagName?.toLowerCase() ?? '?'),
      });
    }
    window.__audit.cls = windows.reduce((m, w) => Math.max(m, w.sum), 0);
  });

  obs('longtask', list => {
    for (const e of list.getEntries()) {
      window.__audit.longTasks.push({
        at: e.startTime,
        duration: e.duration,
        attribution: e.attribution?.[0]?.name ?? null,
      });
    }
  });

  // Interaction latency, three-phase — used by the TODO interaction phase.
  obs('event', list => {
    for (const e of list.getEntries()) {
      if (!e.interactionId) continue;
      window.__audit.inp.push({
        type: e.name,
        duration: e.duration,
        inputDelay: e.processingStart - e.startTime,
        processing: e.processingEnd - e.processingStart,
        presentation: e.startTime + e.duration - e.processingEnd,
      });
    }
  }, { durationThreshold: 0 });
};

// ---------------------------------------------------------------------------
// one load
// ---------------------------------------------------------------------------
async function measureLoad(browser, { warm }) {
  const context = await browser.newContext({
    viewport: profile.viewport,
    // A real mobile UA changes what many sites serve. Note it in your report either way.
    ...(PROFILE_NAME === 'desktop' ? {} : { isMobile: true, hasTouch: true }),
  });
  const page = await context.newPage();
  await page.addInitScript(COLLECTOR);

  const client = await context.newCDPSession(page);
  await client.send('Performance.enable');
  await client.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
  if (profile.net) {
    await client.send('Network.emulateNetworkConditions', { offline: false, ...profile.net });
  }

  // Per-request accounting, for the third-party table.
  const requests = [];
  page.on('response', async res => {
    const req = res.request();
    let bytes = 0;
    try { bytes = Number((await res.headerValue('content-length')) ?? 0); } catch { /* ignore */ }
    requests.push({
      url: res.url(),
      origin: new URL(res.url()).origin,
      type: req.resourceType(),
      status: res.status(),
      bytes,
    });
  });

  if (warm) {
    // Prime the cache, then measure the second load in the same context.
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    requests.length = 0;
  }

  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });

  // Let LCP settle — it can change until the first user input or a few seconds pass.
  await page.waitForTimeout(3000);

  const vitals = await page.evaluate(() => {
    const paints = performance.getEntriesByType('paint');
    const nav = performance.getEntriesByType('navigation')[0];
    const res = performance.getEntriesByType('resource');
    return {
      ...window.__audit,
      fcp: paints.find(p => p.name === 'first-contentful-paint')?.startTime ?? null,
      dcl: nav?.domContentLoadedEventEnd ?? null,
      load: nav?.loadEventEnd ?? null,
      protocol: nav?.nextHopProtocol ?? null,
      transferred: res.reduce((a, r) => a + (r.transferSize || 0), 0),
      requestCount: res.length,
      // Render-blocking is reported by Chrome on resource entries.
      renderBlocking: res.filter(r => r.renderBlockingStatus === 'blocking')
        .map(r => ({ url: r.name, duration: r.duration })),
    };
  });

  const metrics = Object.fromEntries(
    (await client.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));

  const result = {
    wallClock: Date.now() - t0,
    fcp: vitals.fcp,
    lcp: vitals.lcp,
    lcpElement: vitals.lcpElement,
    cls: vitals.cls,
    dcl: vitals.dcl,
    load: vitals.load,
    protocol: vitals.protocol,
    transferred: vitals.transferred,
    requestCount: vitals.requestCount,
    renderBlockingCount: vitals.renderBlocking.length,
    renderBlocking: vitals.renderBlocking.slice(0, 10),
    longTaskCount: vitals.longTasks.length,
    longestTask: vitals.longTasks.reduce((m, t) => Math.max(m, t.duration), 0),
    tbt: vitals.longTasks.reduce((a, t) => a + Math.max(0, t.duration - 50), 0),
    shiftCount: vitals.shifts.length,
    // CDP counters — these are the ones the rest of this course taught you to read.
    layoutCount: metrics.LayoutCount,
    recalcStyleCount: metrics.RecalcStyleCount,
    layoutDuration: metrics.LayoutDuration,
    recalcStyleDuration: metrics.RecalcStyleDuration,
    jsHeapMB: metrics.JSHeapUsedSize ? metrics.JSHeapUsedSize / 1048576 : null,
    nodes: metrics.Nodes,
    listeners: metrics.JSEventListeners,
    requests,
  };

  await context.close();
  return result;
}

// ---------------------------------------------------------------------------
// third-party attribution
// ---------------------------------------------------------------------------
function thirdParties(requests, targetOrigin) {
  const byOrigin = new Map();
  for (const r of requests) {
    if (r.origin === targetOrigin) continue;
    const e = byOrigin.get(r.origin) ?? { origin: r.origin, count: 0, bytes: 0, types: new Set() };
    e.count++; e.bytes += r.bytes; e.types.add(r.type);
    byOrigin.set(r.origin, e);
  }
  return [...byOrigin.values()]
    .map(e => ({ ...e, types: [...e.types].join(',') }))
    .sort((a, b) => b.bytes - a.bytes);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
const browser = await chromium.launch();
const report = { url, profile: PROFILE_NAME, runs: RUNS, startedAt: new Date().toISOString() };

console.log(`\nauditing ${url}`);
console.log(`profile: ${PROFILE_NAME} (CPU ${profile.cpu}×, ` +
  `${profile.net ? `${(profile.net.downloadThroughput * 8 / 1024 / 1024).toFixed(1)}Mbps / ${profile.net.latency}ms RTT` : 'no network throttle'})`);
console.log(`runs: ${RUNS} (median reported)\n`);

for (const warm of [false, true]) {
  const label = warm ? 'warm' : 'cold';
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    process.stdout.write(`  ${label} run ${i + 1}/${RUNS}… `);
    const r = await measureLoad(browser, { warm });
    runs.push(r);
    console.log(`FCP ${r.fcp?.toFixed(0)}ms  LCP ${r.lcp?.toFixed(0)}ms  CLS ${r.cls?.toFixed(3)}`);
  }

  const keys = ['fcp', 'lcp', 'cls', 'dcl', 'load', 'transferred', 'requestCount',
    'longTaskCount', 'longestTask', 'tbt', 'layoutCount', 'recalcStyleCount',
    'layoutDuration', 'recalcStyleDuration', 'jsHeapMB', 'nodes', 'listeners'];

  report[label] = {
    median: Object.fromEntries(keys.map(k => [k, median(runs.map(r => r[k]))])),
    lcpElement: runs[0].lcpElement,
    protocol: runs[0].protocol,
    renderBlocking: runs[0].renderBlocking,
    thirdParties: thirdParties(runs[0].requests, new URL(url).origin).slice(0, 15),
    allRuns: runs.map(r => Object.fromEntries(keys.map(k => [k, r[k]]))),
  };
}

await browser.close();

mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const file = join(outDir, `audit-${PROFILE_NAME}-${stamp}.json`);
writeFileSync(file, JSON.stringify(report, null, 2));

// ---------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------
const c = report.cold.median, w = report.warm.median;
const row = (name, cold, warm, target) =>
  `  ${name.padEnd(22)} ${String(cold ?? '–').padStart(10)} ${String(warm ?? '–').padStart(10)}   ${target}`;
const n = (v, d = 0) => (v == null ? '–' : v.toFixed(d));

console.log(`\n${'='.repeat(66)}\n  metric${' '.repeat(18)}      cold       warm   target\n${'='.repeat(66)}`);
console.log(row('FCP (ms)', n(c.fcp), n(w.fcp), '< 1800'));
console.log(row('LCP (ms)', n(c.lcp), n(w.lcp), '< 2500'));
console.log(row('CLS', n(c.cls, 4), n(w.cls, 4), '< 0.1'));
console.log(row('TBT (ms)', n(c.tbt), n(w.tbt), '< 200'));
console.log(row('longest task (ms)', n(c.longestTask), n(w.longestTask), '< 50'));
console.log(row('transferred (KB)', n(c.transferred / 1024), n(w.transferred / 1024), '—'));
console.log(row('requests', n(c.requestCount), n(w.requestCount), '—'));
console.log(row('layout count', n(c.layoutCount), n(w.layoutCount), 'lower is better'));
console.log(row('style recalc count', n(c.recalcStyleCount), n(w.recalcStyleCount), 'lower is better'));
console.log(row('DOM nodes', n(c.nodes), n(w.nodes), '< 1500'));
console.log(row('listeners', n(c.listeners), n(w.listeners), '—'));
console.log(`\n  LCP element: <${report.cold.lcpElement ?? '?'}>   protocol: ${report.cold.protocol}`);
console.log(`  render-blocking resources: ${report.cold.median.requestCount != null ? report.cold.renderBlocking.length : '?'}`);
console.log(`\n  top third parties by bytes:`);
for (const t of report.cold.thirdParties.slice(0, 5)) {
  console.log(`    ${(t.bytes / 1024).toFixed(0).padStart(6)} KB  ${t.count.toString().padStart(3)} reqs  ${t.origin}  (${t.types})`);
}
console.log(`\n  written to ${file}\n`);

// ---------------------------------------------------------------------------
// TODO — the interesting half. Each of these is a phase from README.md.
//
// [ ] PHASE 2 — interactions.
//     Script the 5 most important interactions (page.click, page.type, page.hover…).
//     After each, read window.__audit.inp and report the three-phase breakdown per
//     interaction. Assert against a budget. Remember: the interaction's duration is the
//     MAX across entries sharing an interactionId, not the sum — group before you report.
//
// [ ] PHASE 2b — bottleneck attribution.
//     Wrap each interaction in a CDP trace (Tracing.start / Tracing.end with the
//     devtools.timeline category), then aggregate the trace events by name to get
//     Layout / RecalculateStyles / Paint / Composite totals per interaction. This is how
//     you turn "it's slow" into "it's slow in Paint".
//
// [ ] PHASE 2c — layers. LayerTree.enable + LayerTree.layerTreeDidChange, then sum layer
//     memory and group by compositing reason (Lab 15's build challenge, reused).
//
// [ ] PHASE 3 — sustained use / leaks.
//     Loop: navigate A→B→C→D→A, 50×. After each cycle:
//       await client.send('HeapProfiler.collectGarbage')
//       then Performance.getMetrics → JSHeapUsedSize, Nodes, JSEventListeners
//     Plot the series and fit a slope. Flat-with-sawtooth is healthy; a staircase is a
//     finding. Also re-run one Phase 2 interaction at cycle 0 and cycle 50 and compare —
//     "the app is slower after sustained use" is the finding nobody files.
//
// [ ] PHASE 1b — coverage. Profiler.startPreciseCoverage / CSS.startRuleUsageTracking,
//     to get unused JS and CSS percentages without opening DevTools by hand.
//
// [ ] PHASE 4 — field data. Fetch the CrUX record for the URL from the PageSpeed Insights
//     API (needs a free API key) and put the field p75s next to your lab medians in the
//     output. Where they disagree, that disagreement goes in the report.
//
// [ ] Multi-profile: run all three profiles in one invocation and emit a comparison table.
//
// [ ] Budget enforcement: read budgets.json, exit non-zero on violation, and print a diff
//     against the previous run in appendix/. That's what turns this from a script you ran
//     once into a regression gate.
// ---------------------------------------------------------------------------
