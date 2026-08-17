/**
 * idb.js — a ~90-line promise wrapper over IndexedDB, used by labs 02–06.
 *
 * Read it: it is short enough to hold in your head, and it shows the two things every wrapper
 * has to solve — turning IDBRequest into a promise, and not letting a transaction auto-close
 * underneath you (see lab 03).
 */

/** Wrap a single IDBRequest. */
export function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Wrap a transaction's completion. Note: `complete` fires AFTER all its requests succeed. */
export function tx(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new DOMException('aborted', 'AbortError'));
  });
}

/**
 * Open (and upgrade) a database.
 *
 * `upgrade(db, oldVersion, newVersion, transaction)` runs inside a versionchange transaction —
 * the only place you may create or delete stores and indexes.
 */
export function openDB(name, version, upgrade) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = (e) => upgrade?.(request.result, e.oldVersion, e.newVersion, request.transaction);
    request.onsuccess = () => {
      const db = request.result;
      // If another tab opens a newer version, we must close or we block it forever — a real
      // and very confusing bug: the other tab's open() just hangs.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(
      `open(${name}, ${version}) is BLOCKED — another tab holds an older version open`));
  });
}

export function deleteDB(name) {
  return new Promise((resolve, reject) => {
    const r = indexedDB.deleteDatabase(name);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('delete blocked — close other tabs'));
  });
}

/** Run `fn(store)` inside one transaction and resolve when the transaction COMMITS. */
export async function withStore(db, storeName, mode, fn) {
  const transaction = db.transaction(storeName, mode);
  const store = transaction.objectStore(storeName);
  const result = await fn(store, transaction);
  await tx(transaction);
  return result;
}

export const get = (db, store, key) => withStore(db, store, 'readonly', (s) => req(s.get(key)));
export const getAll = (db, store, query, count) =>
  withStore(db, store, 'readonly', (s) => req(s.getAll(query, count)));
export const put = (db, store, value, key) =>
  withStore(db, store, 'readwrite', (s) => req(s.put(value, key)));
export const del = (db, store, key) => withStore(db, store, 'readwrite', (s) => req(s.delete(key)));
export const count = (db, store, query) => withStore(db, store, 'readonly', (s) => req(s.count(query)));
export const clear = (db, store) => withStore(db, store, 'readwrite', (s) => req(s.clear()));

/**
 * Bulk put. The important part is what it does NOT do: it does not await each request.
 *
 * An IndexedDB transaction commits as soon as it becomes inactive — which happens the moment
 * you await something that is not an IDB request from within it. Firing all the puts and then
 * awaiting the transaction is both correct and roughly an order of magnitude faster than
 * awaiting each one. Lab 03 measures it.
 */
export async function putMany(db, storeName, values, { chunk = 0 } = {}) {
  if (!chunk) {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    for (const v of values) store.put(v);         // no await inside the loop
    await tx(transaction);
    return values.length;
  }
  for (let i = 0; i < values.length; i += chunk) {
    await putMany(db, storeName, values.slice(i, i + chunk));
  }
  return values.length;
}

/** Iterate with a cursor, calling `fn(value, cursor)`. Return false from fn to stop. */
export function iterate(db, storeName, { index, query, direction = 'next' } = {}, fn) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const source = index
      ? transaction.objectStore(storeName).index(index)
      : transaction.objectStore(storeName);
    const request = source.openCursor(query, direction);
    let n = 0;
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve(n);
      n++;
      if (fn(cursor.value, cursor) === false) return resolve(n);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}
