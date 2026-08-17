/**
 * lab-ui.js — tiny helpers shared by the labs. Import it as a module:
 *
 *   import { $, on, Log, fmt, busy, sleep, nextFrame, resourceInfo } from '/shared/lab-ui.js';
 *
 * Deliberately dependency-free and small enough to read in one sitting. Nothing here is
 * clever; the cleverness is supposed to be in the lab you are debugging.
 */

export const $ = (sel, root = document) =>
  root.querySelector(sel.startsWith('#') || sel.startsWith('.') || sel.includes(' ') ? sel : `#${sel}`);

export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** on('buttonId', fn) or on(element, 'click', fn) */
export function on(target, a, b) {
  if (typeof target === 'string') {
    const el = $(target);
    if (!el) throw new Error(`on(): no element #${target}`);
    if (typeof a === 'function') return el.addEventListener('click', a), el;
    return el.addEventListener(a, b), el;
  }
  target.addEventListener(a, b);
  return target;
}

/**
 * An ordered log. The sequence number matters more than you think: in the event-loop labs
 * the *order* is the whole answer, and a wall-clock timestamp is too coarse to show it.
 */
export class Log {
  constructor(target = '#log') {
    this.el = typeof target === 'string' ? $(target) : target;
    this.n = 0;
    this.t0 = performance.now();
  }

  line(msg, cls = '') {
    const row = document.createElement('div');
    row.className = cls;
    row.innerHTML = `<span class="seq">${++this.n}</span><span class="msg"></span>`;
    row.lastChild.textContent = msg;
    this.el.appendChild(row);
    this.el.scrollTop = this.el.scrollHeight;
    return this.n;
  }

  /** Same, but prefixed with ms since the log was last cleared. */
  timed(msg, cls = '') {
    return this.line(`${(performance.now() - this.t0).toFixed(1).padStart(7)}ms  ${msg}`, cls);
  }

  head(msg) { return this.line(msg, 'head'); }
  ok(msg) { return this.line(msg, 'good'); }
  bad(msg) { return this.line(msg, 'bad'); }
  muted(msg) { return this.line(msg, 'muted'); }

  clear() {
    this.el.textContent = '';
    this.n = 0;
    this.t0 = performance.now();
  }
}

export const fmt = {
  ms: (v) => `${v < 10 ? v.toFixed(2) : v.toFixed(0)}ms`,
  bytes(v) {
    if (v == null) return '–';
    if (v === 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(v) / Math.log(1024)), u.length - 1);
    return `${(v / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
  },
  pct: (v) => `${(v * 100).toFixed(0)}%`,
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
/** Resolves after the frame that actually painted the current DOM state. */
export const afterPaint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

/** Block the main thread for ~ms. The only honest way to simulate expensive JS. */
export function busy(ms) {
  const end = performance.now() + ms;
  let x = 0;
  while (performance.now() < end) x += Math.sqrt(x + 1);
  return x;
}

/** Time a synchronous function. Returns [result, durationMs]. */
export function timeIt(fn) {
  const t0 = performance.now();
  const out = fn();
  return [out, performance.now() - t0];
}

/** Time an async function. Returns [result, durationMs]. */
export async function timeItAsync(fn) {
  const t0 = performance.now();
  const out = await fn();
  return [out, performance.now() - t0];
}

/**
 * Look up the PerformanceResourceTiming for the most recent request to `url` and work out
 * where the bytes came from. The heuristics are the standard ones:
 *
 *   transferSize === 0 && decodedBodySize > 0   -> served from the browser cache, no network
 *   transferSize > 0 && transferSize < 300      -> a 304: headers went over the wire, body did not
 *   otherwise                                   -> a full download
 *
 * Cross-origin responses report 0 for the size fields unless they send Timing-Allow-Origin,
 * which is why the lab server always does.
 */
export function resourceInfo(urlPart) {
  const entries = performance.getEntriesByType('resource').filter((e) => e.name.includes(urlPart));
  const e = entries[entries.length - 1];
  if (!e) return null;
  let source = 'network';
  if (e.transferSize === 0 && e.decodedBodySize > 0) source = 'cache (no network)';
  else if (e.transferSize > 0 && e.transferSize < 300 && e.decodedBodySize > 0) source = 'revalidated (304)';
  return {
    name: e.name,
    duration: e.duration,
    transferSize: e.transferSize,
    encodedBodySize: e.encodedBodySize,
    decodedBodySize: e.decodedBodySize,
    startTime: e.startTime,
    responseStart: e.responseStart,
    source,
    entry: e,
  };
}

/** How many times a URL has actually reached the server. Proof that a cache worked. */
export async function serverStats() {
  const res = await fetch('/api/stats', { cache: 'no-store' });
  return res.json();
}

export async function serverReset() {
  await fetch('/api/reset', { cache: 'no-store' });
}

/** Render an array of objects as a table into `target`. Keys of the first row are the columns. */
export function renderTable(target, rows, opts = {}) {
  const el = typeof target === 'string' ? $(target) : target;
  el.textContent = '';
  if (!rows.length) { el.textContent = '(no rows)'; return; }
  const cols = opts.columns || Object.keys(rows[0]);
  const table = document.createElement('table');
  table.className = 'data';
  const thead = table.createTHead().insertRow();
  for (const c of cols) {
    const th = document.createElement('th');
    th.textContent = c;
    thead.appendChild(th);
  }
  const tbody = table.createTBody();
  for (const r of rows) {
    const tr = tbody.insertRow();
    for (const c of cols) {
      const td = tr.insertCell();
      const v = r[c];
      td.textContent = v == null ? '–' : String(v);
      if (typeof v === 'number') td.className = 'num';
      if (r[`_${c}Class`]) td.className = `${td.className} ${r[`_${c}Class`]}`.trim();
    }
  }
  el.appendChild(table);
}

/** Render a simple horizontal bar chart: [{label, value, offset?, cls?, text?}] */
export function renderBars(target, rows, opts = {}) {
  const el = typeof target === 'string' ? $(target) : target;
  el.textContent = '';
  el.className = 'bars';
  const max = opts.max ?? Math.max(...rows.map((r) => (r.offset || 0) + r.value), 1);
  for (const r of rows) {
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = r.label;
    const track = document.createElement('div');
    track.className = 'track';
    const bar = document.createElement('i');
    bar.className = r.cls || '';
    bar.style.left = `${((r.offset || 0) / max) * 100}%`;
    bar.style.width = `${Math.max((r.value / max) * 100, 0.5)}%`;
    const text = document.createElement('b');
    text.textContent = r.text ?? fmt.ms(r.value);
    track.append(bar, text);
    el.append(label, track);
  }
}

/** navigator.storage.estimate(), formatted. */
export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  const e = await navigator.storage.estimate();
  return {
    usage: e.usage,
    quota: e.quota,
    usageFmt: fmt.bytes(e.usage),
    quotaFmt: fmt.bytes(e.quota),
    pct: e.quota ? e.usage / e.quota : 0,
    details: e.usageDetails || null,
  };
}
