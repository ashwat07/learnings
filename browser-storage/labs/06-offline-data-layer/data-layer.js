/**
 * data-layer.js — offline-first reads and writes.
 *
 * Reads are implemented. Writes, the outbox, and conflict handling are yours.
 *
 * The design being aimed at:
 *
 *   read   → local IndexedDB immediately, refresh from the server in the background
 *   write  → apply locally + append to an outbox, resolve immediately (optimistic)
 *   sync   → drain the outbox in order, pull changes since our last known revision,
 *            resolve conflicts by a rule you can state out loud
 */

import { openDB, withStore, req, getAll, putMany } from '/browser-storage/idb.js';
import { server } from './fake-server.js';

const DB = 'lab06';

export async function open() {
  return openDB(DB, 1, (d) => {
    if (!d.objectStoreNames.contains('items')) {
      const items = d.createObjectStore('items', { keyPath: 'id' });
      items.createIndex('by_updated', 'updatedAt');
    }
    if (!d.objectStoreNames.contains('outbox')) {
      // autoIncrement gives us a strict FIFO order for free, which is what an outbox needs.
      d.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
    }
    if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
  });
}

export function createDataLayer(db, { onChange = () => {} } = {}) {
  const listeners = new Set([onChange]);
  const notify = async () => {
    const items = await list();
    for (const l of listeners) l(items);
  };

  // -------------------------------------------------------------------------
  // Reads — local first, always
  // -------------------------------------------------------------------------

  async function list() {
    const items = await getAll(db, 'items');
    return items.filter((i) => !i.deleted).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  }

  async function getMeta(key, dflt = null) {
    const v = await withStore(db, 'meta', 'readonly', (s) => req(s.get(key)));
    return v ?? dflt;
  }

  async function setMeta(key, value) {
    await withStore(db, 'meta', 'readwrite', (s) => req(s.put(value, key)));
  }

  /** Pull server changes since our last known revision and merge them locally. */
  async function pull() {
    const sinceRev = await getMeta('rev', 0);
    const { rev, changed } = await server.changesSince(sinceRev);
    if (changed.length) {
      // TODO 3 — merge, and decide what happens when a pulled change touches a record that
      // has a PENDING LOCAL EDIT in the outbox. Overwriting silently loses the user's work;
      // ignoring it silently loses the server's. Pick a rule, implement it, and make it
      // visible in the UI. (Last-write-wins by timestamp is a rule. So is "keep both and mark
      // the record as conflicted". "Whatever happens" is not.)
      await putMany(db, 'items', changed);
    }
    await setMeta('rev', rev);
    await notify();
    return { pulled: changed.length, rev };
  }

  // -------------------------------------------------------------------------
  // Writes — TODO
  // -------------------------------------------------------------------------

  /**
   * TODO 1 — optimistic local write + outbox.
   *
   *   1. Generate the id on the CLIENT (crypto.randomUUID()). This is not a detail: a
   *      client-generated id is what makes a retried create idempotent, and it lets the UI
   *      render the item before the server has ever heard of it.
   *   2. Write the item to `items` and append an operation to `outbox` IN ONE TRANSACTION.
   *      Two transactions means a crash between them loses the outbox entry (silent data loss)
   *      or leaves an orphan (a phantom write). One transaction, atomic.
   *   3. Mark the record `pending: true` so the UI can show it, then resolve immediately —
   *      the user does not wait for the network.
   *   4. Kick off a sync, but do not await it.
   */
  async function create(text) {
    throw new Error('TODO 1: implement create() in data-layer.js');
  }

  async function update(id, text) {
    throw new Error('TODO 1: implement update() in data-layer.js');
  }

  async function remove(id) {
    throw new Error('TODO 1: implement remove() in data-layer.js');
  }

  /**
   * TODO 2 — drain the outbox.
   *
   *   - Strictly in order (that is why the outbox key auto-increments).
   *   - One in-flight sync at a time. A second call while one is running must join the first,
   *     not start another — otherwise two drains send the same operation twice.
   *   - Classify failures:
   *       network / 5xx  → retryable. Back off exponentially, keep the entry, stop the drain.
   *       4xx (not 409)  → terminal. Remove the entry, mark the record failed, tell the user.
   *                        A poison message must never block the queue forever.
   *       409 conflict   → TODO 3.
   *   - On success: remove the outbox entry, clear `pending`, store the server's revision.
   *   - Everything must be safe to run twice: assume the browser was killed mid-drain.
   */
  async function drain() {
    throw new Error('TODO 2: implement drain() in data-layer.js');
  }

  /**
   * TODO 3 — conflicts.
   *
   * The server rejects with 409 and the current record. Choose and implement a policy:
   *   - last-write-wins by server timestamp (simple, loses data silently)
   *   - client-wins (simple, loses other people's data silently)
   *   - keep both: store the remote version alongside and mark the record conflicted, letting
   *     the UI ask (honest, more work, and the only one that never loses anything)
   *
   * Whatever you choose, write down WHY in a comment, and make sure the user can tell it
   * happened. A silent resolution is a bug report six months later that nobody can reproduce.
   */

  async function sync() {
    await drain();
    return pull();
  }

  return {
    list, pull, sync, drain, create, update, remove,
    getMeta, setMeta,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async outbox() { return getAll(db, 'outbox'); },
  };
}
