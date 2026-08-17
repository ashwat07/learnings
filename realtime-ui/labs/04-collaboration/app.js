// Lab 04 — Collaboration: three merge policies for the same divergence.
//
// The CRDT here is a tiny LWW-element-set of characters with unique ids — enough to show
// CONVERGENCE (both peers end identical without asking a server which is right) without being a
// production text CRDT. Read it as an illustration of the property, not as a library.

import { $, on, $$, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

let policy = 'lww';
const server = { text: 'shared document', rev: 1 };
const peers = {
  a: { online: true, text: server.text, rev: server.rev, ops: [], crdt: null },
  b: { online: true, text: server.text, rev: server.rev, ops: [], crdt: null },
};

// ---------------------------------------------------------------------------
// A minimal CRDT: an ordered list of {id, ch, deleted}. Ids are [counter, peer] so they are
// globally unique and totally ordered — which is what makes concurrent inserts commute.
// ---------------------------------------------------------------------------
function crdtFromText(text, peer) {
  return [...text].map((ch, i) => ({ id: [i * 1000, peer], ch, deleted: false }));
}
const crdtText = (doc) => doc.filter((c) => !c.deleted).map((c) => c.ch).join('');
const cmpId = (x, y) => (x[0] - y[0]) || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0);

function crdtMerge(docA, docB) {
  // Union by id; a character deleted anywhere stays deleted (a tombstone), and the total order on
  // ids gives a deterministic sequence. Both peers running this on the same inputs get the same
  // output, in any order, any number of times. That is the whole property.
  const byId = new Map();
  for (const c of [...docA, ...docB]) {
    const key = c.id.join(':');
    const prev = byId.get(key);
    byId.set(key, prev ? { ...c, deleted: prev.deleted || c.deleted } : c);
  }
  return [...byId.values()].sort((x, y) => cmpId(x.id, y.id));
}

function localEdit(peer, text) {
  const p = peers[peer];
  if (policy === 'crdt') {
    // Naive diff: append new characters with ids that interleave deterministically.
    const base = p.crdt ?? (p.crdt = crdtFromText(server.text, peer));
    const current = crdtText(base);
    if (text.length > current.length) {
      const added = [...text.slice(current.length)];
      const last = base.at(-1)?.id[0] ?? 0;
      added.forEach((ch, i) => base.push({ id: [last + (i + 1) * 7 + (peer === 'a' ? 1 : 2), peer], ch, deleted: false }));
    } else {
      // Deletions become tombstones, which is why a CRDT document grows even when text shrinks.
      const keep = text.length;
      base.filter((c) => !c.deleted).slice(keep).forEach((c) => { c.deleted = true; });
    }
  }
  p.text = text;
  p.ops.push({ at: Date.now(), text });
  $(`#ops-${peer}`).textContent = `${p.ops.length} local edit(s), base rev ${p.rev}` +
    (policy === 'crdt' ? `, ${p.crdt?.length ?? 0} chars incl. tombstones` : '');
}

for (const peer of ['a', 'b']) {
  $(`text-${peer}`).value = server.text;
  on($(`text-${peer}`), 'input', (e) => localEdit(peer, e.target.value));
}

$$('.toggle').forEach((btn) => on(btn, 'click', () => {
  const peer = btn.dataset.peer;
  peers[peer].online = !peers[peer].online;
  btn.textContent = peers[peer].online ? 'go offline' : 'go online';
  $(`#peer-${peer}`).classList.toggle('offline', !peers[peer].online);
  log[peers[peer].online ? 'ok' : 'bad'](`peer ${peer.toUpperCase()} is ${peers[peer].online ? 'online' : 'offline'}`);
}));

for (const [id, value] of [['p-lww', 'lww'], ['p-reject', 'reject'], ['p-crdt', 'crdt']]) {
  on(id, () => {
    policy = value;
    log.head(`policy: ${value}`);
    reset();
  });
}

function reset() {
  server.text = 'shared document'; server.rev = 1;
  for (const peer of ['a', 'b']) {
    peers[peer] = { online: true, text: server.text, rev: 1, ops: [], crdt: policy === 'crdt' ? crdtFromText(server.text, peer) : null };
    $(`text-${peer}`).value = server.text;
    $(`#ops-${peer}`).textContent = '';
    $(`#peer-${peer}`).classList.remove('offline');
  }
  $$('.toggle').forEach((b) => { b.textContent = 'go offline'; });
}
on('reset', reset);
reset();

