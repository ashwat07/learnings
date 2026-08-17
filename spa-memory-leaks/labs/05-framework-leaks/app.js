// Lab 05 — Framework leaks, in a 200-line SPA.

import { $, $$, on, Log, renderTable, fmt, sleep } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
const rows = [];

// ---------------------------------------------------------------------------
// A global store, exactly as every app has one.
// ---------------------------------------------------------------------------

const store = {
  state: { user: { name: 'ada' }, items: [] },
  subscribers: new Set(),
  subscribe(fn, { signal } = {}) {
    this.subscribers.add(fn);
    signal?.addEventListener('abort', () => this.subscribers.delete(fn), { once: true });
    return () => this.subscribers.delete(fn);          // returned, and usually ignored
  },
  set(patch) {
    Object.assign(this.state, patch);
    for (const fn of this.subscribers) fn(this.state);
  },
};

// ---------------------------------------------------------------------------
// A lifecycle primitive — the fix for all four leaks.
// ---------------------------------------------------------------------------

function lifecycle() {
  const ac = new AbortController();
  const cleanups = [];
  return {
    signal: ac.signal,
    onCleanup: (fn) => cleanups.push(fn),
    dispose() {
      ac.abort();
      // Reverse order, and one failure must not skip the rest.
      for (const fn of cleanups.reverse()) { try { fn(); } catch (e) { console.error(e); } }
      cleanups.length = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Instrumentation
// ---------------------------------------------------------------------------

const counters = { intervals: 0, storeCalls: 0, fetches: 0 };
const componentRegistry = new Set();     // dev-mode: who thinks they are still mounted

// ---------------------------------------------------------------------------
// The routes
// ---------------------------------------------------------------------------

function Dashboard(el, mode) {
  const life = lifecycle();
  const leaky = mode === 'leaky';
  const state = { rows: Array.from({ length: 3000 }, (_, i) => `dashboard row ${i}`) };
  componentRegistry.add(state);

  el.innerHTML = '<h2>dashboard</h2><div class="row">polls every 500ms and listens to resize</div>';
  const output = el.querySelector('.row');

  // LEAK 1 — an interval with no cleanup.
  //   React: useEffect(() => { setInterval(poll, 500); }, []);   ← no return
  const timer = setInterval(() => {
    counters.intervals++;
    output.textContent = `ticks: ${counters.intervals} · rows: ${state.rows.length}`;
  }, 500);
  if (!leaky) life.onCleanup(() => clearInterval(timer));

  // LEAK 2 — a window listener with no cleanup.
  //   React: useEffect(() => { window.addEventListener('resize', onResize); }, []);
  const onResize = () => state.rows.length;
  window.addEventListener('resize', onResize, leaky ? undefined : { signal: life.signal });

  return () => { life.dispose(); if (!leaky) componentRegistry.delete(state); };
}

function ListRoute(el, mode) {
  const life = lifecycle();
  const leaky = mode === 'leaky';
  const state = { items: Array.from({ length: 5000 }, (_, i) => ({ id: i, label: `item ${i}` })) };
  componentRegistry.add(state);

  el.innerHTML = '<h2>list</h2><div class="row">subscribed to the store</div>';
  const output = el.querySelector('.row');

  // LEAK 3 — a store subscription whose unsubscribe is dropped.
  //   React: useEffect(() => { store.subscribe(setUser); }, []);   ← return value ignored
  const unsubscribe = store.subscribe(() => {
    counters.storeCalls++;
    output.textContent = `store notifications handled: ${counters.storeCalls}`;
  }, leaky ? {} : { signal: life.signal });
  if (!leaky) life.onCleanup(unsubscribe);

  return () => { life.dispose(); if (!leaky) componentRegistry.delete(state); };
}

function Detail(el, mode) {
  const life = lifecycle();
  const leaky = mode === 'leaky';
  const state = { blob: new Array(4000).fill('detail payload') };
  componentRegistry.add(state);

  el.innerHTML = '<h2>detail</h2><div class="row">fetches on mount</div>';
  const output = el.querySelector('.row');

  // LEAK 4 — a fetch that is never aborted, whose .then() writes into a dead component.
  //   React: useEffect(() => { fetch(url).then(setData); }, []);   ← no AbortController,
  //   and the classic "Can't perform a React state update on an unmounted component" warning
  //   that people silence with an `isMounted` flag instead of aborting the request.
  counters.fetches++;
  fetch('/api/asset?name=detail&type=json&delay=1500&cc=no-store',
    leaky ? undefined : { signal: life.signal })
    .then((r) => r.json())
    .then(() => {
      // Writing into a node that may already be detached, and touching `state`, keeping it alive
      // until the request settles.
      output.textContent = `loaded, payload ${state.blob.length}`;
    })
    .catch((err) => { if (err.name !== 'AbortError') log.bad(err.message); });

  return () => { life.dispose(); if (!leaky) componentRegistry.delete(state); };
}

// ---------------------------------------------------------------------------
// The router
// ---------------------------------------------------------------------------

const ROUTES = { dashboard: Dashboard, list: ListRoute, detail: Detail };
let unmountCurrent = null;
const routeCache = new Map();          // LEAK 5 (leaky mode): "keep mounted routes for speed"

function navigate(name) {
  const mode = $('mode').value;
  unmountCurrent?.();
  const screen = $('#screen');
  screen.textContent = '';
  const el = document.createElement('div');
  screen.append(el);
  unmountCurrent = ROUTES[name](el, mode);
  if (mode === 'leaky') routeCache.set(`${name}-${Math.random()}`, el);   // never evicted
}

$$('nav button').forEach((b) => on(b, 'click', () => navigate(b.dataset.route)));

// ---------------------------------------------------------------------------

on('auto', async () => {
  const mode = $('mode').value;
  const n = Number($('cycles').value);
  log.head(`— ${mode}: ${n} navigations —`);
  const before = { ...counters, heap: performance.memory?.usedJSHeapSize ?? 0 };
  const names = Object.keys(ROUTES);
  for (let i = 0; i < n; i++) {
    navigate(names[i % names.length]);
    await sleep(30);
  }
  // Let the leaked intervals tick and the fetches land.
  await sleep(1500);
  store.set({ user: { name: `ada-${Date.now()}` } });      // one store update
  await sleep(200);

  const heap = performance.memory?.usedJSHeapSize ?? 0;
  rows.push({
    mode,
    navigations: n,
    'store subscribers': store.subscribers.size,
    'resize listeners (approx)': mode === 'leaky' ? 'grows' : 'constant',
    'interval ticks in 1.5s': counters.intervals - before.intervals,
    'components still registered': componentRegistry.size,
    'heap growth': fmt.bytes(heap - before.heap),
  });
  renderTable('#results', rows, {
    columns: ['mode', 'navigations', 'store subscribers', 'interval ticks in 1.5s',
      'components still registered', 'heap growth'],
  });
  log.line(`${mode}: ${store.subscribers.size} store subscribers, ${componentRegistry.size} live ` +
    `components, heap +${fmt.bytes(heap - before.heap)}`, mode === 'leaky' ? 'bad' : 'good');

  out.textContent = mode === 'leaky'
    ? 'Every counter grows linearly with navigation count.\n\n' +
      '  store subscribers — every List route ever mounted is still notified on every store update\n' +
      '  interval ticks    — every Dashboard ever mounted is still polling\n' +
      '  components        — nothing was ever released\n\n' +
      'None of this is the framework failing to unmount. The framework removed the DOM correctly.\n' +
      'What it cannot do is retract the references you handed to things it does not own: window,\n' +
      'the store, the timer queue, an in-flight request.'
    : 'Every counter is flat. One lifecycle per component, one dispose() on unmount, and all five\n' +
      'leaks are structurally impossible rather than individually remembered.\n\n' +
      'Note what did NOT change: the components, the store, the router. Only where cleanup lives.';
});

on('measure', () => {
  log.line(`store subscribers: ${store.subscribers.size} · registered components: ` +
    `${componentRegistry.size} · route cache: ${routeCache.size} · interval ticks: ${counters.intervals}`,
    'macro');
});

on('reload', () => location.reload());

navigate('dashboard');
