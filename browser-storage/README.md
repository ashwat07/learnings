# Browser storage: IndexedDB, Cache API, quotas ⭐⭐⭐⭐

Storing data on a user's device is easy. Storing it *correctly* — without blocking the main
thread, without losing it to eviction, without discovering at 2GB that you cannot write any more —
is the actual skill.

```sh
./serve.sh    # then http://localhost:8080/browser-storage/labs/01-localstorage-cost/
```

---

## The options, honestly

| API | Async? | Capacity | Data | Use it for |
|---|---|---|---|---|
| `localStorage` / `sessionStorage` | **no — synchronous, blocks the main thread** | ~5–10MB | strings only | tiny flags, a theme preference. Nothing else. |
| **IndexedDB** | yes | large (quota-based) | structured clone: objects, Blobs, ArrayBuffers, Maps | the default for real data |
| **Cache Storage** | yes | large (same quota) | `Request`/`Response` pairs | HTTP responses, assets |
| Cookies | no (sync read) | ~4KB | strings | things the *server* needs on every request |
| `sessionStorage` | no | ~5MB | strings | per-tab state, cleared on close |
| OPFS (Origin Private File System) | yes | large | files, sync access in workers | databases (SQLite/wasm), big binary streams |

Two rules that follow:

1. **`localStorage` is synchronous.** Every read and write blocks the main thread — including
   layout, input and paint. It's also serialised across tabs. It is a perfectly good API for 200
   bytes and a performance bug for anything else.
2. **IndexedDB is the default.** Not because it's pleasant — it isn't — but because it's async,
   large, transactional, indexed, and stores structured data without a `JSON.stringify` round trip.

## The quota model, which is where the surprises live

- All of it — IndexedDB, Cache Storage, localStorage, OPFS — shares **one origin quota**.
- The quota is a fraction of free disk (Chrome: up to ~60% of the disk, per origin, but capped by
  the total pool). It is not a number you can rely on; ask `navigator.storage.estimate()`.
- Under storage pressure the browser evicts **whole origins at once**, not individual entries.
  Your "offline app" comes back with no data and no session.
- `navigator.storage.persist()` asks for exemption from that. Whether you get it depends on
  engagement signals (installed PWA, bookmarked, high engagement) and it can be denied silently.
- Safari evicts all script-writable storage after **7 days without user interaction** with the
  site. That is a hard product constraint, not a tuning knob.

## Curriculum

| # | Lab | Question it answers | ⭐ |
|---|---|---|---|
| 01 | [The cost of localStorage](labs/01-localstorage-cost/) | How much does a synchronous API actually cost? | ⭐⭐⭐⭐ |
| 02 | [IndexedDB basics](labs/02-indexeddb-basics/) | Stores, indexes, transactions, cursors — properly | ⭐⭐⭐⭐⭐ |
| 03 | [IndexedDB performance](labs/03-indexeddb-performance/) | Why is my write of 100k records taking a minute? | ⭐⭐⭐⭐⭐ |
| 04 | [Cache API](labs/04-cache-api/) | When responses, when records? | ⭐⭐⭐⭐ |
| 05 | [Quotas & eviction](labs/05-quotas-and-eviction/) | What happens when the disk fills, or the user leaves for a week? | ⭐⭐⭐⭐⭐ |
| 06 | [An offline data layer](labs/06-offline-data-layer/) | Put it together: read, write, sync, conflict | ⭐⭐⭐⭐⭐⭐ |

## DevTools

Application → Storage shows usage per API and a *Clear site data* button (your reset). Application
→ IndexedDB lets you browse databases, but note it does **not** live-update reliably — refresh it
after writes. The Performance panel shows `localStorage` access as main-thread time; IndexedDB
work appears partly off-thread, which is exactly the point.