on('sync', () => {
  log.head(`— syncing with policy: ${policy} —`);
  const a = peers.a, b = peers.b;

  if (policy === 'lww') {
    // Both push; whoever writes last wins the whole document. Simple, and it silently destroys work.
    const lastA = a.ops.at(-1)?.at ?? 0, lastB = b.ops.at(-1)?.at ?? 0;
    const winner = lastB >= lastA ? 'b' : 'a';
    server.text = peers[winner].text; server.rev++;
    a.text = b.text = server.text;
    $('text-a').value = $('text-b').value = server.text;
    log.bad(`peer ${winner.toUpperCase()} won; the other peer's edits are gone`);
    renderTable('#results', [
      { policy: 'last write wins', result: server.text, lost: `peer ${winner === 'a' ? 'B' : 'A'}'s edits` },
    ], { columns: ['policy', 'result', 'lost'] });
    out.textContent =
      'One peer\'s work is gone, with no error and no notification. That is the honest description\n' +
      'of last-write-wins, and it is the most widely deployed policy in the industry.\n\n' +
      'It is not always wrong. LWW is CORRECT when the field is genuinely owned by one writer at a\n' +
      'time (a user editing their own profile), or when the value is a fact rather than an edit\n' +
      '("last known GPS position"). It is wrong the moment two people can legitimately edit the same\n' +
      'thing — and it fails SILENTLY, which is what makes it dangerous rather than merely lossy.\n\n' +
      'If you use LWW, at minimum: keep the overwritten version, and tell the loser.';
  }

  if (policy === 'reject') {
    // Optimistic concurrency: the second writer's base revision is stale, so the write is refused.
    const results = [];
    for (const peer of ['a', 'b']) {
      const p = peers[peer];
      if (!p.ops.length) continue;
      if (p.rev !== server.rev) {
        results.push({ peer, outcome: '409 Conflict — your base revision is stale', text: p.text });
        log.bad(`peer ${peer.toUpperCase()}: 409, base rev ${p.rev} vs server rev ${server.rev}`);
      } else {
        server.text = p.text; server.rev++;
        p.rev = server.rev;
        results.push({ peer, outcome: `accepted, now rev ${server.rev}`, text: p.text });
        log.ok(`peer ${peer.toUpperCase()}: accepted`);
      }
    }
    renderTable('#results', results, { columns: ['peer', 'outcome', 'text'] });
    out.textContent =
      'The second writer got a 409. Nothing was lost, and nothing was merged — the conflict was\n' +
      'handed back to a human.\n\n' +
      'This is OPTIMISTIC CONCURRENCY CONTROL, and over HTTP it is ETag + If-Match:\n\n' +
      '  GET  /doc/1            → ETag: "7"\n' +
      '  PUT  /doc/1  If-Match: "7"   → 200 (now ETag "8")  or  412 Precondition Failed\n\n' +
      'It is the right default for most business data, because it is SAFE and CHEAP: no lost\n' +
      'writes, no merge machinery, and the failure is loud. The cost is entirely in the UX — the\n' +
      'user typed for five minutes and now has to resolve something. Mitigate that by scoping\n' +
      'revisions per FIELD rather than per document, so two people editing different fields never\n' +
      'collide.\n\n' +
      'See architecture-and-state lab 04, which builds this end to end.';
  }

  if (policy === 'crdt') {
    const merged = crdtMerge(a.crdt, b.crdt);
    const mergedOther = crdtMerge(b.crdt, a.crdt);     // deliberately the other order
    a.crdt = merged; b.crdt = mergedOther;
    const textA = crdtText(a.crdt), textB = crdtText(b.crdt);
    $('text-a').value = textA; $('text-b').value = textB;
    server.text = textA; server.rev++;
    renderTable('#results', [
      { peer: 'A merged (A then B)', text: textA },
      { peer: 'B merged (B then A)', text: textB },
      { peer: 'identical?', text: textA === textB ? 'YES — converged' : 'no' },
    ], { columns: ['peer', 'text'] });
    log[textA === textB ? 'ok' : 'bad'](`converged: ${textA === textB}`);
    out.textContent =
      'Both peers merged in the OPPOSITE ORDER and ended with the same document. That is the whole\n' +
      'property, and it is worth stating precisely:\n\n' +
      '  the merge is COMMUTATIVE (order does not matter), ASSOCIATIVE (grouping does not matter)\n' +
      '  and IDEMPOTENT (applying twice changes nothing)\n\n' +
      'Which means no peer has to be the arbiter, messages can arrive in any order, duplicates are\n' +
      'harmless, and there is no central server deciding who is right. That is why CRDTs are the\n' +
      'basis of every serious local-first and collaborative editor.\n\n' +
      'What it costs, honestly:\n' +
      '  · METADATA. Every character carries an id, and deletions leave TOMBSTONES — the document\n' +
      '    grows even when the text shrinks. Real implementations spend most of their cleverness on\n' +
      '    compacting this.\n' +
      '  · CONVERGENCE IS NOT INTENT. Both peers agreeing does not mean the result is what either\n' +
      '    person MEANT. Two people editing the same sentence get a merge that is consistent and\n' +
      '    possibly nonsense. No algorithm fixes that; presence and cursors do, by preventing the\n' +
      '    collision in the first place.\n' +
      '  · COMPLEXITY. Use Yjs or Automerge. Do not write the one above.\n\n' +
      'The alternative lineage is OT (operational transformation), which Google Docs uses: smaller\n' +
      'payloads, but it requires a central server to order operations. CRDTs trade bytes for the\n' +
      'ability to work without one.';
  }
});

on('presence', () => {
  renderTable('#results', [
    { signal: 'who is here', transport: 'ephemeral — never persist it', note: 'a join/leave message plus a heartbeat; assume gone after 2 missed beats' },
    { signal: 'cursor / selection', transport: 'high frequency, lossy is fine', note: 'throttle to ~20/s, send only the latest, never queue' },
    { signal: 'is typing', transport: 'debounced, expires by itself', note: 'a 3s TTL beats an explicit "stopped typing" message that can be lost' },
    { signal: 'the document itself', transport: 'reliable, ordered, persisted', note: 'a completely different channel with different guarantees' },
  ], { columns: ['signal', 'transport', 'note'] });
  out.textContent =
    'The design mistake worth avoiding: sending presence through the same reliable, ordered,\n' +
    'persisted pipeline as the document.\n\n' +
    'Presence is EPHEMERAL and LOSSY BY NATURE. A cursor position that is 200ms old is worthless —\n' +
    'you want the latest one, not all of them, and you never want a backlog of cursor positions\n' +
    'replayed after a reconnect. Give it its own channel, drop instead of queueing, and expire it\n' +
    'with a TTL rather than trusting a "goodbye" message that will sometimes not arrive.\n\n' +
    'And the human point: presence is what PREVENTS most conflicts. Seeing someone else\'s cursor in\n' +
    'the paragraph you were about to edit stops the merge from ever being needed — which is a\n' +
    'better outcome than any merge algorithm can produce.';
});
