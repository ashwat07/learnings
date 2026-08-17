# Lab 04 — Collaboration ⭐⭐⭐⭐⭐⭐

**Goal:** choose a merge policy deliberately, and know exactly what each one loses.

**Primary metric:** after both peers sync, do they hold the same document — and did anyone's work
vanish?

> <http://localhost:8080/realtime-ui/labs/04-collaboration/>

---

## Run it

Pick a policy, take **both** peers offline, type different things in each, then **sync**.

| policy | both converge? | anything lost? | who resolves it |
|---|---|---|---|
| last write wins | | | |
| reject on conflict | | | |
| CRDT | | | |

## Last write wins

One peer's work is gone, with no error and no notification. That is the honest description of the
most widely deployed policy in the industry.

It isn't always wrong. **LWW is correct when a field is genuinely owned by one writer at a time** (a
user editing their own profile) or when the value is a *fact* rather than an *edit* ("last known GPS
position"). It's wrong the moment two people can legitimately edit the same thing — and it fails
**silently**, which is what makes it dangerous rather than merely lossy.

If you use it: keep the overwritten version, and tell the loser.

## Reject on conflict — optimistic concurrency

```
GET /doc/1                    → ETag: "7"
PUT /doc/1  If-Match: "7"     → 200 (now "8")   or   412 Precondition Failed
```

Nothing lost, nothing merged, the conflict handed back to a human. **This is the right default for
most business data**: safe, cheap, and loud.

The cost is entirely UX — the user typed for five minutes and now has to resolve something. Mitigate
by scoping revisions **per field** rather than per document, so two people editing different fields
never collide. Built end-to-end in
[architecture-and-state lab 04](../../../architecture-and-state/labs/04-consistency-and-sync/).

## CRDT

Both peers merge in the **opposite order** and end with the same document. The property, precisely:

> the merge is **commutative** (order doesn't matter), **associative** (grouping doesn't matter) and
> **idempotent** (applying twice changes nothing)

Which means no peer has to be the arbiter, messages can arrive in any order, duplicates are
harmless, and no central server decides who's right. That's why CRDTs underpin every serious
local-first and collaborative editor.

**What it costs, honestly:**

- **Metadata.** Every character carries an id, and deletions leave **tombstones** — the document
  grows even when the text shrinks. Real implementations spend most of their cleverness compacting
  this.
- **Convergence is not intent.** Both peers agreeing doesn't mean the result is what either person
  *meant*. Two people editing the same sentence get a merge that is consistent and possibly
  nonsense. No algorithm fixes that — **presence does**, by preventing the collision.
- **Complexity.** Use **Yjs** or **Automerge**. Don't write the one in this lab; it exists to show
  the property, not to be copied.

**The alternative lineage is OT** (operational transformation), which Google Docs uses: smaller
payloads, but it needs a central server to order operations. CRDTs trade bytes for the ability to
work without one.

## Presence is a different channel

| Signal | Guarantees | Note |
|---|---|---|
| who is here | ephemeral, never persisted | join/leave + heartbeat; assume gone after 2 missed beats |
| cursor / selection | lossy is fine | throttle to ~20/s, send only the latest, **never queue** |
| is typing | expires by itself | a 3s TTL beats a "stopped typing" message that can be lost |
| the document | reliable, ordered, persisted | a completely different channel |

The mistake to avoid: sending presence through the same reliable, ordered, persisted pipeline as the
document. A cursor position 200ms old is worthless, and you never want a backlog of cursor positions
replayed after a reconnect.

## Think about

- Your app has a "notes" field two people can edit. Which policy?
- Why do CRDT documents grow when you delete text?
- Convergence guarantees correctness — true or false?

<details>
<summary>Answers</summary>

**A shared notes field.** Start with reject-on-conflict (`If-Match`) plus presence — it's a day of
work, loses nothing, and for a field two people edit occasionally the conflict rate will be near
zero. Reach for a CRDT when *simultaneous* editing is the normal case rather than an accident;
that's a different product, and it brings a library, a sync server, and a persistence format with
it.

**Tombstones.** A deletion must be *communicated*, not just performed: a peer that never saw the
character can't know it was deleted, and a peer that re-syncs later must not resurrect it. So
deletion is recorded as a marker keeping the id alive. Garbage-collecting tombstones requires knowing
every peer has seen them, which is why it's the hardest part of a production CRDT.

**Convergence ≠ correctness.** False. Convergence guarantees all replicas reach the *same* state,
not a *good* one. Two people rewriting the same sentence converge on an interleaving neither wrote.
That's why real editors pair CRDTs with presence, cursors, and sometimes locking at a granularity
that matches the content — the algorithm guarantees consistency; the UI has to protect intent.
</details>

---

## 🏗️ Build challenge

Build a collaborative field with Yjs: a `y-websocket` provider, an `IndexeddbPersistence` for
offline, and awareness for cursors and presence.

Then test the cases that matter: two tabs offline, both edit, both return (converge?); one tab
offline for an hour (does IndexedDB persistence restore its edits?); undo with two users (does
`UndoManager` undo *your* change, not theirs?); and document size after 10,000 edits and deletions
(what's the tombstone cost, and does the snapshot compact?).

**Done when:** you can state your document's growth rate per edit and your plan for compaction.

---

## Interview questions

1. When is last-write-wins correct?
2. What does `If-Match` give you, and what does it cost the user?
3. Name the three algebraic properties a CRDT merge needs.
4. CRDT vs OT — what's the trade?
5. Why should presence use a different channel from the document?
