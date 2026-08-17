// Lab 03 — Lazy & progressive hydration.

import { $, on, Log, renderTable, fmt, sleep, busy } from '/shared/lab-ui.js';

PerfHUD.start({ note: 'lazy hydration' });

const log = new Log('#log');
const out = $('out');
const grid = $('#grid');
const rows = [];

let firstInteractionLatency = null;
let hydratedCount = 0;

function build() {
  grid.textContent = '';
  hydratedCount = 0;
  firstInteractionLatency = null;
  const n = Number($('n').value);
  for (let i = 0; i < n; i++) {
    const b = document.createElement('button');
    b.textContent = `component ${i}`;
    b.dataset.component = String(i);
    grid.append(b);
  }
  log.muted(`built ${n} server-rendered components (no behaviour attached)`);
}

/** Attach behaviour, paying the synthetic per-component cost. */
function hydrate(el, cost) {
  if (el.dataset.hydrated) return;
  if (cost) busy(cost);
  el.addEventListener('click', () => {
    el.textContent = `${el.textContent.split(' (')[0]} (clicked)`;
  });
  el.dataset.hydrated = '1';
  hydratedCount++;
}

function record(strategy, { onLoadMs, hydratedOnLoad, note }) {
  rows.push({
    strategy,
    'blocking ms on load': Math.round(onLoadMs),
    'hydrated on load': hydratedOnLoad,
    'first interaction latency': firstInteractionLatency == null ? 'not measured yet'
      : `${Math.round(firstInteractionLatency)}ms`,
    note,
    _blockingClass: onLoadMs > 200 ? 'no' : onLoadMs > 50 ? 'meh' : 'ok',
  });
  renderTable('#results', rows, {
    columns: ['strategy', 'blocking ms on load', 'hydrated on load', 'first interaction latency', 'note'],
  });
}

const cost = () => Number($('cost').value);
const all = () => [...grid.children];

// ---------------------------------------------------------------------------

on('s-load', async () => {
  build();
  log.head('— load: hydrate everything immediately —');
  const t0 = performance.now();
  for (const el of all()) hydrate(el, cost());
  const ms = performance.now() - t0;
  record('load', { onLoadMs: ms, hydratedOnLoad: hydratedCount, note: 'one long task; nothing works until it ends' });
  log.line(`${fmt.ms(ms)} of blocking work`, ms > 200 ? 'bad' : 'good');
  out.textContent =
    'The baseline. Everything is interactive as soon as the task ends — and nothing is interactive\n' +
    'until then, including the parts the user is looking at.';
});

on('s-idle', async () => {
  build();
  log.head('— idle: requestIdleCallback —');
  const t0 = performance.now();
  let done = 0;
  const step = (deadline) => {
    while (done < all().length && (deadline.timeRemaining() > cost() || deadline.didTimeout)) {
      hydrate(all()[done++], cost());
    }
    if (done < all().length) requestIdleCallback(step, { timeout: 2000 });
    else log.ok(`all ${done} hydrated across idle slices, ${fmt.ms(performance.now() - t0)} wall`);
  };
  requestIdleCallback(step, { timeout: 2000 });
  await sleep(60);
  record('idle', { onLoadMs: performance.now() - t0, hydratedOnLoad: hydratedCount,
    note: 'spread across idle time; unpredictable under load' });
  out.textContent =
    'Hydration is chopped into idle slices, so it stops being one long task — TBT drops sharply\n' +
    'even though the total work is identical.\n\n' +
    'The catch (from the event-loop course, lab 07): requestIdleCallback has no SLA. On a busy\n' +
    'page it can be starved indefinitely, and the `timeout` option is what converts "maybe never"\n' +
    'into "at the latest, then". Without a timeout, a component may simply never become\n' +
    'interactive — which is a correctness bug, not a performance one.';
});

