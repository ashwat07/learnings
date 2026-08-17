# Offline & PWA ⭐⭐⭐⭐⭐

Offline is not a feature you add. It is a set of assumptions you remove — that the network exists,
that it is fast, that a request that started will finish, and that the version running is the
version you deployed.

```sh
./serve.sh    # then http://localhost:8080/offline-and-pwa/labs/01-installability/
```

> **Prerequisites, and this course leans on them heavily rather than repeating them:**
> [service-workers](../service-workers/) (lifecycle, cache strategies, the traps) and
> [browser-storage](../browser-storage/) (IndexedDB, Cache API, quotas, the offline data layer).
> Do those first. This course is about the *product* decisions on top of them.

---

## The four states

Most apps model two (online, offline) and get the interesting cases wrong.

| State | What's true | What the UI should do |
|---|---|---|
| **online, fresh** | data is current | normal |
| **online, stale** | you have cached data, revalidating | show it, with a subtle indicator |
| **offline, usable** | cached data + a working outbox | show it, **labelled**, accept writes |
| **offline, unusable** | no cache for this route | say so, and offer what *is* available |

The third is where the value is. An app that only *reads* offline is a brochure; one that accepts
writes and reconciles them is a tool.

## What this course adds on top of the service-worker course

| # | Lab | Question it answers | ⭐ |
|---|---|---|---|
| 01 | [Installability](labs/01-installability/) | What makes it installable, and should it be? | ⭐⭐⭐ |
| 02 | [The offline experience](labs/02-offline-experience/) | What does the user see, and how do they know? | ⭐⭐⭐⭐ |
| 03 | [The outbox](labs/03-the-outbox/) | The user typed something while offline. Where did it go? | ⭐⭐⭐⭐⭐⭐ |
| 04 | [Conflict resolution](labs/04-conflict-resolution/) | They come back after two days. Whose version wins? | ⭐⭐⭐⭐⭐ |
| 05 | [Updates](labs/05-updates/) | A user has had the tab open for a week. Which version? | ⭐⭐⭐⭐⭐ |

## The honest scoping question

Before any of this: **which parts of your product genuinely need to work offline?** Usually it's a
narrow, high-value slice — the notes you already opened, the form you were filling in, the last
screen you looked at. Building "the whole app works offline" is a project; building "you never lose
what you typed" is a week and is what users actually notice.
