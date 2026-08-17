// A module with a SIDE EFFECT at import time.
//
// This is the thing that defeats tree-shaking: a bundler cannot remove a module whose mere
// evaluation does something observable, even if none of its exports are used. Marking it in
// package.json "sideEffects" (or removing the side effect) is the fix.

const queue = [];

// ← the side effect: this runs on import, so the module can never be dropped.
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    queue.push({ type: 'pageview', at: Date.now() });
  });
}

export function track(event, data) {
  queue.push({ event, data, at: Date.now() });
}

export const flush = () => queue.splice(0, queue.length);
