// Lab 03 — Reconciliation: what "we reconnected" does not fix.
//
// The client keeps a running total by applying DELTAS. Every message carries an id and a delta.
// Miss one and the total is silently wrong forever — which is the point.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

let source = null;
let total = 0;          // what the client believes
let truth = 0;          // what the server would say, computed from every id we know exists
let lastId = 0;
let gaps = 0;
let seen = new Set();

const deltaFor = (id) => (id % 7) + 1;    // deterministic, so "truth" is computable

function paint() {
  $('total').textContent = total;
  $('truth').textContent = truth;
  $('total').className = `big ${total === truth ? 'right' : 'wrong'}`;
  $('lastid').textContent = lastId || '—';
  $('gaps').textContent = gaps;
}
paint();

function apply(id, { replayed = false } = {}) {
  // IDEMPOTENCE: applying the same delta twice is as wrong as missing one. A seen-set is the
  // cheapest defence, and it is why every message needs a stable id.
  if (seen.has(id)) { log.muted(`duplicate id ${id} ignored`); return; }
  if (lastId && id > lastId + 1) {
    gaps += id - lastId - 1;
    log.bad(`GAP: expected ${lastId + 1}, got ${id} — ${id - lastId - 1} message(s) lost`);
  }
  seen.add(id);
  total += deltaFor(id);
  lastId = Math.max(lastId, id);
  log[replayed ? 'ok' : 'line'](`${replayed ? 'replayed' : 'applied'} id ${id} (+${deltaFor(id)})`);
  paint();
}

// The server's view: the sum of every delta ever emitted, whether or not we received it.
function trackTruth(id) {
  truth = 0;
  for (let i = 1; i <= id; i++) truth += deltaFor(i);
  paint();
}

function connect({ resume }) {
  source?.close();
  // A fresh EventSource with no history is exactly what a client looks like when it reconnects
  // without a resume token — which is most hand-rolled WebSocket clients.
  const url = resume && lastId
    ? `/api/events?interval=800&lastEventId=${lastId}`
    : '/api/events?interval=800';
  source = new EventSource(url);
  source.onopen = () => log.ok(`connected${resume && lastId ? ` (resuming after id ${lastId})` : ' (no resume)'}`);
  source.addEventListener('tick', (e) => { const d = JSON.parse(e.data); trackTruth(d.id); apply(d.id); });
  source.addEventListener('replay', (e) => { const d = JSON.parse(e.data); apply(d.id, { replayed: true }); });
  source.onerror = () => log.bad('connection error');
}

on('start', () => {
  total = 0; truth = 0; lastId = 0; gaps = 0; seen = new Set();
  connect({ resume: false });
  out.textContent =
    'The client is applying DELTAS: each message says "add N". The two numbers agree while the\n' +
    'connection is healthy.\n\n' +
    'Now drop the connection.';
});

on('drop', () => {
  source?.close();
  log.bad('— disconnected for 4 seconds; the server keeps emitting —');
  out.textContent =
    'Disconnected. The server keeps producing events; you are receiving none of them.\n\n' +
    'When you reconnect, the two options in front of you are not equivalent, and the whole lab is\n' +
    'the difference between them.';
  setTimeout(() => log.muted('4s elapsed — now choose how to reconnect'), 4000);
});

on('resume', () => {
  connect({ resume: true });
  setTimeout(() => {
    out.textContent =
      (total === truth
        ? 'Correct again. The server replayed every event after the id you last saw.\n\n'
        : 'Still wrong — the replay did not cover the whole gap.\n\n') +
      'REPLAY FROM A CURSOR is the cheapest correct recovery, and it needs three things you must\n' +
      'design in from the start:\n' +
      '  1. every message carries a monotonic id\n' +
      '  2. the client persists the last id it APPLIED (not the last it received)\n' +
      '  3. the server retains enough history to serve the gap\n\n' +
      'That third one is the constraint nobody plans for. A buffer of the last N messages, or the\n' +
      'last T seconds, is a policy — and when the client has been away LONGER than the buffer, the\n' +
      'server must be able to say "too far behind" rather than replay a partial gap. Then the\n' +
      'client falls back to a snapshot. A resume protocol without that fallback is a correctness\n' +
      'bug waiting for a long train journey.';
  }, 1200);
});

