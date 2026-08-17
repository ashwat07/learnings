// Lab 02 — IndexedDB basics.

import { $, on, Log, renderTable, fmt } from '/shared/lab-ui.js';
import { openDB, deleteDB, req, tx, withStore, putMany, iterate } from '/browser-storage/idb.js';

const log = new Log('#log');
const out = $('out');
const DB = 'lab02-people';

let db = null;

// ---------------------------------------------------------------------------
// Schema
//
// Stores and indexes can ONLY be created inside a versionchange transaction, which only runs
// during onupgradeneeded. That is why schema changes require bumping the version number, and
// why you cannot create an index lazily when you first need it.
// ---------------------------------------------------------------------------

function upgradeV1(d) {
  const people = d.createObjectStore('people', { keyPath: 'id' });
  people.createIndex('by_team', 'team');                       // non-unique
  people.createIndex('by_score', 'score');
  people.createIndex('by_tag', 'tags', { multiEntry: true });  // one entry per array element
  people.createIndex('by_email', 'email', { unique: true });
  log.muted('created store "people" with 4 indexes');
}

function upgradeV2(d, transaction) {
  // A compound index: queries can use [team, score] together, and the ORDER of the keyPath
  // determines which queries it can serve — exactly like a composite index in SQL.
  const people = transaction.objectStore('people');
  if (!people.indexNames.contains('by_team_score')) {
    people.createIndex('by_team_score', ['team', 'score']);
    log.muted('created compound index by_team_score');
  }
}

on('create', async () => {
  db?.close();
  db = await openDB(DB, 1, (d, oldVersion) => {
    log.line(`upgrade: ${oldVersion} → 1`, 'macro');
    if (oldVersion < 1) upgradeV1(d);
  });
  log.ok(`opened ${DB} v${db.version}, stores: ${[...db.objectStoreNames].join(', ')}`);
  out.textContent =
    'The database is open. Note the shape of what just happened:\n\n' +
    '  indexedDB.open(name, version) → onupgradeneeded (only if version increased) → onsuccess\n\n' +
    'Everything schema-related happens in that upgrade callback, inside a special versionchange\n' +
    'transaction that has exclusive access to the database. You cannot create an index later,\n' +
    'lazily, when you decide you need one — you have to bump the version and migrate.';
});

on('seed', async () => {
  if (!db) return log.bad('create the database first');
  const FIRST = ['ada', 'grace', 'alan', 'linus', 'barbara', 'edsger', 'donald', 'radia'];
  const TAGS = ['core', 'infra', 'ui', 'data', 'ml', 'ops'];
  const people = Array.from({ length: 5000 }, (_, i) => ({
    id: i,
    name: `${FIRST[i % FIRST.length]}-${i}`,
    email: `person${i}@example.com`,
    team: `team-${i % 37}`,
    score: (i * 2654435761) % 1000,
    tags: [TAGS[i % TAGS.length], TAGS[(i * 3) % TAGS.length]],
    joined: new Date(1600000000000 + i * 86400000),
  }));

  const t0 = performance.now();
  await putMany(db, 'people', people);
  log.ok(`stored 5,000 records in ${fmt.ms(performance.now() - t0)} (one transaction)`);
  log.muted('note: Date objects are stored as Dates, arrays as arrays — IndexedDB uses the ' +
    'structured clone algorithm, not JSON. No stringify, and Blobs work too.');
});

