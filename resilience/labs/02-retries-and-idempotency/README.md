# Lab 02 — Retries & idempotency ⭐⭐⭐⭐⭐

**Goal:** never write a retry that can charge someone twice.

**Primary metric:** the ledger — how many times the side effect happened.

> <http://localhost:8080/resilience/labs/02-retries-and-idempotency/>

---

## The case the lab can't show you directly

A request that **succeeded on the server and failed on the way back**: a timeout, a dropped
connection, a 502 from a proxy after the origin already committed.

From the client these are **indistinguishable** from "it never happened". Retry, and the work happens
twice — the customer is charged twice, the email is sent twice, the order exists twice.

This is not an edge case. It's the normal behaviour of networks.

## Idempotency keys — the five rules

1. **The client generates the key**, once, before the first attempt. A server-generated key can't
   help: you only receive it in the response you didn't get.
2. **The same key is reused for every retry of the same intent.** A new key per attempt is the same
   as no key — a surprisingly common mistake.
3. **A new user intent means a new key.** If the user genuinely wants to pay twice, that's two keys.
   Bind the key to the *intent* (the checkout session), not to the user or session.
4. **The server stores the result**, not just "seen" — a duplicate returns the *original* response,
   so the client ends in the right state either way.
5. **The key survives a reload.** Persist it with the pending operation, or a user who refreshes
   mid-payment gets a second charge.

HTTP gives you this free on GET, PUT and DELETE. It's POST that needs the key — which is why every
payments API has one.

## What's safe to retry

| Operation | Idempotent | Retry |
|---|---|---|
| `GET` | yes (by spec) | freely |
| `PUT` | yes | freely — it *sets* state |
| `DELETE` | yes | freely — the second 404s, which is fine |
| `POST /charge` | **no** | only with an idempotency key |
| `POST /search` | in practice | freely (POST used as a read) |
| `PATCH { count: +1 }` | **no** | never — redesign as a `PUT` of an absolute value |
| `PATCH { status: "done" }` | yes | freely — a fact, not a delta |

The last two rows are the same HTTP method, and one corrupts data. **Idempotence is a property of
the operation, not the method.**

Which gives the design rule that removes most of this work: **prefer setting facts over applying
deltas.** Same rule as [realtime-ui lab 03](../../../realtime-ui/labs/03-reconciliation/), for the
same reason — an at-least-once world rewards commutative operations.

## Status codes

| Retry | Don't retry |
|---|---|
| network errors, timeouts | 400, 403, 404, 409, 422 |
| 502, 503, 504 | 401 → refresh **once**, retry **once**, never loop |
| 429 — **obey `Retry-After`** | |
| 408, 425 | |

A client that ignores `Retry-After` and applies its own backoff is guessing at something it was
told.

## Backoff, jitter, cap, **budget**

The fourth is almost always missing. Without a budget, a retry loop is an infinite loop with extra
steps — and **retries compose**: 3 in your fetch wrapper × 3 in the component × 3 user clicks = 27
requests to a service that's already failing. That's how a partial outage becomes a total one.

The industry answer is a **retry budget** at the client-library level: allow retries only while
they're under ~10% of total requests. Under a broad outage that ratio blows immediately and retries
stop — exactly when you want them to.

## Think about

- Your POST timed out. Do you retry?
- Where do you store the idempotency key?
- Why does a retry budget beat a per-request retry limit?

<details>
<summary>Answers</summary>

**Timed-out POST.** Only if it's idempotent or carries a key. Otherwise the correct move is to
*ask*: query the server for the operation's status by a client-generated id ("did charge `abc-123`
happen?"). If you can't ask, you're choosing between double-charging and losing the order, and that
choice should be made by the product, not silently by a retry helper.

**Where to store the key.** With the pending operation, in something that survives a reload —
`sessionStorage` for a checkout, IndexedDB for a queued offline write. In memory only, a refresh
mid-payment generates a new key and the guarantee evaporates. Also give it a lifetime: keys should
expire with the intent, or you'll suppress a legitimate second purchase a week later.

**Budget vs per-request limit.** A per-request limit is local and composes badly — every layer gets
its own three attempts and they multiply. A budget is global and *proportional*: it measures retries
as a share of all traffic, so a single failing request still gets retried, while a system-wide
outage stops generating retry load almost immediately. It fails in the right direction under exactly
the conditions that matter.
</details>

---

## 🏗️ Build challenge

1. Inventory every mutating endpoint. Mark each idempotent or not.
2. Add idempotency keys to the non-idempotent ones, generated client-side, persisted with the
   pending operation, with a server-side store returning the original response.
3. Write one retry helper for the whole app: classify by status, exponential backoff + full jitter +
   cap, and a shared budget.
4. Delete every ad-hoc retry loop and route it through the helper.
5. Test: fail a request after the server commits (a proxy that drops the response) and assert the
   side effect happened exactly once.

**Done when:** a double-submitted payment produces one charge, and your app's total retry traffic is
bounded during a full outage.

---

## Interview questions

1. Why is a timeout the most dangerous failure for a POST?
2. Name the five rules for idempotency keys.
3. Which status codes do you retry, and which never?
4. Why is `PATCH { count: +1 }` unretryable, and how do you fix it?
5. What's a retry budget and why do you need one?
