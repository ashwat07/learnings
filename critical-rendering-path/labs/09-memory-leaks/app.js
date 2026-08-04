// Lab 09 — Memory leaks.
//
// All six leaks are IMPLEMENTED (they work — that is, they leak). Your job is to
// diagnose each with heap snapshots, write down its retainer chain, then fix it here.
// The fix TODOs are inline next to each leak, and the Disposable exercise is at the bottom.

PerfHUD.start();

const out = document.getElementById('out');
const sink = document.getElementById('sink');
const statusBody = document.querySelector('#status tbody');

const LEAKS = {
  nodeFlood: { desc: 'DOM nodes appended forever, all reachable from the document', on: false },
  detachedTree: { desc: 'a removed 5,000-node subtree, still referenced from an array', on: false },
  intervalClosure: { desc: 'setInterval closure retaining a 4MB buffer per "component"', on: false },
  windowListener: { desc: 'resize handler on window retaining an unmounted component', on: false },
  unboundedCache: { desc: 'Map cache keyed by object, no eviction', on: false },
  observerLeak: { desc: 'ResizeObserver observing detached nodes, never disconnected', on: false },
};

// Deliberately global so it shows up clearly as a GC root in your snapshots.
window.leakHandles = {
  nodeFloodTimer: null,
  detachedTrees: [],
  components: [],
  cache: new Map(),
  observers: [],
};

function bigBuffer(mb = 4) {
  // A typed array is easy to spot in a snapshot and hard for the engine to elide.
  const buf = new Float64Array((mb * 1024 * 1024) / 8);
  buf[0] = Math.random();
  return buf;
}

// ---------------------------------------------------------------------------
// LEAK 1 — node flood. The classic. Nothing here is "wrong" in the reachability sense;
// the bug is that it grows without bound and nobody ever removes anything.
//
// TODO fix: keep the sink bounded (a ring buffer of N nodes), and note that the correct
// fix here is a PRODUCT decision (how many do we keep?) rather than a memory trick.
// ---------------------------------------------------------------------------
function startNodeFlood() {
  window.leakHandles.nodeFloodTimer = setInterval(() => {
    for (let i = 0; i < 20; i++) sink.appendChild(document.createElement('div'));
  }, 100);
  return () => clearInterval(window.leakHandles.nodeFloodTimer);
}

// ---------------------------------------------------------------------------
// LEAK 2 — detached tree. "I removed it from the DOM, so it's gone." It is not.
// One reference to the root retains the whole subtree, its attributes, and its listeners.
//
// TODO fix: after removing, drop the reference. Then prove with the Memory tab's
// "Detached elements" view that the nodes are gone.
// Also answer: why does holding the ROOT retain all 5,000 nodes?
// ---------------------------------------------------------------------------
function startDetachedLeak() {
  const timer = setInterval(() => {
    const root = document.createElement('div');
    for (let i = 0; i < 5000; i++) {
      const child = document.createElement('span');
      child.textContent = `detached-${i}`;
      child.addEventListener('click', () => console.log('never fires', root.childElementCount));
      root.appendChild(child);
    }
    document.body.appendChild(root);
    root.remove();                              // detached…
    window.leakHandles.detachedTrees.push(root); // …but still reachable. This is the bug.
  }, 1000);
  return () => clearInterval(timer);
}

// ---------------------------------------------------------------------------
// LEAK 3 — interval closure. A "component" is discarded, but its interval is not, and the
// interval's closure retains the component's data. The timer itself is a GC root.
//
// TODO fix: return a teardown from the component and call it on unmount.
// Then answer: does setTimeout have the same problem? What about a pending fetch?
// ---------------------------------------------------------------------------
function makeComponent(id) {
  const buffer = bigBuffer(4);
  const state = { id, buffer, mountedAt: performance.now() };
  setInterval(() => {
    // Uses `state`, so `state` — and therefore the 4MB buffer — can never be collected.
    state.ticks = (state.ticks || 0) + 1;
  }, 500);
  return state;
}

function startIntervalClosureLeak() {
  const timer = setInterval(() => {
    // "Mount" a component and immediately throw the reference away. The interval keeps it alive.
    makeComponent(window.leakHandles.components.length);
  }, 1000);
  return () => clearInterval(timer);
}

// ---------------------------------------------------------------------------
// LEAK 4 — listener on a long-lived target. `window` is a GC root, so the handler is
// permanently reachable, so its closure is too, so the component is too, so its DOM is too.
//
// TODO fix: AbortController + signal, and one abort() on unmount. See the README hint.
// ---------------------------------------------------------------------------
function startWindowListenerLeak() {
  const timer = setInterval(() => {
    const el = document.createElement('div');
    el.innerHTML = '<span>'.repeat(200) + 'panel' + '</span>'.repeat(200);
    const buffer = bigBuffer(2);
    const onResize = () => { el.dataset.w = innerWidth; buffer[0] = innerWidth; };
    window.addEventListener('resize', onResize);   // never removed
    document.body.appendChild(el);
    el.remove();                                   // "unmounted"
  }, 1000);
  return () => clearInterval(timer);
}

// ---------------------------------------------------------------------------
// LEAK 5 — unbounded cache. Every memoization is a leak with good PR.
//
// TODO fix (two parts):
//   a) rewrite with WeakMap and explain why that works
//   b) then explain why WeakMap is NOT a general fix — what if the key were a string?
//      Implement an LRU with a max size for that case.
// ---------------------------------------------------------------------------
function startCacheLeak() {
  const timer = setInterval(() => {
    for (let i = 0; i < 50; i++) {
      const key = { id: `${Date.now()}-${i}` };     // a fresh object key every time
      window.leakHandles.cache.set(key, bigBuffer(0.05));
    }
  }, 200);
  return () => clearInterval(timer);
}