on('upgrade', async () => {
  db?.close();
  db = await openDB(DB, 2, (d, oldVersion, newVersion, transaction) => {
    log.line(`upgrade: ${oldVersion} → ${newVersion}`, 'macro');
    if (oldVersion < 1) upgradeV1(d);
    if (oldVersion < 2) upgradeV2(d, transaction);
  });
  log.ok(`now at v${db.version}, indexes: ${[...db.transaction('people').objectStore('people').indexNames].join(', ')}`);
  out.textContent =
    'Version upgrades are how migrations work. The upgrade callback receives oldVersion, so you\n' +
    'write it as a series of forward-only steps:\n\n' +
    '    if (oldVersion < 1) { create stores }\n' +
    '    if (oldVersion < 2) { add index }\n' +
    '    if (oldVersion < 3) { backfill a field }\n\n' +
    'Note the third case: data migrations run inside the same versionchange transaction, so a\n' +
    'backfill over a million records blocks the database opening. For big migrations, prefer a\n' +
    'lazy scheme — a new store written alongside the old one, migrated in the background.';
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

async function show(label, rows) {
  renderTable('#results', rows.slice(0, 12).map((r) => ({
    id: r.id, name: r.name, team: r.team, score: r.score, tags: r.tags?.join?.(',') ?? '',
  })), { columns: ['id', 'name', 'team', 'score', 'tags'] });
  log.line(`${label}: ${rows.length} rows`, 'macro');
}

on('getOne', async () => {
  const t0 = performance.now();
  const person = await withStore(db, 'people', 'readonly', (s) => req(s.get(4242)));
  log.ok(`get(4242) in ${fmt.ms(performance.now() - t0)}: ${person?.name}`);
  show('get by primary key', person ? [person] : []);
});

on('byIndex', async () => {
  const t0 = performance.now();
  const rows = await withStore(db, 'people', 'readonly',
    (s) => req(s.index('by_team').getAll('team-7')));
  log.ok(`index by_team = "team-7" → ${rows.length} rows in ${fmt.ms(performance.now() - t0)}`);
  show('by_team', rows);
  out.textContent =
    'An index is a second sorted structure mapping an indexed value to primary keys. Querying it\n' +
    'is a seek, not a scan — the same idea as a database index, with the same trade: every index\n' +
    'costs write time and disk space.\n\n' +
    'Compare with the full scan in lab 03 to see how much difference it makes at 100k records.';
});

on('range', async () => {
  const range = IDBKeyRange.bound(800, 900, false, true);       // [800, 900)
  const t0 = performance.now();
  const rows = await withStore(db, 'people', 'readonly',
    (s) => req(s.index('by_score').getAll(range)));
  log.ok(`score in [800, 900) → ${rows.length} rows in ${fmt.ms(performance.now() - t0)}`);
  show('by_score range', rows);
  log.muted('IDBKeyRange: only(v), lowerBound(v, open?), upperBound(v, open?), bound(a, b, ao?, bo?). ' +
    'Keys sort by type: number < date < string < binary < array. That ordering is why you can ' +
    'range over a compound key [team, score] but only with the team fixed — the same left-prefix ' +
    'rule as SQL composite indexes.');
});

on('cursorDemo', async () => {
  log.head('— cursor: descending by score, first 5 —');
  const seen = [];
  const t0 = performance.now();
  await iterate(db, 'people', { index: 'by_score', direction: 'prev' }, (value) => {
    seen.push(value);
    return seen.length < 5;                    // returning false stops the cursor
  });
  log.ok(`5 highest scores in ${fmt.ms(performance.now() - t0)}`);
  show('cursor', seen);
  out.textContent =
    'A cursor walks an index in key order and stops whenever you want. Use it when:\n' +
    '  • you only need the first N (getAll would materialise everything)\n' +
    '  • you need to update rows as you walk them (cursor.update / cursor.delete)\n' +
    '  • the result set is too big to hold in memory\n\n' +
    'Use getAll when you want everything and it fits — it is significantly faster than a cursor\n' +
    'because it avoids a round trip per record. Lab 03 measures the gap.';
});

on('multiEntry', async () => {
  const t0 = performance.now();
  const rows = await withStore(db, 'people', 'readonly',
    (s) => req(s.index('by_tag').getAll('ml')));
  log.ok(`tag "ml" → ${rows.length} rows in ${fmt.ms(performance.now() - t0)}`);
  show('by_tag (multiEntry)', rows);
  out.textContent =
    'A multiEntry index on an array field creates one index entry PER ELEMENT, so you can query\n' +
    '"everyone tagged ml" directly. It is the closest IndexedDB gets to a many-to-many join.\n\n' +
    'Costs: writes get more expensive proportionally to array length, and you cannot combine a\n' +
    'multiEntry index with a compound key. For "tagged ml AND on team-7" you query one index and\n' +
    'filter the rest in JS — there are no query planners here.';
});

on('unique', async () => {
  log.head('— unique index conflict —');
  try {
    await withStore(db, 'people', 'readwrite', (s) => req(s.put({
      id: 999999, name: 'duplicate', email: 'person1@example.com', team: 'x', score: 1, tags: [],
    })));
    log.bad('the write succeeded — the unique index is missing?');
  } catch (err) {
    log.ok(`rejected with ${err.name}: ${err.message}`);
    log.muted('A unique index constraint violation aborts the whole TRANSACTION, not just the one ' +
      'request. Every other write in that transaction is rolled back — which is the behaviour you ' +
      'want, and a surprise if you were batching 1,000 puts and one of them collided.');
  }
});

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

on('txScope', async () => {
  log.head('— transaction auto-close —');
  const transaction = db.transaction('people', 'readwrite');
  const store = transaction.objectStore('people');

  store.put({ id: 1000001, name: 'a', email: 'a@x.com', team: 't', score: 1, tags: [] });
  log.muted('first put issued');

  try {
    // Awaiting something that is NOT an IDB request lets the transaction go inactive, and it
    // commits. The next request against it throws.
    await new Promise((r) => setTimeout(r, 0));
    store.put({ id: 1000002, name: 'b', email: 'b@x.com', team: 't', score: 1, tags: [] });
    log.bad('second put succeeded — unexpected in most browsers');
  } catch (err) {
    log.ok(`second put threw: ${err.name} — "${err.message}"`);
  }

  out.textContent =
    'THE IndexedDB gotcha. A transaction stays alive only while it has pending requests. The\n' +
    'moment control returns to the event loop with nothing outstanding, it commits and becomes\n' +
    'inactive — and any later use throws TransactionInactiveError.\n\n' +
    'So this is broken:\n\n' +
    '    const tx = db.transaction("people", "readwrite");\n' +
    '    const store = tx.objectStore("people");\n' +
    '    for (const item of items) {\n' +
    '      await somethingNotIndexedDB();     // ← transaction commits here\n' +
    '      store.put(item);                   // ← TransactionInactiveError\n' +
    '    }\n\n' +
    'And this is fine — and much faster (lab 03):\n\n' +
    '    for (const item of items) store.put(item);   // fire all requests\n' +
    '    await tx(transaction);                       // then await the COMMIT\n\n' +
    'Any await inside a transaction must be on an IndexedDB request, or you must open a new\n' +
    'transaction afterwards.';
});

on('txAbort', async () => {
  log.head('— abort rolls everything back —');
  const before = await withStore(db, 'people', 'readonly', (s) => req(s.count()));
  const transaction = db.transaction('people', 'readwrite');
  const store = transaction.objectStore('people');
  for (let i = 0; i < 100; i++) {
    store.put({ id: 2000000 + i, name: `temp${i}`, email: `t${i}@x.com`, team: 't', score: 1, tags: [] });
  }
  transaction.abort();
  await tx(transaction).catch(() => {});
  const after = await withStore(db, 'people', 'readonly', (s) => req(s.count()));
  log.ok(`count before ${before}, after abort ${after} — all 100 writes rolled back`);
  log.muted('IndexedDB transactions are ACID within a database. That is the main reason to prefer ' +
    'it over the Cache API or localStorage for anything with invariants across records.');
});

on('blocked', async () => {
  log.head('— the "blocked" problem —');
  log.muted('Open this page in a SECOND tab, click "create the database" there, then come back ' +
    'here and click "upgrade to v2".');
  log.muted('If the other tab still holds v1 open, your open(v2) fires `blocked` and hangs — ' +
    'forever, silently, unless you handle it.');
  log.muted('The fix is in idb.js: db.onversionchange = () => db.close(). Every tab agrees to ' +
    'get out of the way when another one needs to upgrade. Without it, a user with two tabs open ' +
    'never receives your migration.');
  out.textContent =
    'This is the multi-tab failure mode of IndexedDB, and it is invisible in single-tab testing.\n' +
    'Always: (1) handle `blocked` on open with a user-visible message, (2) set onversionchange on\n' +
    'every open connection so other tabs release it, (3) reload the page after closing, since your\n' +
    'now-closed connection is useless.';
});

on('destroy', async () => {
  db?.close(); db = null;
  await deleteDB(DB);
  log.bad(`${DB} deleted`);
});

on('clear', () => log.clear());
