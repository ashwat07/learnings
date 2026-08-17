/**
 * resume.js — a ~30-line resumability runtime.
 *
 * The whole idea: the server writes, into the HTML, *which function* handles *which event* on
 * *which element*, plus the state that function will need. The client ships one small global
 * listener and nothing else. No component code runs on load — not to attach handlers, not to
 * rebuild a tree, not at all.
 *
 * Markup the server produces:
 *
 *   <div data-component data-state='{"count":3}'>
 *     <span data-value>3</span>
 *     <button data-on-click="./handlers.js#increment">+</button>
 *   </div>
 *
 * Compare with hydration, which must re-execute the component in order to discover that the
 * button has an onClick and what it closes over. Resumability replaces that discovery with a
 * lookup, because the server already knew the answer and wrote it down.
 */

const loaded = new Map();

/** One listener, in the capture phase, for the whole document. */
for (const type of ['click', 'input', 'change', 'submit']) {
  document.addEventListener(type, async (event) => {
    const el = event.target.closest?.(`[data-on-${type}]`);
    if (!el) return;

    const ref = el.dataset[`on${type[0].toUpperCase()}${type.slice(1)}`];
    const [modulePath, exportName] = ref.split('#');

    const t0 = performance.now();
    if (!loaded.has(modulePath)) loaded.set(modulePath, import(modulePath));
    const mod = await loaded.get(modulePath);
    const importedAt = performance.now();

    // State is deserialised from the DOM at the moment it is needed — not rebuilt on load.
    const host = el.closest('[data-state]') ?? el;
    const state = JSON.parse(host.dataset.state || '{}');

    const next = mod[exportName](el, state, event);
    if (next) host.dataset.state = JSON.stringify(next);

    performance.mark('resume:handled');
    document.dispatchEvent(new CustomEvent('resume:handled', {
      detail: {
        ref,
        importMs: importedAt - t0,
        totalMs: performance.now() - t0,
        cached: importedAt - t0 < 2,
      },
    }));
  }, true);
}

performance.mark('resume:ready');
document.documentElement.dataset.resumable = 'ready';
