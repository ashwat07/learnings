# Lab 03 — The outbox ⭐⭐⭐⭐⭐⭐

**Goal:** never lose what a user typed.

**Primary metric:** save something offline, **reload the page** — is it still there?

> <http://localhost:8080/offline-and-pwa/labs/03-the-outbox/>

---

## The bug

Go offline with **fire and forget**, save a note, and reload.

The note is gone. There was never anything on disk — only a promise, in memory, in a tab that no
longer exists. And the UI said "Saved", so the user won't type it again.

This is the most common offline bug in production software, and it's invisible in every demo because
the network is always up on a developer's machine.

## The design, in one line

> **Persist before you acknowledge.** The acknowledgement is a promise you must be able to keep.

| Rule | Why |
|---|---|
| persist **before** you acknowledge | the whole thing |
| a client-generated id per record | it's the idempotency key; retries are only safe with it ([resilience lab 02](../../../resilience/labs/02-retries-and-idempotency/)) |
| **IndexedDB**, not `localStorage` | transactional, async, and not capped at ~5MB of synchronous strings |
| one flush at a time | concurrent flushes send duplicates |
| backoff between attempts | a tight retry loop on a failing server is an outage amplifier |
| **a dead-letter state after N attempts** | a queue that retries forever silently never delivers |
| flush on `online`, `visibilitychange`, and app start | the three moments connectivity plausibly returned |
| show the queue to the user | they must be able to see and act on pending work |
| preserve ordering **where operations depend on each other** | otherwise "delete" arrives before "create" |

## Background Sync

The platform feature that completes it — the browser flushes your queue **even if the tab is
closed**:

```js
const reg = await navigator.serviceWorker.ready;
await reg.sync.register('outbox');

// in the service worker:
self.addEventListener('sync', e => { if (e.tag === 'outbox') e.waitUntil(flushOutbox()); });
```

Chromium-only. Treat it as an **enhancement** on top of the in-page flush loop, never as the
mechanism. The loop must work by itself; Background Sync makes it work when the user has moved on.

(`periodicsync` exists for background *refresh*, is gated on user engagement, and you should not
depend on it firing.)

## Ordering

- **independent operations** (three separate notes) → flush in parallel, let fast ones through
- **dependent operations** (create → edit → delete the same item) → a strictly ordered queue, and
  stop on first failure, or the edit arrives for an item that doesn't exist yet

Most apps want **per-entity ordering**: parallel across entities, serial within one.

## Dead letters are a product decision

After N attempts you stop. What then?

- tell the user, specifically: *"This note couldn't be saved. Retry, or copy the text."*
- **never delete their content** to clear the queue
- give them a way to get it out — copy to clipboard, export, or keep it visible until resolved
- log it, with the error, so you learn whether it's your server or their network

A silent dead-letter queue is the same bug as fire-and-forget, arriving later.

## Think about

- Why IndexedDB rather than `localStorage`?
- Your outbox has 500 queued items after a week offline. Now what?
- The queued write was made against data that has since changed. What happens?

<details>
<summary>Answers</summary>

**IndexedDB over `localStorage`.** `localStorage` is synchronous (it blocks the main thread, and a
big write during an interaction shows up directly in INP), string-only (so you serialise and
reparse), capped around 5MB, and has no transactions — a tab crash mid-write can leave you with a
partial value. IndexedDB is async, transactional, structured-clone capable (Blobs included), and
sized in hundreds of MB. See [browser-storage lab 01](../../../browser-storage/labs/01-localstorage-cost/).

**500 queued items.** Don't fire 500 requests. Batch them if your API supports it, flush with limited
concurrency and backoff otherwise, and show progress — this is a visible operation, not a background
one. Also ask whether they should all still be sent: a create followed by a delete of the same item
can often be collapsed to nothing, and 30 edits to one field collapse to the last. **Compacting the
queue before flushing** is usually the single biggest win.

**Stale base data.** Your write may conflict, and you can't know until it's delivered. Send the
version/rev you edited against (`If-Match`) so the server can reject rather than silently overwrite,
and handle the rejection when it arrives — which may be minutes after the user moved on, so the
resolution UI has to work out of context. That's [lab 04](../04-conflict-resolution/).
</details>

---

## 🏗️ Build challenge

1. Find every mutating action in your app and classify it: must-not-lose, or safe-to-drop.
2. Build one outbox for the must-not-lose set. IndexedDB, client ids, backoff, dead letters.
3. Make the UI show queue state per item, not one global spinner.
4. Add Background Sync as an enhancement, with the in-page loop as the guarantee.
5. Add queue compaction for the obvious cases (create+delete, repeated edits).
6. Test: save offline, **kill the tab**, reopen. The work must survive and deliver.

**Done when:** killing the browser mid-save loses nothing.

---

## Interview questions

1. What does "persist before you acknowledge" mean, and what goes wrong without it?
2. Why does every queued record need a client-generated id?
3. When do you need ordering in the queue, and when don't you?
4. What should happen after N failed attempts?
5. Why is Background Sync an enhancement rather than the mechanism?
