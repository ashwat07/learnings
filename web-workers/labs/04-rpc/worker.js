// Lab 04 — the exposed API.
//
// Note what this file does NOT contain: no message plumbing, no ids, no switch statement.
// That is the whole point of an RPC layer — the worker looks like a module.

import { expose } from './rpc.js';

// Long-lived state lives HERE, not on the main thread. Messages carry queries, not data.
let index = null;

class NotFoundError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'NotFoundError';
    this.code = code;
  }
}

expose({
  /** Build a searchable index once; every later call reuses it. */
  async load(url) {
    const t0 = performance.now();
    const data = await (await fetch(url)).json();
    index = data.rows.map((r) => ({ id: r.id, name: r.name, team: r.team, score: r.score }));
    return { rows: index.length, ms: performance.now() - t0 };
  },

  /** A query in, a small result out — the right shape for a worker boundary. */
  search(q, limit = 20) {
    if (!index) throw new NotFoundError('call load() first', 'NO_INDEX');
    const needle = String(q).toLowerCase();
    const hits = [];
    for (const row of index) {
      if (row.name.includes(needle) || row.team.includes(needle)) {
        hits.push(row);
        if (hits.length >= limit) break;
      }
    }
    return hits;
  },

  /** Deliberately slow, for the cancellation TODO. */
  async count(predicateSource, onProgress) {
    if (!index) throw new NotFoundError('call load() first', 'NO_INDEX');
    // eslint-disable-next-line no-new-func
    const predicate = new Function('row', `return ${predicateSource}`);
    let n = 0;
    for (let i = 0; i < index.length; i++) {
      if (predicate(index[i])) n++;
      if ((i & 16383) === 0) {
        await new Promise((r) => setTimeout(r, 0));
        // onProgress is a function — it cannot be cloned, so this call currently throws on the
        // page side before it ever gets here. That is TODO 3.
        onProgress?.(i / index.length);
      }
    }
    return n;
  },

  /** Returns a big buffer, to exercise the transfer TODOs. */
  makeBuffer(elements) {
    const arr = new Float64Array(elements);
    for (let i = 0; i < arr.length; i++) arr[i] = i * 1.5;
    return arr.buffer;
  },

  /** Throws a custom error, to exercise the error-propagation TODO. */
  boom() {
    throw new NotFoundError('nothing here', 'E_NOPE');
  },
});