on('snapshot', () => {
  // The alternative recovery: throw away the derived state and re-read the truth.
  total = truth;
  seen = new Set();
  gaps = 0;
  paint();
  log.ok('re-synced from a snapshot: local state discarded and replaced');
  out.textContent =
    'Correct, unconditionally, in one round trip — and this is why snapshot+resubscribe is what\n' +
    'most production systems actually do.\n\n' +
    'DELTAS vs SNAPSHOTS is the real design decision:\n\n' +
    '  Deltas      small, cheap, and require EXACTLY-ONCE, IN-ORDER delivery to stay correct.\n' +
    '              Every gap is permanent; every duplicate is permanent. You are maintaining a\n' +
    '              replicated state machine, whether you meant to or not.\n' +
    '  Snapshots   larger, but IDEMPOTENT. Receiving the same snapshot twice is harmless, and\n' +
    '              receiving one after a gap fixes the gap. You cannot be silently wrong.\n\n' +
    'The pattern that combines them: SNAPSHOT ON CONNECT, DELTAS WHILE CONNECTED, SNAPSHOT AGAIN\n' +
    'ON ANY DOUBT. "Any doubt" means: a gap in ids, a reconnect beyond the retention window, a tab\n' +
    'that was hidden for a while, or simply a periodic re-sync as a safety net.\n\n' +
    'A cheap version of that safety net, worth adding to anything long-lived: have the server send\n' +
    'a version/checksum with each message, and re-snapshot when the client\'s computed version\n' +
    'disagrees. It turns silent divergence into a self-healing event.';
});

on('stop', () => { source?.close(); log.muted('stopped'); });

on('strategies', () => {
  renderTable('#results', [
    { strategy: 'full snapshot every message', correct: 'always', cost: 'bandwidth', use: 'small state, low frequency' },
    { strategy: 'snapshot on connect + deltas', correct: 'if you detect gaps', cost: 'a resume protocol', use: 'the default for most apps' },
    { strategy: 'deltas only, with replay from an id', correct: 'within the retention window', cost: 'server-side history', use: 'event streams, feeds, logs' },
    { strategy: 'CRDT / operation log', correct: 'converges without a server arbiter', cost: 'metadata and complexity', use: 'collaborative editing — lab 04' },
  ], { columns: ['strategy', 'correct', 'cost', 'use'] });
  out.textContent =
    'A decision procedure that fits on one line: CAN YOU DETECT THAT YOU ARE WRONG?\n\n' +
    'If yes (sequence ids, versions, checksums), deltas are safe — because being wrong becomes an\n' +
    'event you can handle. If no, use snapshots, because your alternative is a UI that is confidently\n' +
    'incorrect and no way to find out.\n\n' +
    'The related question for the UI layer: WHAT DO YOU SHOW WHILE YOU ARE UNSURE? The options are\n' +
    'a stale value with a "reconnecting" indicator (usually right), a spinner over everything\n' +
    '(usually wrong — you had data a second ago), or a blank (always wrong). Users tolerate stale\n' +
    'data that is LABELLED. They do not tolerate wrong data that is presented as current.';
});

on('ordering', () => {
  renderTable('#results', [
    { hazard: 'out-of-order delivery', when: 'multiple connections, retries, or a fan-out through several servers', fix: 'sequence ids + a small reorder buffer, or make updates commutative' },
    { hazard: 'duplicates', when: 'at-least-once delivery, retries, a reconnect that replays too much', fix: 'idempotent application (a seen-set, or last-write-wins by version)' },
    { hazard: 'a stale update overwriting a newer one', when: 'the client also mutates optimistically', fix: 'version/rev per entity; ignore updates older than what you hold' },
    { hazard: 'the client clock', when: 'ever', fix: 'never order by client timestamps; use server sequence numbers' },
  ], { columns: ['hazard', 'when', 'fix'] });
  out.textContent =
    'Note the last row, because it is the one that produces the most confusing bugs. Client clocks\n' +
    'are wrong: they drift, they are set by the user, they jump when the machine wakes, and they\n' +
    'differ between two users looking at the same document. Anything ordered by Date.now() on the\n' +
    'client will eventually order two events backwards, and the resulting bug is unreproducible.\n\n' +
    'Order by a SERVER-ASSIGNED SEQUENCE. If you need "when did this happen" for display, that is a\n' +
    'separate field from the one you sort by.\n\n' +
    'And the deeper simplification: MAKE UPDATES COMMUTATIVE WHERE YOU CAN. "set status = done" can\n' +
    'arrive twice, or late, and still ends correct. "increment count" cannot. Choosing the first\n' +
    'shape removes an entire class of ordering work — which is the idea lab 04 takes to its\n' +
    'conclusion.';
});

on('clear', () => { log.clear(); $('#results').textContent = ''; });
