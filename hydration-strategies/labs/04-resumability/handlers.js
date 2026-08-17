// The handlers a resumable page refers to by URL.
//
// The key property: this module is not loaded on page load. It is loaded the first time an event
// needs it — the reference in the HTML is enough for the page to be "interactive" without it.

const HEAVY = 'x'.repeat(40_000);          // stands in for real component code

export function increment(el, state, event) {
  state.count = (state.count ?? 0) + 1;
  render(el, state);
  return state;
}

export function decrement(el, state) {
  state.count = Math.max(0, (state.count ?? 0) - 1);
  render(el, state);
  return state;
}

export function reset(el, state) {
  state.count = 0;
  render(el, state);
  return state;
}

function render(el, state) {
  const out = el.closest('[data-component]')?.querySelector('[data-value]');
  if (out) out.textContent = String(state.count);
}

export const size = HEAVY.length;
