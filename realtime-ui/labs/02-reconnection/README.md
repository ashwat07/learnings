# Lab 02 — Reconnection ⭐⭐⭐⭐⭐

**Goal:** build a reconnect loop that helps a struggling server instead of finishing it off.

**Primary metric:** the delay sequence, and whether clients retry in lockstep.

> <http://localhost:8080/realtime-ui/labs/02-reconnection/>

---

## The connection will drop

Tunnels, sleeping laptops, **load-balancer idle timeouts (typically 60s — send heartbeats)**,
deploys, wifi handoffs. Not "if".

## SSE: the browser does it, and you should still know how

Run **connect (drops after 4)** and watch the Network panel. After the drop a new request goes out
carrying `Last-Event-ID`, and the server replays what you missed.

The server controls the delay by sending `retry: 1500` in the stream. Most implementations never
send it — so the browser uses its own default and you have no way to slow clients down when you're
struggling.

Now run **flaky endpoint**. `EventSource` retries a failed *connection* at a fixed interval,
forever, with **no backoff and no jitter**. That's the one place the built-in behaviour isn't
enough: a down server gets hammered at a constant rate by every client in lockstep. Free
reconnection is not free *adaptive* reconnection.

## WebSocket: the naive loop is an outage amplifier

Run **naive reconnect**. It looks perfect in a demo. In production, when your server restarts, every
client reconnects in the same millisecond and keeps doing so — the server comes up, is immediately
saturated, falls over, and the cycle continues *after the original fault is fixed*.

## The recipe

| Step | Because |
|---|---|
| exponential backoff | a struggling server should get exponentially less traffic |
| **full jitter** — random in `[0, backoff]` | otherwise every client retries in lockstep |
| a cap (30s) | a long outage shouldn't mean a 3-hour wait |
| reset on a connection that **survives** | a flapping socket should keep backing off |
| heartbeat + watchdog | `readyState` lies; only an unanswered ping proves death |
| **resume from a message id** | reconnecting is not the same as being correct (lab 03) |
| stop on `offline`, retry immediately on `online` | retrying with no interface is pure waste |
| re-sync on `visibilitychange` | a sleeping laptop kills sockets silently |
| give up **visibly** after N attempts | a silent retry loop showing stale data is a lie |

```js
const capped = Math.min(1000 * 2 ** attempt, 30_000);
const delay  = Math.random() * capped;      // full jitter, not backoff ± 10%
```

**Full jitter beats "backoff ± 10%"** because it spreads a synchronised herd across the entire
window rather than a narrow band around the same instant.

## `navigator.onLine` is a hint, not a truth

- `false` is reliable — no network interface.
- `true` means only "an interface exists". A captive portal, a VPN routing nowhere, or a dead server
  all report `true`.

Use `offline` to **stop** retrying and `online` to **retry immediately** instead of waiting out the
backoff — that's what makes an app feel instant when you leave a tunnel. Never treat `online` as
proof a request will succeed.

## Think about

- Why reset the backoff on open-and-survives rather than on open?
- Your heartbeat is every 30s and the LB timeout is 60s. Fine?
- What should the UI show during reconnection?

<details>
<summary>Answers</summary>

**Reset on survival.** A connection that opens and dies in 200ms is a *failing* connection, and
resetting the counter on `onopen` turns your backoff into a tight loop — the worst case, since it
looks like it's working. Reset after the connection has been up for some threshold (a few seconds,
or after the first successful message).

**30s heartbeat vs 60s timeout.** Fine for keeping the connection alive, marginal for *detecting*
death: you'll notice a dead socket up to 30s late plus the watchdog. Pick the heartbeat from the
timeout you must beat (say, half of it) and the watchdog from how quickly a user should be told
something is wrong. And remember the heartbeat has to be an application-level ping the server
answers — a TCP keepalive won't tell you the application is alive.

**The UI.** Stale data with a clear "reconnecting…" indicator, plus timestamps on anything
time-sensitive. Not a spinner over everything (you had data a second ago), not a blank, and not
silence. After you give up, an explicit "disconnected — retry" with a button: users forgive a
failure they can see and act on, not one that pretends everything is fine.
</details>

---

## 🏗️ Build challenge

Write a `ResilientSocket` class with: exponential backoff + full jitter + cap, reset-on-survival,
heartbeat/watchdog, an outbound queue that survives a reconnect, `online`/`offline` handling,
`visibilitychange` re-sync, and a `state` observable (`connecting`/`open`/`reconnecting`/`failed`).

Then test it properly: kill the server mid-stream, restart it, and confirm (a) the client reconnects,
(b) the delays are jittered — log them, (c) 20 simultaneous clients don't all arrive in the same
100ms window, (d) messages queued while offline are sent exactly once.

**Done when:** the delay log from 20 clients is spread across the whole backoff window.

---

## Interview questions

1. Why jitter?
2. Why cap the backoff?
3. Your socket says OPEN but nothing arrives. How do you find out?
4. What does `Last-Event-ID` do, and what's the WebSocket equivalent?
5. Why isn't `navigator.onLine === true` proof of connectivity?
