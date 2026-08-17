# Real-time UI ⭐⭐⭐⭐⭐

Real-time is easy for ten minutes and hard for a week. The demo works; then the laptop sleeps, the
train enters a tunnel, a proxy buffers your stream, two people edit the same field, and the server
sends 400 updates a second to a tab nobody is looking at.

This course builds each of those failures on purpose.

```sh
./serve.sh    # then http://localhost:8080/realtime-ui/labs/01-transports/
```

The lab server implements **SSE** (`/api/events`) and a **hand-rolled WebSocket** (RFC 6455
handshake, frame masking, the lot) in about 120 lines — read them in
[`server.mjs`](../server.mjs). Both can be told to drop connections on a schedule, which is how the
resilience labs work.

---

## Pick the transport by the shape of the traffic

| | Polling | Long-poll | **SSE** | **WebSocket** | WebTransport |
|---|---|---|---|---|---|
| Direction | ⇅ per request | ⇅ per request | ⇊ server→client | ⇅ full duplex | ⇅ full duplex |
| Protocol | HTTP | HTTP | HTTP | upgrade from HTTP | HTTP/3 |
| Auto-reconnect | n/a | you build it | **built in, with resume** | you build it | you build it |
| Message ids / replay | you build it | you build it | **`id:` + `Last-Event-ID`** | you build it | you build it |
| Binary | yes | yes | **no** (text only) | yes | yes |
| Proxies / corporate networks | fine | fine | fine (it's just HTTP) | sometimes blocked | often blocked |
| Per-connection server cost | none | one held request | one held response | one socket + app state | one stream |
| Compression, auth, caching | free | free | free | you re-implement | you re-implement |

**The default should be SSE.** It is plain HTTP, so your headers, auth, compression, load balancer
and observability all keep working; and it hands you reconnection *and* replay for free — the two
things people get wrong when they build them by hand.

**Choose WebSocket when you genuinely need client→server messages at high frequency** (collaborative
cursors, multiplayer, a terminal). Not for "the client sometimes tells the server something" —
that's a `fetch`.

**Choose polling when updates are rare and staleness is cheap.** A 30-second poll is one line of
code, no connection state, no reconnection logic, and no 3am page. Real-time is a cost; make
something ask for it.

## Curriculum

| # | Lab | Question it answers | ⭐ |
|---|---|---|---|
| 01 | [Transports](labs/01-transports/) | Which one, and what does each cost? | ⭐⭐⭐⭐⭐ |
| 02 | [Reconnection](labs/02-reconnection/) | The connection dropped. Now what? | ⭐⭐⭐⭐⭐ |
| 03 | [Reconciliation](labs/03-reconciliation/) | You missed 40 messages. Is your UI wrong? | ⭐⭐⭐⭐⭐⭐ |
| 04 | [Collaboration](labs/04-collaboration/) | Two people edited the same thing. | ⭐⭐⭐⭐⭐⭐ |
| 05 | [Scale & backpressure](labs/05-scale-and-backpressure/) | 400 updates a second into a React tree. | ⭐⭐⭐⭐⭐ |

Prerequisites: [event-loop](../event-loop/) (why a firehose jams the main thread) and
[http-caching](../http-caching/) lab 01 (SSE is HTTP; everything you know still applies).

Related, already built: optimistic updates and conflict handling in
[architecture-and-state lab 04](../architecture-and-state/labs/04-consistency-and-sync/) and the
`#optimistic` route of the React sandbox.

## The three rules

1. **The transport is not the hard part.** Reconnection, ordering and reconciliation are.
2. **Assume every connection will drop, repeatedly, at the worst moment.** Mobile networks, sleeping
   laptops, load-balancer idle timeouts (typically 60s — send heartbeats), and deploys all do it.
3. **A real-time UI is a cache of server state.** Every cache question applies: how do you know it's
   stale, how do you invalidate it, and what do you show while you find out?
