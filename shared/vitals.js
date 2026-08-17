/**
 * vitals.js — Core Web Vitals, measured the way the field tools measure them.
 *
 * This is a readable stand-in for the `web-vitals` library. Use the real one in production; read
 * this one to understand what it is doing, because every subtlety below is a subtlety you will
 * eventually have to explain to someone:
 *
 *   LCP  keeps updating until the first interaction — the "largest" element can change late
 *   CLS  is the largest 5-second SESSION WINDOW of shifts, not the total
 *   INP  is (roughly) the 98th-percentile interaction, not the worst and not the first
 *   TTFB comes from the navigation entry, not from a timer you started
 *
 * Every observer uses buffered: true so entries that happened before this script ran are not lost.
 */

const listeners = new Set();
export const vitals = {
  TTFB: null, FCP: null, LCP: null, CLS: 0, INP: null,
  lcpElement: null, clsSources: [], interactions: [],
};

function emit() { for (const l of listeners) l(vitals); }
export function onVitals(fn) { listeners.add(fn); fn(vitals); return () => listeners.delete(fn); }

const observe = (type, cb, opts = {}) => {
  try {
    const po = new PerformanceObserver((list) => { for (const e of list.getEntries()) cb(e, po); });
    po.observe({ type, buffered: true, ...opts });
    return po;
  } catch { return null; }
};

// ---------------------------------------------------------------------------
// TTFB and FCP
// ---------------------------------------------------------------------------

observe('navigation', (e) => { vitals.TTFB = e.responseStart; emit(); });
observe('paint', (e) => { if (e.name === 'first-contentful-paint') { vitals.FCP = e.startTime; emit(); } });

// ---------------------------------------------------------------------------
// LCP — reported until the first interaction, then frozen.
//
// The freeze is not an implementation detail: once the user has interacted, content that appears
// afterwards is a response to them, not "loading". This is why a click during load can make a bad
// LCP look good, and why field LCP is noisier than lab LCP.
// ---------------------------------------------------------------------------

const lcpObserver = observe('largest-contentful-paint', (e) => {
  vitals.LCP = e.startTime;
  vitals.lcpElement = e.element ? describe(e.element) : (e.url ?? '(unknown)');
  vitals.lcpSize = e.size;
  emit();
});
for (const type of ['keydown', 'click']) {
  addEventListener(type, () => lcpObserver?.disconnect(), { once: true, capture: true });
}

// ---------------------------------------------------------------------------
// CLS — the largest session window, not the sum.
//
// A session window: shifts separated by <1s from the previous shift and <5s from the first shift
// in the window. Total-sum scoring punished long-lived pages (an infinite feed would fail simply
// by existing); windowing scores the WORST MOMENT instead.
// ---------------------------------------------------------------------------

let sessionValue = 0, sessionEntries = [];
observe('layout-shift', (e) => {
  if (e.hadRecentInput) return;              // shifts within 500ms of an input are "expected"
  const first = sessionEntries[0], last = sessionEntries.at(-1);
  if (sessionEntries.length && e.startTime - last.startTime < 1000 && e.startTime - first.startTime < 5000) {
    sessionValue += e.value;
    sessionEntries.push(e);
  } else {
    sessionValue = e.value;
    sessionEntries = [e];
  }
  if (sessionValue > vitals.CLS) {
    vitals.CLS = sessionValue;
    vitals.clsSources = sessionEntries.flatMap((entry) =>
      (entry.sources ?? []).map((s) => ({
        value: entry.value,
        node: s.node ? describe(s.node) : '(no node)',
        from: rectOf(s.previousRect), to: rectOf(s.currentRect),
      })));
    emit();
  }
});

// ---------------------------------------------------------------------------
// INP — interaction to next paint.
//
// The metric is the whole interaction, measured to the NEXT PAINT: input delay (the main thread
// was busy) + processing (your handlers) + presentation delay (rendering the result). Most people
// only ever optimise the middle one.
//
// Interactions are grouped by interactionId, because one tap produces pointerdown/pointerup/click
// and the metric is about the tap, not the events.
// ---------------------------------------------------------------------------

const byInteraction = new Map();
observe('event', (e) => {
  if (!e.interactionId) return;
  const prev = byInteraction.get(e.interactionId);
  const duration = e.duration;
  if (!prev || duration > prev.duration) {
    byInteraction.set(e.interactionId, {
      id: e.interactionId,
      name: e.name,
      duration,
      inputDelay: e.processingStart - e.startTime,
      processing: e.processingEnd - e.processingStart,
      presentation: e.startTime + e.duration - e.processingEnd,
      target: e.target ? describe(e.target) : '(detached)',
    });
  }
  const all = [...byInteraction.values()].sort((a, b) => b.duration - a.duration);
  vitals.interactions = all.slice(0, 10);
  // The real metric: the 98th percentile, approximated as "one interaction discarded per 50".
  const index = Math.min(all.length - 1, Math.floor(all.length / 50));
  vitals.INP = all[index]?.duration ?? null;
  vitals.worstInteraction = all[0] ?? null;
  emit();
}, { durationThreshold: 16 });

// ---------------------------------------------------------------------------

function describe(node) {
  if (!node || node.nodeType !== 1) return String(node?.nodeName ?? node);
  const id = node.id ? `#${node.id}` : '';
  const cls = typeof node.className === 'string' && node.className
    ? `.${node.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
  return `${node.tagName.toLowerCase()}${id}${cls}`;
}

const rectOf = (r) => (r ? `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}×${Math.round(r.height)}` : '—');

/** Good / needs-improvement / poor, using the published thresholds. */
export const THRESHOLDS = { LCP: [2500, 4000], CLS: [0.1, 0.25], INP: [200, 500], FCP: [1800, 3000], TTFB: [800, 1800] };
export function rate(metric, value) {
  const t = THRESHOLDS[metric];
  if (!t || value == null) return '—';
  return value <= t[0] ? 'good' : value <= t[1] ? 'needs work' : 'poor';
}

/** Drops a live scoreboard into the page. */
export function vitalsHud(target = document.body) {
  const el = document.createElement('div');
  el.className = 'vitals-hud';
  el.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:9999;background:#0d0d14;' +
    'border:1px solid #2a2a3a;border-radius:8px;padding:8px 10px;font:11px/1.6 ui-monospace,monospace;' +
    'color:#c9d1d9;min-width:180px';
  target.append(el);
  onVitals((v) => {
    const line = (k, val, unit = 'ms') => {
      const r = rate(k, val);
      const colour = r === 'good' ? '#7ee787' : r === 'needs work' ? '#e3b341' : r === 'poor' ? '#ff7b72' : '#8b949e';
      return `<div><span style="color:#8b949e">${k}</span> <b style="color:${colour}">` +
        `${val == null ? '—' : k === 'CLS' ? val.toFixed(3) : `${Math.round(val)}${unit}`}</b></div>`;
    };
    el.innerHTML = line('TTFB', v.TTFB) + line('FCP', v.FCP) + line('LCP', v.LCP) +
      line('CLS', v.CLS, '') + line('INP', v.INP);
  });
  return el;
}
