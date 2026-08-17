# Resilience & graceful degradation ⭐⭐⭐⭐⭐

Every front end is a distributed system with one very unreliable node in it: the user's browser, on
a network you don't control, running code you didn't write. This course is about what happens when
part of it fails — which is not "if".

```sh
./serve.sh                                     # labs 02–05
cd react-sandbox && npm run dev                # lab 01 (#boundaries)
```

---

## The principle

> **Every failure should degrade something specific, not everything.**

A widget that can't load should leave the rest of the page working. A stale cache should say it's
stale. A failed retry should stop and tell the user. The opposite — one failure taking down the
whole screen — is the default you get for free, and the thing you're engineering away from.

## The failure taxonomy

| Failure | Detected by | Right response |
|---|---|---|
| a component threw during render | error boundary | replace that subtree, keep the page |
| a fetch failed (network) | rejected promise | retry with backoff, then show a retry affordance |
| a fetch failed (4xx) | status | **don't retry** — it will fail identically |
| a fetch failed (5xx) | status | retry, idempotently |
| a request never returns | **your own timeout** | abort, then treat as failure |
| a dependency is down for everyone | error rate | circuit-break; fail fast instead of queueing |
| a lazy chunk 404s after a deploy | `import()` rejection | reload the page once; it's a stale index |
| the data is stale | timestamps | show it, labelled |
| the browser lacks a feature | detection | a path that still works |

## Curriculum

| # | Lab | Question it answers | ⭐ |
|---|---|---|---|
| 01 | [Error boundaries](labs/01-error-boundaries/) | What do boundaries catch, and what do they miss? | ⭐⭐⭐⭐⭐ |
| 02 | [Retries & idempotency](labs/02-retries-and-idempotency/) | When is a retry safe, and when does it double-charge someone? | ⭐⭐⭐⭐⭐ |
| 03 | [Degradation](labs/03-degradation/) | Which parts of the page survive? | ⭐⭐⭐⭐ |
| 04 | [Timeouts & circuit breaking](labs/04-timeouts-and-circuit-breaking/) | How long do you wait, and when do you stop trying? | ⭐⭐⭐⭐⭐ |
| 05 | [Chaos](labs/05-chaos/) | Would you know? | ⭐⭐⭐⭐ |

Related: [realtime-ui lab 02](../realtime-ui/labs/02-reconnection/) (backoff and jitter, applied to
connections) and [architecture-and-state lab 04](../architecture-and-state/labs/04-consistency-and-sync/)
(optimistic updates that have to roll back).

## The two rules people get backwards

**A retry is a decision about the SERVER, not about the client.** "It failed, try again" is only
safe if the operation is idempotent — otherwise your retry is the bug.

**A timeout is a promise to the user, not a property of the network.** There is no correct value
derivable from first principles; you pick the number at which waiting longer stops being useful to
the person waiting.
