# Lab 04 — Client data consistency & sync ⭐⭐⭐⭐⭐

**Goal:** make mutations feel instant without lying, and have an answer for every way a write can
fail.

**Primary metric:** perceived latency of a mutation, and what the user sees when it fails.

> Sandbox: <http://localhost:5173/#optimistic>

---

## Three strategies, measured

| Strategy | Feels | On failure | Use when |
|---|---|---|---|
| **Pessimistic** | slow (a full round trip per action) | nothing happened — honest | money, irreversible actions, low-frequency writes |
| **Optimistic + rollback** | instant | the change vanishes — jarring | high-confidence writes (a like, a toggle) |
| **Optimistic + queue** | instant | stays, marked failed, with a retry | almost everything else |

Run all three in the sandbox with the server failing every 3rd write. The third one is usually the
right product: the user's work is never silently destroyed, and the failure is visible and
actionable.

**Never do optimistic-with-silent-rollback.** A change that appears and then quietly disappears is
worse than a spinner — the user doesn't know whether their work was saved, and that's the single
most damaging thing a UI can be unclear about.

## Client-generated ids

```js
const item = { id: crypto.randomUUID(), text, state: 'pending' };
```

This one decision buys three things:

1. **Idempotent retries.** A retry after an ambiguous failure (the request succeeded, the response
   was lost) is an upsert of the same record, not a duplicate. Without it you get "the user posted
   twice", which is the classic offline-queue bug.
2. **Render before the server knows.** The row exists immediately, with a real key.
3. **No id swap.** You never have to rewrite references from a temporary id to a real one — which
   otherwise breaks every list key, selection and URL you handed out.

## Conflicts

Two people edited the same record. Someone has to decide:

| Policy | Cost |
|---|---|
| **Last write wins** | simple; **silently destroys** the other edit |
| **First write wins** (reject on `If-Match`/rev mismatch) | safe; the user loses their work unless you preserve it |
| **Keep both, ask** | never loses data; needs UI |
| **Merge automatically** (CRDT/OT) | no conflicts by construction; a much larger system |

The mechanism underneath all of them is a **revision or ETag** carried with the read and sent with
the write:

```
GET  /item/42          → { rev: 7, … }
PUT  /item/42          If-Match: "7"    → 409 if the server is at rev 8
```

That's [http-caching lab 02](../../../http-caching/labs/02-validators/)'s validators used for
optimistic concurrency control rather than caching — the same header, a different purpose. If your
API has no revision, you cannot detect conflicts at all; you can only overwrite.

Click **simulate conflict** in the sandbox and resolve it both ways. Whatever policy you choose,
**make it visible** — a silent resolution becomes a bug report six months later that nobody can
reproduce.

## The offline case

Everything above, plus durability: the queue must survive the tab closing. That's
[browser-storage lab 06](../../../browser-storage/labs/06-offline-data-layer/), which builds it
properly — IndexedDB outbox, single-flight drain, terminal vs retryable failures, poison messages.
The React half is what this lab covers; the storage half is there.

## Think about

- Which of your app's mutations should be pessimistic?
- What does the user see between "I clicked save" and "the server confirmed"?
- Your optimistic update succeeded locally and failed on the server, and the user has navigated
  away. Now what?

<details>
<summary>Answers</summary>

**Pessimistic candidates.** Payments, deletions without undo, anything with legal or financial
consequence, and anything where showing an unconfirmed state would let the user act on false
information (a booking confirmation, a stock reservation). The test: if this later turns out not to
have happened, is a retry good enough, or has the user made a decision based on it?

**Between click and confirm.** Ideally: the change, marked as in-flight (subtle — a slight
transparency, a small indicator), with the control disabled against double submission. Not: a
full-screen spinner (which blocks work that could continue), and not: nothing at all (which invites
a second click).

**Failed after navigation.** This is why the queue matters more than the rollback. Options, in order:
retry in the background and only surface it if it fails permanently; show a persistent, dismissible
notification with a retry; and — for anything important — keep the failed item visible in its
original context when the user returns. What you must not do is discard it silently, which is what a
naive rollback does when the component has unmounted.
</details>

---

## 🏗️ Build challenge

Extend the sandbox's optimistic panel into something shippable:

1. **A mutation helper**: `mutate({ optimistic, request, rollback, onConflict })` that handles the
   three strategies, retries with backoff, and updates the query cache from lab 02.
2. **Cache invalidation after a mutation** — the thing hand-rolled state always forgets. On success,
   invalidate the affected keys; on failure, restore the snapshot.
3. **Conflict UI**: a real diff of mine vs theirs, with per-field resolution rather than
   whole-record. Per-field is what makes "keep both" usable.
4. **Idempotency end to end**: client id in the request, server upsert, and a test that fires the
   same mutation twice and asserts one record.
5. **A chaos test**: 20 mutations with a 30% failure rate and random latency; assert the final client
   state matches the server exactly.

**Done when:** the chaos test converges every run, and a conflict never loses either side's data
without the user choosing.

---

## Interview questions

1. Three mutation strategies — when is each right?
2. Why generate ids on the client?
3. How do you detect a conflict, and what header does it use?
4. Why is silent rollback worse than a spinner?
5. Your optimistic update fails after the user navigated away. What happens?
