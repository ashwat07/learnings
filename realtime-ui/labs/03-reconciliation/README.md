# Lab 03 — Reconciliation ⭐⭐⭐⭐⭐⭐

**Goal:** stop shipping UIs that are silently wrong after a reconnect.

**Primary metric:** does the client's total still equal the server's?

> <http://localhost:8080/realtime-ui/labs/03-reconciliation/>

---

## The failure this lab exists for

Reconnecting restores the **connection**. It does not restore the **state**.

Connect, let it run, then **drop for 4 seconds**. The server keeps emitting; you receive nothing.
Reconnect naively and your total is permanently wrong — with a healthy green connection indicator
and no error anywhere. That's the worst failure mode in real-time systems: **confidently incorrect**.

## Two recoveries, and they are not equivalent

**Replay from a cursor** (`Last-Event-ID`) needs three things designed in from the start:

1. every message carries a monotonic id
2. the client persists the last id it **applied** (not the last it received)
3. **the server retains enough history to serve the gap**

Point 3 is the one nobody plans for. History is a buffer of the last N messages or T seconds — a
policy. When a client has been away longer than that, the server must be able to say *"too far
behind"* rather than replay a partial gap. **A resume protocol without that fallback is a
correctness bug waiting for a long train journey.**

**Snapshot re-sync** is correct unconditionally, in one round trip, which is why most production
systems do it.

## Deltas vs snapshots

| | Deltas | Snapshots |
|---|---|---|
| Size | small | larger |
| Requires | exactly-once, in-order delivery | nothing |
| A gap | permanently wrong | self-healing |
| A duplicate | permanently wrong | harmless |
| You are maintaining | a replicated state machine | a cache |

**The pattern:** snapshot on connect, deltas while connected, **snapshot again on any doubt** — a
gap in ids, a reconnect beyond the retention window, a tab that was hidden, or just a periodic
re-sync as a safety net.

A cheap safety net worth adding to anything long-lived: send a version or checksum with each
message and re-snapshot when the client's computed version disagrees. It turns silent divergence
into a self-healing event.

## The decision procedure

> **Can you detect that you're wrong?**

If yes (sequence ids, versions, checksums), deltas are safe — being wrong becomes an event you can
handle. If no, use snapshots, because the alternative is a UI that is incorrect with no way to find
out.

## Ordering and duplicates

| Hazard | When | Fix |
|---|---|---|
| out-of-order delivery | multiple connections, retries, fan-out through several servers | sequence ids + a small reorder buffer, or commutative updates |
| duplicates | at-least-once delivery, replays | idempotent application (seen-set, or last-write-wins by version) |
| a stale update overwriting a newer one | the client also mutates optimistically | a version/rev per entity; ignore updates older than what you hold |
| **the client clock** | ever | never order by client timestamps — use server sequence numbers |

That last row produces the most confusing bugs. Client clocks drift, get set by the user, jump when
the machine wakes, and differ between two users looking at the same document. Anything sorted by
`Date.now()` on the client will eventually order two events backwards, and the bug is
unreproducible. If you need "when did this happen" for *display*, that's a different field from the
one you sort by.

**And the simplification worth designing for:** make updates commutative where you can. `set status
= done` can arrive twice, or late, and still end correct. `increment count` cannot.

## What to show while unsure

Stale but **labelled** beats wrong-and-confident. Users tolerate old data they can see is old; they
don't tolerate current-looking data that isn't.

## Think about

- Your feed is append-only. Do you still need reconciliation?
- The client was offline for 3 days. What do you do on reconnect?
- What's the risk of applying the same delta twice?

<details>
<summary>Answers</summary>

**Append-only feed.** Yes, but it's easy: you need to know *where you were*, which is the id of the
last item you have. Fetch everything after it. The subtlety is the retention window again — if the
gap is bigger than what the server can serve, you need a "jump to latest, you've missed a lot" path
rather than a partial backfill that leaves a silent hole in the middle of the feed.

**Offline for 3 days.** Snapshot, unconditionally. Don't attempt a replay; the history is gone, and
even if it weren't, applying three days of deltas is slower and riskier than fetching the current
state. This is where the "too far behind" server response earns its keep — and where you should also
consider whether the client's *local* state is stale enough to discard entirely (caches, derived
indexes, optimistic mutations that were never confirmed).

**Applying a delta twice.** Exactly as wrong as missing one, and harder to notice — you get a number
that's too high rather than too low, with no gap in the ids to detect it. This is why at-least-once
delivery (which is what you get from any retry) forces idempotent application: a seen-set of ids, or
updates expressed as facts rather than increments.
</details>

---

## 🏗️ Build challenge

1. Add sequence ids to your real-time messages if they don't have them.
2. Client: track `lastAppliedId`, detect gaps, and emit a metric when one occurs. **Ship the metric
   first** — you'll learn how often you're silently wrong today.
3. Implement resume-from-id server-side with an explicit retention window and a `TOO_FAR_BEHIND`
   response.
4. Implement snapshot re-sync as the fallback, triggered by: gap detected, `TOO_FAR_BEHIND`, tab
   visible after >5 min hidden, or a 15-minute timer.
5. Test: disconnect for longer than the retention window and confirm the client re-snapshots rather
   than backfilling a hole.

**Done when:** a 10-minute disconnection leaves the UI provably correct, and the gap metric is on a
dashboard.

---

## Interview questions

1. Why isn't reconnecting enough?
2. Deltas vs snapshots — what does each require to be correct?
3. What's the server-side constraint on replay, and what happens when you exceed it?
4. Why never order by client timestamps?
5. How do you make an update idempotent?
