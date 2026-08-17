// Lab 02 — Listener leaks.

import { $, on, Log, renderTable, fmt, sleep } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
const rows = [];

// A counter that survives everything, so we can see how many dead components still react.
let scrollReactions = 0;
let liveComponents = 0;

// ---------------------------------------------------------------------------
// A "component" that holds a chunk of state and listens to the window.
// ---------------------------------------------------------------------------

class Widget {
  constructor(id, { signal } = {}) {
    this.id = id;
    // Something big enough to be visible in a heap snapshot.
    this.state = { rows: Array.from({ length: 2000 }, (_, i) => ({ i, text: `row ${i} of widget ${id}` })) };
    this.el = document.createElement('div');
    this.el.textContent = `widget ${id}`;

    this.onScroll = () => { scrollReactions++; this.recompute(); };
    this.onResize = () => this.recompute();

    // The `signal` option is the fix. Passing it makes abort() remove the listener.
    window.addEventListener('scroll', this.onScroll, signal ? { signal } : undefined);
    window.addEventListener('resize', this.onResize, signal ? { signal } : undefined);
    document.addEventListener('keydown', this.onResize, signal ? { signal } : undefined);
    liveComponents++;
  }

  recompute() {
    // Touch the state so the closure genuinely retains it.
    return this.state.rows.length;
  }

  destroyNothing() {
    this.el.remove();                 // the DOM is gone…
    liveComponents--;                 // …and the listeners, closures and 2000 rows are not
  }

  destroyManually() {
    this.el.remove();
    window.removeEventListener('scroll', this.onScroll);
    window.removeEventListener('resize', this.onResize);
    // Deliberately forgotten — the third one. This is what "cleanup by hand" looks like in
    // practice: two of three, and nobody notices for a year.
    liveComponents--;
  }
}

// ---------------------------------------------------------------------------

const kept = [];          // simulates a router keeping mounted components in a list

async function cycle(mode) {
  const n = Number($('n').value);
  scrollReactions = 0;
  log.head(`— ${mode} × ${n} —`);

  for (let i = 0; i < n; i++) {
    if (mode === 'C. AbortController') {
      const ac = new AbortController();
      const w = new Widget(i, { signal: ac.signal });
      document.body.append(w.el);
      await sleep(0);
      w.el.remove();
      ac.abort();                      // ← every listener registered with this signal, gone
      liveComponents--;
    } else {
      const w = new Widget(i);
      document.body.append(w.el);
      await sleep(0);
      if (mode.startsWith('B')) w.destroyManually();
      else w.destroyNothing();
      if (mode.startsWith('A')) kept.push(w.onScroll);   // keep the fn so it stays reachable
    }
  }

  await measure(mode);
}

async function measure(label) {
  await sleep(100);
  scrollReactions = 0;
  window.dispatchEvent(new Event('scroll'));
  await sleep(0);

  const mem = performance.memory;
  rows.push({
    run: label,
    'handlers that fired on one scroll': scrollReactions,
    'JS heap': mem ? fmt.bytes(mem.usedJSHeapSize) : 'n/a',
  });
  renderTable('#results', rows, {
    columns: ['run', 'handlers that fired on one scroll', 'JS heap'],
  });
  log.line(`${label}: one scroll event ran ${scrollReactions} handler(s)`,
    scrollReactions > 1 ? 'bad' : 'good');
}

on('leak', () => cycle('A. no cleanup').then(() => {
  out.textContent =
    'One scroll event just ran every handler from every "unmounted" component.\n\n' +
    'Two costs, and the second is usually the one that gets noticed first:\n' +
    '  MEMORY — each handler closes over its widget, which holds 2,000 rows and a DOM element.\n' +
    '  CPU    — every scroll, resize and keypress runs N dead handlers. The page gets measurably\n' +
    '           slower the longer the session lasts, which users describe as "it degrades".\n\n' +
    'In a heap snapshot the retainer chain is: your object ← context ← EventListener ← Window.\n' +
    'In the Elements panel, the Event Listeners tab on <html>/window shows the count directly.\n' +
    'In the console: getEventListeners(window).scroll.length';
}));

on('manual', () => cycle('B. manual cleanup (one forgotten)').then(() => {
  out.textContent =
    'Better — but the keydown listener was never removed, because manual cleanup means writing\n' +
    'the same list twice and keeping them in sync forever.\n\n' +
    'The ways manual cleanup goes wrong, all of them common:\n' +
    '  • removeEventListener with a DIFFERENT function reference (an inline arrow, or .bind(this)\n' +
    '    called twice) silently removes nothing — there is no error and no return value\n' +
    '  • options must match on the `capture` flag, or it does not match the registration\n' +
    '  • the cleanup runs on the happy path only, and not when the component throws while mounting\n' +
    '  • someone adds a fourth listener and updates one of the two lists';
}));

on('abort', () => cycle('C. AbortController').then(() => {
  out.textContent =
    'Zero dead handlers. One controller, any number of listeners, one abort().\n\n' +
    'Why this is strictly better than manual removal:\n' +
    '  • you cannot mismatch the function reference — inline arrows are fine\n' +
    '  • you cannot forget one: they all share the signal\n' +
    '  • the same signal aborts in-flight fetch() calls, cancels an AbortSignal.timeout, and is\n' +
    '    accepted by many other APIs — one cancellation token for the whole component\n' +
    '  • it composes: AbortSignal.any([parentSignal, ownSignal]) ties a child\'s lifetime to its\n' +
    '    parent\'s\n\n' +
    'Make it the house rule: every addEventListener on anything longer-lived than the element\n' +
    'itself takes a signal. It is one extra argument and it deletes this entire class of bug.';
}));

on('count', async () => {
  await measure('manual check');
  log.muted('In the console, run: getEventListeners(window) — it shows every listener, grouped by ' +
    'type, with its handler. Chrome-only, DevTools-only, and the fastest listener-leak check ' +
    'there is.');
  log.muted('Elements panel → select <html> → Event Listeners tab, with "Ancestors" ticked, shows ' +
    'the same thing for a node.');
});

on('reset', () => {
  kept.length = 0;
  rows.length = 0;
  renderTable('#results', rows);
  location.reload();
});
