# Lab 04 — Conflict resolution ⭐⭐⭐⭐⭐

**Goal:** decide, in advance, whose version wins — and make the losing case survivable.

**Run these two, which build the machinery:**
[architecture-and-state lab 04](../../../architecture-and-state/labs/04-consistency-and-sync/) (three
mutation strategies, client ids, `If-Match`/rev) and
[realtime-ui lab 04](../../../realtime-ui/labs/04-collaboration/) (LWW vs reject vs CRDT, with two
peers diverging). This lab is what changes when the divergence lasted **two days** instead of two
seconds.

---

## What offline changes

Offline conflicts differ from real-time conflicts in three ways that matter:

| | Real-time | Offline |
|---|---|---|
| divergence | seconds | hours or days |
| the user | is present | **has moved on** |
| the amount of work at risk | one edit | a whole session |
| resolution UI | in context | **out of context — they don't remember** |

That third row is the design constraint. "Resolve this conflict" is a reasonable thing to ask
someone who just typed; it is nearly useless to ask someone about a note they wrote on a train on
Tuesday.

## The strategies, ranked by offline suitability

| Strategy | Offline suitability | Notes |
|---|---|---|
| **CRDT / operation log** | best | converges without asking; the reason local-first tools use them |
| **field-level merge** | good | two people editing different fields never collide — cheap and effective |
| **reject + queue for review** | acceptable | safe, but the review must be findable later |
| **last write wins** | dangerous | silently destroys a whole offline session |

**LWW is much worse offline than online.** Online it loses one edit; offline it can lose an hour of
work, and the loser is the person whose device was disconnected — the one who had the least chance to
notice.

## The rules

**1. Never resolve destructively without a copy.** Whatever you decide, keep the losing version and
give the user a path to it. "Your offline changes conflicted; here's your version" is recoverable.
Silent overwrite is not.

**2. Reduce the surface.** Most conflicts are avoidable by design, not resolvable by algorithm:

- **field-level** rather than document-level versioning — two people editing different fields of the
  same record shouldn't conflict at all
- **append-only** where possible (a comment, an event) — appends never conflict
- **facts over deltas** — `status = done` is idempotent and order-independent; `count += 1` is not
  (the same rule as [realtime-ui lab 03](../../../realtime-ui/labs/03-reconciliation/) and
  [resilience lab 02](../../../resilience/labs/02-retries-and-idempotency/))

**3. Resolve automatically where the answer is obvious.** Identical content: no conflict. Only one
side changed: take it. Disjoint fields: merge. Reserve the human for the genuinely ambiguous case,
which should be rare.

**4. Make the ambiguous case a first-class screen**, not a modal that appears once and is dismissed.
The user is out of context, so show: what they changed, what changed on the server, when each
happened, and who did it. Then offer keep-mine, keep-theirs, and — where the content allows — a
side-by-side merge.

## Sync metadata you need from day one

Retrofitting any of this is far more expensive than adding it now:

| Field | For |
|---|---|
| a client-generated id | idempotency, and matching a queued write to its server record |
| the base version/rev the edit was made against | detecting the conflict at all (`If-Match`) |
| a **server-assigned** version, bumped per write | ordering; never a client timestamp |
| `updatedAt` + `updatedBy` | explaining the conflict to a human |
| a local `dirty` flag | knowing what hasn't been delivered |

## Think about

- Two devices of the *same user* edit offline. Is that a conflict?
- Your API is last-write-wins and you can't change it. What can you do client-side?
- When is "just ask the user" the wrong answer?

<details>
<summary>Answers</summary>

**Same user, two devices.** Technically yes, and it's the *most common* offline conflict — a phone
and a laptop, both with stale copies. It's also the most forgivable to resolve automatically, since
there's no question of whose intent wins. Merge by field, and if you must pick, prefer the one with
the later *client edit time* while keeping the other recoverable. What you must not do is treat it as
a collaboration conflict and interrupt one person with a dialog about themselves.

**Server is LWW, you can't change it.** Reduce the window and detect after the fact. Send writes as
soon as connectivity returns rather than batching them late; keep a local copy of every version you
sent; after each write, re-read the record and compare it with what you sent — if the server's
version doesn't match, someone else won, and you can now surface it and offer recovery. It's not
prevention, but it converts silent loss into a visible, recoverable event, which is most of the
value.

**When asking is wrong.** When the user can't possibly answer well: they're out of context (a
two-day-old edit), the difference is mechanical (whitespace, a re-order, a timestamp), the conflict
is with themselves across devices, or the volume is high (30 conflicts after a long offline session —
nobody resolves 30 dialogs; they click through them). Asking is a last resort, and its frequency is a
measure of how well the data model avoids conflicts.
</details>

---

## 🏗️ Build challenge

1. Add the sync metadata table above to your records. This is the prerequisite for everything else.
2. Move from document-level to **field-level** versioning on your most-edited entity. Measure the
   conflict rate before and after.
3. Implement automatic resolution for identical, one-sided and disjoint changes. Log how many
   conflicts that removes.
4. Build the human resolution screen for what's left — with both versions, timestamps, and authors.
5. Never delete a losing version; keep it retrievable for at least a session.
6. Test the two-day case: edit offline, change the same record elsewhere, come back.

**Done when:** an offline session that conflicts loses nothing, and the user is asked at most once.

---

## Interview questions

1. Why is last-write-wins worse offline than online?
2. What sync metadata do you need, and why must the version be server-assigned?
3. How does field-level versioning reduce conflicts?
4. Which conflicts can you resolve without asking?
5. Why is "ask the user" a bad default for offline conflicts?
