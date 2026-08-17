/**
 * instrument.js — the measurement layer every React lab shares.
 *
 * Two things it provides:
 *   useRenderCount(name) — how many times a component has rendered, and why it is worth knowing
 *   renderLog            — a global tally the labs display, so "did that click re-render the
 *                          whole list?" is a number rather than an impression
 *
 * React's own Profiler and DevTools give you richer data; this exists so the answer is visible
 * ON THE PAGE while you work, which changes how you write the code.
 */
import { useRef, useEffect } from 'react';

export const renderLog = {
  counts: new Map(),
  listeners: new Set(),
  bump(name) {
    this.counts.set(name, (this.counts.get(name) ?? 0) + 1);
    // Notify asynchronously: mutating subscriber state during render is exactly the bug this
    // module exists to help you find.
    queueMicrotask(() => { for (const l of this.listeners) l(this.counts); });
  },
  reset() { this.counts.clear(); for (const l of this.listeners) l(this.counts); },
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  total() { return [...this.counts.values()].reduce((a, b) => a + b, 0); },
};

export function useRenderCount(name) {
  const count = useRef(0);
  count.current++;
  renderLog.bump(name);
  return count.current;
}

/** Which prop changed since the last render — the question the profiler makes you infer. */
export function useWhyDidYouRender(name, props) {
  const prev = useRef(props);
  useEffect(() => {
    const changed = {};
    for (const key of new Set([...Object.keys(prev.current), ...Object.keys(props)])) {
      if (!Object.is(prev.current[key], props[key])) {
        changed[key] = { from: prev.current[key], to: props[key] };
      }
    }
    if (Object.keys(changed).length) {
      // eslint-disable-next-line no-console
      console.log(`[why] ${name} re-rendered because:`, changed);
    }
    prev.current = props;
  });
}

/** Deliberate CPU, so "this component is expensive" is true rather than hypothetical. */
export function burn(ms) {
  const end = performance.now() + ms;
  let x = 0;
  while (performance.now() < end) x += Math.sqrt(x + 1);
  return x;
}
