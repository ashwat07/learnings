# Lab 01 — Transports ⭐⭐⭐⭐⭐

**Goal:** choose a transport from the shape of the traffic, not from what's fashionable.

**Primary metric:** HTTP requests, bytes, and median latency for the same stream.

> <http://localhost:8080/realtime-ui/labs/01-transports/>

---

## Run all three for 30 seconds

| transport | HTTP requests | messages | payload bytes | median latency |
|---|---|---|---|---|
| polling (2s) | | | | |
| SSE | | | | |
| WebSocket | | | | |

**Polling** made one request per interval whether or not anything changed. Each carries full headers
and cookies — often 800–1500 bytes of overhead for a 40-byte "nothing new". Its latency averages
half the interval, by construction.

**SSE** made one request and has been receiving since. The interesting part is the code you *didn't
write*: reconnection, backoff, resume-from-id, and the framing parser all live in the browser.

**WebSocket** upgraded one request and can send both ways. Note the `onclose` handler — it logs, and
that's all. Everything after "the connection dropped" is yours (lab 02).

## The decision

| Question | Answer |
|---|---|
| Does the client send frequently? | yes → WebSocket · no → SSE or polling |
| Binary frames? | yes → WebSocket (SSE is text only) |
| Is 30s staleness fine? | yes → poll, and stop reading |
| Hostile proxies / corporate networks? | SSE — it's ordinary HTTP |
| Want reconnection *with resume* for free? | SSE |
| Many idle connections? | both hold server resources; polling holds none between requests |
| Many tabs? | **both open one connection per tab** unless you share via a `SharedWorker` |

## The two operational facts that decide more architectures than the feature table

**1. SSE is HTTP.** Your load balancer, auth middleware, compression, rate limiting, tracing and
error dashboards keep working unchanged. A WebSocket bypasses most of that stack, and you'll rebuild
the parts you needed — usually after an incident.

Two historical caveats, both mostly gone: over HTTP/1.1 the ~6-connections-per-origin limit meant a
few open streams could starve a site (HTTP/2 multiplexes, so it's a non-issue); and some proxies
buffer streamed responses, which is why this server sends `X-Accel-Buffering: no`.

**2. Connections are per tab.** Ten tabs is ten connections and ten times the fan-out. If that
matters, put the connection in a `SharedWorker` and broadcast to tabs over a `BroadcastChannel` —
one socket per *browser*. See [web-workers lab 05](../../../web-workers/labs/05-when-not-to/).

## The honest default

**Most features that ask for real-time don't need it.** A 30-second poll has no connection state, no
reconnection logic, no heartbeat, no reconciliation and no 3am page. Make the requirement earn the
complexity.

## Think about

- You need real-time updates *and* the client sends a message once a minute. Which transport?
- Why isn't long-polling in most modern stacks?
- What does SSE cost your server that polling doesn't?

<details>
<summary>Answers</summary>

**Real-time down, occasional up.** SSE plus ordinary `fetch` for the upward messages. Once a minute
is not a reason to hold a bidirectional socket, and the `fetch` path keeps your existing auth,
retries, error handling and observability. The instinct to "just use WebSockets since we need both
directions" is where a lot of accidental complexity enters.

**Long-polling.** It solved the same problem as SSE before SSE existed, but with worse ergonomics: a
new request per message, so you rebuild ordering and resume yourself, and every message pays a full
request/response round trip. It survives as a fallback in libraries like Socket.IO for networks
where nothing else works.

**What SSE costs.** A held-open response per client — a socket, a file descriptor, and whatever
per-connection memory your framework attaches. Polling holds nothing between requests, which is why
it scales trivially and why an idle-heavy audience (a dashboard left open on 5,000 desks) can be
cheaper to serve by polling. Also budget for the load balancer's idle timeout and for the fact that
a deploy disconnects everyone at once — see lab 02.
</details>

---

## 🏗️ Build challenge

Take one feature in your app that currently polls. Measure, over 10 minutes of realistic use:
request count, total bytes (headers included — check the Network panel's *Size*, not *Content*), and
staleness at the 95th percentile. Then implement it with SSE and measure again. Include the server
cost: connections held, memory per connection.

**Done when:** you can state the trade in numbers and say which you'd ship, and why.

---

## Interview questions

1. SSE vs WebSocket — name three things SSE gives you for free.
2. When is polling the right answer?
3. Why might a WebSocket work in dev and fail on a corporate network?
4. Ten tabs, one user. How many connections, and how would you fix that?
