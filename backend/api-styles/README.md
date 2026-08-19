# API styles & protocols

**No containers.** The "database" is in memory and *counts its queries*, which is the only number
most of this turns on.

```sh
npm run drills:api                 # all four, from backend/
npm run drills:api -- 02           # just one
npm run drills:api -- 02 --solution
node api-styles/labs/01-choosing/lab.mjs
```

| | | The starting code |
|---|---|---|
| **01** | Schema, resolvers & error masking | sends the database's error message — password and all — to the client |
| **02** | **DataLoader** | **81 queries** where 3 will do; 181 where 5 will do |
| **03** | Cursor pagination & cost limits | offset paging **repeats 98 rows**; the complexity limit is decorative |
| **04** | The protobuf wire format | rejects a field it has never seen — so producer and consumer can never deploy separately |

## What each one is about

**01 — Resolvers and errors.** GraphQL serialises a thrown exception's message into the response
by default, so the starting code returns `connection to shard 3 refused: user=svc_api
password=hunter2` to whoever asked. The fix is an **allow-list** `formatError` — anything not
explicitly marked public becomes "Internal server error" plus a correlation id — and a schema that
never had `passwordHash` in it, because a field that does not exist cannot be leaked by a resolver
bug. Also covers null propagation: `!` is not "required", it is *"if this fails, take my parent
down with it"*.

**02 — DataLoader.** A resolver runs once per parent object, so 40 users means 40 team queries.
DataLoader collects every key requested in one tick of the event loop and issues one batched query
— which only works because the flush is a **microtask**, running after the synchronous fan-out and
before the loop advances a phase.

The hard part isn't the batching. Your database returns rows in whatever order it likes and drops
the ids that don't exist, so mapping the answer back onto the key array is your job — and getting
it wrong doesn't throw, it serves user 12's email to user 11. The drill checks that every one of
40 users gets their *own* team and posts.

**03 — Pagination and cost.** Offset paging breaks under a live list; a cursor points at a *row*.
The tie is what catches people: three posts share a `createdAt`, so a cursor holding only the
timestamp repeats 98 of 120 rows. A keyset cursor must contain enough columns to be **unique** —
append the primary key, always. Then the cost half: a complexity limit that counts *fields* is
decorative, because the expensive query and the cheap one have the same field count and differ only
in `first`. Cost must **multiply** down nested lists.

**04 — Protobuf.** Varints, zigzag, wire types, and the one property everything else rests on:
**the wire type is in the tag**, so a reader that meets a field number it has never heard of knows
exactly how many bytes to skip. That single fact is what lets a producer and a consumer deploy
independently — and it's why reusing a retired field number corrupts data silently rather than
failing loudly.

## The lab

[`labs/01-choosing`](labs/01-choosing/) measures the comparison instead of arguing it:

- **gzipped** payloads — 1,248 B → 221 B (BFF) → 199 B (GraphQL) → 135 B (protobuf). Most of the
  "GraphQL saves bandwidth" case dies at `gzip`; JSON's repeated field names compress beautifully.
- **round trips** — 21 × 80ms of client-side N+1 versus one request. This is the argument that
  survives, and a purpose-built REST endpoint ties with GraphQL on it.
- **server cost** — the same one-request GraphQL query: **41 database queries without DataLoader,
  3 with**. One round trip for the client is not one unit of work for you.
- **schema evolution** — who actually verifies that a change is safe, per style. Usually nobody.

## Related

- [`../postgres/labs/08-n-plus-1-and-orms/`](../postgres/labs/08-n-plus-1-and-orms/) — the same N+1, at the SQL layer, against a real Postgres
- [`../node-runtime/drills/01-event-loop-order/`](../node-runtime/drills/01-event-loop-order/) — the microtask timing DataLoader depends on
- [`../api-craft/`](../api-craft/) — the REST contract, as a failing test suite
- [`../auth-and-security/`](../auth-and-security/) — IDOR and the authorise-on-the-data rule that resolvers make easy to forget