on('s-visible', async () => {
  build();
  log.head('— visible: IntersectionObserver —');
  const t0 = performance.now();
  const io = new IntersectionObserver((entries, obs) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      hydrate(e.target, cost());
      obs.unobserve(e.target);
    }
  }, { root: grid, rootMargin: '100px' });
  for (const el of all()) io.observe(el);
  await sleep(120);

  record('visible', { onLoadMs: performance.now() - t0, hydratedOnLoad: hydratedCount,
    note: 'only what is on screen; scroll to hydrate more' });
  log.line(`${hydratedCount} of ${all().length} hydrated — the rest are off screen`, 'good');
  out.textContent =
    'Only the components actually on screen were hydrated. Scroll the grid and watch the rest turn\n' +
    'green as they arrive.\n\n' +
    'This is usually the best default for content pages: cost is proportional to what the user\n' +
    'actually sees, and the rootMargin gives you a head start so hydration finishes before the\n' +
    'component is really visible.\n\n' +
    'Two things to get right: use a rootMargin (hydrating exactly at the viewport edge is too\n' +
    'late), and remember that IntersectionObserver callbacks run in the rendering steps — so\n' +
    'hydrating 50 components in one callback is a long task inside a frame. Slice it.';
});

on('s-interaction', async () => {
  build();
  log.head('— interaction: hydrate on first touch —');
  const t0 = performance.now();

  for (const el of all()) {
    const once = (event) => {
      const start = performance.now();
      el.removeEventListener('pointerover', once, true);
      el.removeEventListener('click', once, true);
      hydrate(el, cost());
      if (firstInteractionLatency == null) firstInteractionLatency = performance.now() - start;
      log.line(`hydrated on ${event.type} in ${fmt.ms(performance.now() - start)}`, 'good');
      updateLatencyCell();
    };
    el.addEventListener('pointerover', once, true);
    el.addEventListener('click', once, true);
  }

  record('interaction', { onLoadMs: performance.now() - t0, hydratedOnLoad: 0,
    note: 'zero cost on load; the first touch pays' });
  out.textContent =
    'Zero hydration work on load. Now click a button in the grid — the "first interaction latency"\n' +
    'column fills in with what that click cost.\n\n' +
    'The trade: you moved the cost from load to the interaction, and the interaction is where the\n' +
    'user is watching. For one small component that is a great trade (a few ms). For a component\n' +
    'that pulls in a 90KB module over a slow network, it is a terrible one — the user clicks and\n' +
    'waits.\n\n' +
    'Which is why the good version listens on `pointerover`/`focusin` as well as `click`: hovering\n' +
    'precedes clicking by 100–300ms, and that is usually enough to hide the whole cost. On touch\n' +
    'devices `pointerdown` gives you the ~80ms before `click`. That is the same intent-based idea\n' +
    'as speculative preconnect in the resource-hints course.';
});

on('s-replay', async () => {
  build();
  log.head('— interaction + event replay —');
  for (const el of all()) {
    const once = (event) => {
      const start = performance.now();
      for (const type of ['pointerdown', 'click']) el.removeEventListener(type, once, true);
      hydrate(el, cost());
      if (firstInteractionLatency == null) firstInteractionLatency = performance.now() - start;
      // Replay the event that triggered hydration, so the user's click is not swallowed.
      if (event.type === 'click') {
        event.stopImmediatePropagation();
        el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
      updateLatencyCell();
    };
    for (const type of ['pointerdown', 'click']) el.addEventListener(type, once, true);
  }
  record('interaction + replay', { onLoadMs: 0, hydratedOnLoad: 0,
    note: 'the triggering click is re-dispatched, so nothing is lost' });
  out.textContent =
    'Same as before, but the click that triggered hydration is captured and re-dispatched, so the\n' +
    'component behaves as if it had always been interactive. Click a button: it hydrates AND\n' +
    'registers the click.\n\n' +
    'This is what makes lazy hydration honest. Without replay, the first click is a no-op and the\n' +
    'user clicks again — which is how you get double submissions.\n\n' +
    'Getting it exactly right is finicky: capture in the CAPTURE phase, stop the original\n' +
    'propagation, re-dispatch after hydration, and do not replay events that are not idempotent\n' +
    '(a second `pointerdown` is harmless, a second `submit` is not). Frameworks that do this well\n' +
    '(Qwik, Angular\'s event replay, Astro) all record the event during a global capture listener\n' +
    'installed before any component code exists.';
});

function updateLatencyCell() {
  const last = rows.at(-1);
  if (!last) return;
  last['first interaction latency'] = firstInteractionLatency == null ? 'not measured yet'
    : `${Math.round(firstInteractionLatency)}ms`;
  renderTable('#results', rows, {
    columns: ['strategy', 'blocking ms on load', 'hydrated on load', 'first interaction latency', 'note'],
  });
}

on('reset', () => { rows.length = 0; renderTable('#results', rows); build(); PerfHUD.reset(); log.clear(); });

build();
