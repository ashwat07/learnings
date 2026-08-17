# Lab 06 — An offline data layer ⭐⭐⭐⭐⭐⭐

**Goal:** build the thing every offline-capable app needs — local-first reads, optimistic writes,
a durable outbox, and a conflict policy you can state out loud.

**Primary metric:** the six tests on the page.

> Open <http://localhost:8080/browser-storage/labs/06-offline-data-layer/>

---

## The architecture

```
UI ──read──► IndexedDB (immediately)  ──background──► server pull ──► merge
   ──write─► IndexedDB + outbox (one transaction) ──► resolve immediately
                     │
                     └── drain: send in order, retry, resolve conflicts
```

Four rules that make it work:

1. **Reads never wait for the network.** Render local data, refresh behind.
2. **Writes are optimistic and durable.** Apply locally, append to the outbox, resolve. The outbox
   lives in IndexedDB, not memory — the tab *will* be closed.
3. **The local write and the outbox entry go in one transaction.** Two transactions means a crash
   between them either loses the outbox entry (silent data loss) or leaves an orphan (a phantom
   write).
4. **Ids are generated on the client.** `crypto.randomUUID()`. This is what makes a retried create
   idempotent, and it lets the UI render before the server has heard of the item.

## What's implemented, and what's yours

Implemented: `list()`, `pull()`, the schema, and a simulated server you can make slow, flaky and
conflicted.

| TODO | What |
|---|---|
| 1 | `create` / `update` / `remove`: optimistic local write + outbox entry, atomically |
| 2 | `drain()`: in-order, single-flight, with retry classification |
| 3 | Conflict policy, and making it visible |

## TODO 2 in detail — the drain

This is where most homegrown sync layers go wrong:

- **Strictly in order.** That's why the outbox key auto-increments.
- **Single-flight.** A second `sync()` while one is running must *join* the first, not start
  another. Otherwise two drains send the same operation twice — one of the tests checks this.
- **Classify failures:**

  | Failure | Action |
  |---|---|
  | Network error, 5xx, timeout | Retryable. Exponential backoff, keep the entry, stop the drain (order matters). |
  | 4xx other than 409 | **Terminal.** Remove the entry, mark the record failed, tell the user. A poison message must never block the queue forever. |
  | 409 conflict | TODO 3. |

- **Idempotent by construction.** Assume the browser was killed after the server committed but
  before you removed the outbox entry. Client-generated ids plus an upsert make the retry
  harmless.

## TODO 3 — conflicts

The server rejects with 409 and its current version. Three defensible policies:

| Policy | Cost |
|---|---|
| Last-write-wins (server timestamp) | Simple. **Loses data silently.** |
| Client wins | Simple. Loses *other people's* data silently. |
| Keep both, flag the record | Honest. More UI work. Never loses anything. |

Pick one, write down why, and **make it visible**. A silent resolution becomes a bug report six
months later that nobody can reproduce, because there's no trace it happened.

For most apps: last-write-wins is acceptable for low-contention data (a personal todo list),
and unacceptable for anything collaborative. If you need real concurrent editing, you want CRDTs
or OT, and that's a different (large) project — the honest answer in an interview is to say so
rather than to pretend a 409 handler is enough.

## The six tests, and the production failure each one represents

| Test | The failure it prevents |
|---|---|
| `create()` doesn't wait for the network | A UI that blocks on the network isn't offline-first |
| An offline write survives and syncs later | Work lost when the tab closed — outbox was in memory |
| A retried write doesn't duplicate | The user "posted twice" |
| Two concurrent syncs don't double-send | A race sent everything twice |
| A terminal failure doesn't block the queue | One bad record froze every later change, forever |
| A conflict is visible | Someone's edit vanished and nobody could reproduce it |

## Try it by hand, too

1. Add an item. It should appear instantly, marked *pending*, then flip to *synced*.
2. Tick **offline**, add three more, **reload the page**. They must still be there, still pending.
3. Untick offline. Watch them drain in order.
4. Set fail rate to 0.5 and add five items. Watch retries, and confirm nothing duplicates.
5. Click **change item 1 on the server behind your back**, then edit item 1 locally, then sync.
   Whatever your policy does, you should be able to *see* that it happened.

## Think about

- Why must the local write and the outbox entry be in the same transaction?
- Why generate ids on the client?
- What does your app do when the outbox has been failing for three days?

<details>
<summary>Answers</summary>

**One transaction.** IndexedDB gives you atomicity across stores in a single transaction. Two
transactions leave a window where the browser can be killed: either the item exists with no
outbox entry (the change silently never reaches the server) or the outbox has an entry for an
item that doesn't exist locally. Both are silent, both are data loss, and neither reproduces on
demand.

**Client ids.** Idempotency. If the server assigns the id, a retry after an ambiguous failure
(the request succeeded but the response was lost) creates a second record, and you cannot detect
it. With a client-generated id, the retry is an upsert of the same record — a no-op. It also
means the UI can render immediately and never has to swap an id afterwards, which otherwise
breaks every reference you've handed out.

**Three days of failure.** You need a policy, and it must be visible: show pending count and age
in the UI, stop retrying at some point and escalate, offer an export of unsynced work, and report
it in telemetry. The worst answer is an infinite silent retry loop — the user believes their work
is saved, and it is only on a device that might be wiped tomorrow (lab 05).
</details>

---

## 🏗️ Extension: make it multi-tab and background

Two tabs open, both writing, both syncing. Extend the layer:

1. **Web Locks** (`navigator.locks.request('sync', …)`) so exactly one tab drains the outbox at a
   time. Without it, two tabs race on the same entries.
2. **BroadcastChannel** so a write in one tab updates the other's UI immediately, without polling.
3. **Background Sync** in a service worker (`registration.sync.register('outbox')`) so the drain
   happens even after the tab is closed. Document what it does and doesn't guarantee, and what
   the fallback is on browsers without it.
4. **A visible sync state**: pending count, last successful sync, and an explicit "unsynced work
   at risk" warning tied to `navigator.storage.persisted()` (lab 05).

**Done when:** you can open two tabs, work offline in both, close one mid-sync, and end with
exactly one copy of every record on the server — verified by the test suite, not by looking.

---

## Interview questions

1. Walk me through what happens when a user creates an item while offline.
2. Why must the local write and the outbox entry be atomic?
3. How do you make a retried write idempotent?
4. Two tabs sync at the same time. What breaks, and how do you prevent it?
5. Your policy is last-write-wins. Which product decisions does that make for you?
6. The outbox has 40 entries and has been failing for a week. What does the user see?
