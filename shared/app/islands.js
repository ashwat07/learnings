/**
 * islands.js — a 60-line islands implementation.
 *
 * The idea: server-rendered HTML is already correct and visible. The only JavaScript that has to
 * run is whatever makes the *interactive* bits interactive — the islands. Everything else ships
 * no JS at all.
 *
 * Compare with a full hydration pass, which walks the entire tree to attach behaviour to markup
 * it has just reproduced in memory. That walk is what shows up as TBT.
 *
 * Strategies, chosen per island with data-hydrate:
 *   load        immediately (default)
 *   idle        in requestIdleCallback
 *   visible     when it scrolls into view (IntersectionObserver)
 *   interaction on first pointerover/focus/click — the lightest of all, because most islands
 *               are never touched
 */

const REGISTRY = {
  'add-to-cart': (el) => {
    let count = 0;
    const label = el.textContent;
    el.addEventListener('click', () => {
      count++;
      el.textContent = `${label} (${count})`;
      el.animate?.([{ transform: 'scale(1)' }, { transform: 'scale(0.94)' }, { transform: 'scale(1)' }],
        { duration: 160 });
    });
  },
};

/** Deliberate work per island, so hydration cost is visible rather than theoretical. */
function simulateFrameworkWork(cost) {
  const end = performance.now() + cost;
  let x = 0;
  while (performance.now() < end) x += Math.sqrt(x + 1);
  return x;
}

export function hydrateIsland(el, { cost = 0 } = {}) {
  if (el.dataset.hydrated) return;
  const name = el.dataset.island;
  const init = REGISTRY[name];
  if (!init) return;
  if (cost) simulateFrameworkWork(cost);
  init(el);
  el.dataset.hydrated = '1';
  performance.mark('island:hydrated');
}

export function hydrateIslands(root = document, { cost = 0, strategy } = {}) {
  const islands = [...root.querySelectorAll('[data-island]')];
  performance.mark('hydration:start');

  for (const el of islands) {
    const how = strategy || el.dataset.hydrate || 'load';

    if (how === 'load') {
      hydrateIsland(el, { cost });
    } else if (how === 'idle') {
      (globalThis.requestIdleCallback || setTimeout)(() => hydrateIsland(el, { cost }), { timeout: 2000 });
    } else if (how === 'visible') {
      new IntersectionObserver((entries, obs) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          hydrateIsland(e.target, { cost });
          obs.unobserve(e.target);
        }
      }, { rootMargin: '200px' }).observe(el);
    } else if (how === 'interaction') {
      // The island is interactive from the user's point of view before any of its code has run:
      // the first event is captured, hydration happens, and the event is replayed.
      const events = ['pointerover', 'focusin', 'click'];
      const once = (event) => {
        for (const t of events) el.removeEventListener(t, once, true);
        hydrateIsland(el, { cost });
        if (event.type === 'click') el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      };
      for (const t of events) el.addEventListener(t, once, true);
    }
  }

  performance.mark('hydration:end');
  performance.measure('js:hydrate', 'hydration:start', 'hydration:end');
  return islands.length;
}

/**
 * Auto-hydrate when this module is the page's bootstrap (a server-rendered page). A renderer
 * that produces its own DOM (client.js, rsc-client.js) sets __noAutoHydrate first and calls
 * hydrateIslands() itself once the markup exists.
 *
 * `?hydrationCost=5` adds 5ms of synthetic work per island, so you can see what a real
 * framework's per-component hydration costs without needing a real framework.
 * `?hydrate=visible|idle|interaction` overrides the strategy for every island at once.
 */
if (!globalThis.__noAutoHydrate) {
  const q = new URLSearchParams(location.search);
  hydrateIslands(document, {
    cost: Number(q.get('hydrationCost') || 0),
    strategy: q.get('hydrate') || undefined,
  });
}