// ---------------------------------------------------------------------------
// LEAK 6 — observers. An observer holds strong references to what it observes, and the
// registry holds the observer.
//
// TODO fix: disconnect() on teardown. Then check whether unobserve() on each element is
// enough, and whether an observer with no observed elements is itself collectable.
// ---------------------------------------------------------------------------
function startObserverLeak() {
  const timer = setInterval(() => {
    const el = document.createElement('div');
    el.style.height = '40px';
    document.body.appendChild(el);
    const ro = new ResizeObserver(() => { el.dataset.seen = '1'; });
    ro.observe(el);
    const io = new IntersectionObserver(() => {}, { threshold: 0.5 });
    io.observe(el);
    window.leakHandles.observers.push(ro, io);
    el.remove();                                   // detached, but observed
  }, 1000);
  return () => clearInterval(timer);
}

// ---------------------------------------------------------------------------

const starters = {
  nodeFlood: startNodeFlood,
  detachedTree: startDetachedLeak,
  intervalClosure: startIntervalClosureLeak,
  windowListener: startWindowListenerLeak,
  unboundedCache: startCacheLeak,
  observerLeak: startObserverLeak,
};
const stoppers = {};

function renderStatus() {
  statusBody.innerHTML = Object.entries(LEAKS).map(([key, l]) =>
    `<tr><td>${key}</td><td class="${l.on ? 'on' : 'off'}">${l.on ? 'LEAKING' : 'off'}</td>` +
    `<td>${l.desc}</td></tr>`).join('');
}

function stats() {
  const mem = performance.memory;
  out.textContent = [
    `DOM nodes:        ${document.getElementsByTagName('*').length.toLocaleString()}`,
    `sink children:    ${sink.children.length.toLocaleString()}`,
    `detached trees:   ${window.leakHandles.detachedTrees.length}`,
    `cache entries:    ${window.leakHandles.cache.size.toLocaleString()}`,
    `observers:        ${window.leakHandles.observers.length}`,
    mem ? `JS heap:          ${(mem.usedJSHeapSize / 1048576).toFixed(1)} MB used / ` +
          `${(mem.totalJSHeapSize / 1048576).toFixed(1)} MB total ` +
          `(coarse — use the Memory tab for real numbers)`
        : 'JS heap:          performance.memory unavailable in this browser',
    typeof gc === 'function'
      ? 'gc() is available — call it, then read stats again.'
      : 'gc() unavailable. Launch Chrome with --js-flags="--expose-gc", or use the 🗑 in the Memory tab.',
  ].join('\n');
}
setInterval(stats, 1000);

document.querySelectorAll('button[data-leak]').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.leak;
    if (LEAKS[key].on) {
      stoppers[key]?.();
      delete stoppers[key];
      LEAKS[key].on = false;
      btn.setAttribute('aria-pressed', 'false');
    } else {
      stoppers[key] = starters[key]() || (() => {});
      LEAKS[key].on = true;
      btn.setAttribute('aria-pressed', 'true');
    }
    renderStatus();
  });
});

document.getElementById('stopAll').addEventListener('click', () => {
  for (const key of Object.keys(stoppers)) { stoppers[key](); delete stoppers[key]; LEAKS[key].on = false; }
  document.querySelectorAll('button[data-leak]').forEach(b => b.setAttribute('aria-pressed', 'false'));
  renderStatus();
  out.textContent = 'stopped all leaks. Note that STOPPING is not FREEING —\n' +
    'take a snapshot: everything already leaked is still reachable via window.leakHandles.';
});

/** Mount + unmount churn, which is how leaks actually manifest in an SPA. */
document.getElementById('churn').addEventListener('click', () => {
  for (let i = 0; i < 100; i++) {
    const el = document.createElement('section');
    el.innerHTML = '<div><span>row</span></div>'.repeat(50);
    const onScroll = () => el.dataset.y = scrollY;
    window.addEventListener('scroll', onScroll);      // TODO: this is the bug — fix with a signal
    document.body.appendChild(el);
    el.remove();
  }
  out.textContent = 'churned 100 mount/unmount cycles.\n' +
    'Now: snapshot → Memory tab → "Detached elements". How many are retained, and by what?';
});

document.getElementById('stats').addEventListener('click', stats);
renderStatus();
stats();

// ---------------------------------------------------------------------------
// TODO — the Disposable exercise (do this AFTER fixing all six individually).
//
// Build one small helper and refactor every leak above to use it. This is the thing that
// actually prevents leaks in a real codebase, because it makes teardown the default rather
// than an act of discipline.
//
//   class Disposable {
//     // collects: AbortController signals, timers, observers, subscriptions
//     signal                       // pass to addEventListener({ signal })
//     setInterval(fn, ms)          // auto-cleared
//     setTimeout(fn, ms)
//     observe(observer, target)    // auto-disconnected
//     add(cleanupFn)               // anything else
//     dispose()                    // idempotent; safe to call twice
//     get disposed()               // so async work can bail out after teardown
//   }
//
// Requirements worth thinking about:
//   · dispose() must be idempotent and must not throw if one cleanup throws
//   · an async continuation that resolves after dispose() must not touch the DOM
//   · nesting: a child Disposable disposed by its parent
//   · a dev-mode warning if a Disposable is garbage-collected without dispose() having been
//     called — this is a legitimate use of FinalizationRegistry as a DEBUGGING tool.
//     Write down why it must never be used for the cleanup itself.
// ---------------------------------------------------------------------------
