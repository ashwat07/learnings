/**
 * fake-server.js — a simulated remote API.
 *
 * Deliberately local: the point of this lab is the CLIENT data layer, and a local fake lets you
 * make the server slow, flaky, and conflicted on demand — which is exactly the environment your
 * sync code has to survive and exactly what you cannot reproduce against a real backend.
 *
 * State lives in sessionStorage so it survives a page reload but not a new tab, which makes
 * "the server changed while you were offline" easy to stage.
 */

const KEY = 'lab06-server-state';

const load = () => {
  try { return JSON.parse(sessionStorage.getItem(KEY)) || { items: {}, rev: 0 }; }
  catch { return { items: {}, rev: 0 }; }
};
const save = (s) => sessionStorage.setItem(KEY, JSON.stringify(s));

export const config = {
  latencyMs: 400,
  failRate: 0,          // 0..1 — fraction of requests that fail with a 503-ish error
  offline: false,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function trip() {
  await sleep(config.latencyMs);
  if (config.offline) throw new TypeError('Failed to fetch (simulated offline)');
  if (Math.random() < config.failRate) {
    const err = new Error('server error');
    err.status = 503;
    throw err;
  }
}

export const server = {
  /** Everything changed since `sinceRev` — the shape a real sync endpoint should have. */
  async changesSince(sinceRev = 0) {
    await trip();
    const state = load();
    const changed = Object.values(state.items).filter((i) => i.rev > sinceRev);
    return { rev: state.rev, changed };
  },

  async upsert(item, { ifRev } = {}) {
    await trip();
    const state = load();
    const existing = state.items[item.id];

    // Optimistic concurrency: the client says which revision it based its change on.
    // If the server has moved on, that is a conflict — the whole reason sync is hard.
    if (existing && ifRev != null && existing.rev !== ifRev) {
      const err = new Error('conflict');
      err.status = 409;
      err.current = existing;
      throw err;
    }

    state.rev += 1;
    state.items[item.id] = { ...item, rev: state.rev, deleted: false };
    save(state);
    return state.items[item.id];
  },

  async remove(id, { ifRev } = {}) {
    await trip();
    const state = load();
    const existing = state.items[id];
    if (existing && ifRev != null && existing.rev !== ifRev) {
      const err = new Error('conflict');
      err.status = 409;
      err.current = existing;
      throw err;
    }
    state.rev += 1;
    state.items[id] = { id, rev: state.rev, deleted: true };
    save(state);
    return state.items[id];
  },

  /** Test helper: change something behind the client's back. */
  async mutateBehindTheScenes(id, text) {
    const state = load();
    state.rev += 1;
    state.items[id] = { ...(state.items[id] || { id }), text, rev: state.rev, deleted: false };
    save(state);
    return state.items[id];
  },

  reset() { sessionStorage.removeItem(KEY); },
  snapshot() { return load(); },
};
