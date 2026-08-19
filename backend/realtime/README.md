# Real-time, webhooks & streaming

**No containers.** The cross-instance bus in [`world.mjs`](world.mjs) behaves like Redis pub/sub —
fire and forget, no replay, no acknowledgement — so the lessons transfer and the tests are
deterministic.

```sh
npm run drills:rt                  # all five, from backend/
npm run drills:rt -- 03            # just one
npm run drills:rt -- 03 --solution
```

| | | The starting code |
|---|---|---|
| **01** | WebSocket frames | two-byte header, no masking, one chunk = one frame |
| **02** | Rooms, presence & fan-out | works perfectly — until you run two pods |
| **03** | **Webhook signing** | `===` on the digest, no timestamp, no replay memory |
| **04** | Webhook delivery | one hanging endpoint stalls **everything** for 20s |
| **05** | SSE & resume | ignores `Last-Event-ID`; a newline in a payload ends the event |

## What each one is about

**01 — Frames.** A WebSocket is a TCP stream after an HTTP upgrade, and everything above it is
frames you draw yourself: the 7/16/64-bit length ladder, the mask (which exists to prevent *cache
poisoning*, not for confidentiality — the key is sent in clear next to the data), fragmentation,
and the rule that catches people: **a ping can arrive between two fragments of a message** and must
not be spliced into it. The byte vectors in the checks are from RFC 6455 §5.7.

**02 — Rooms and fan-out.** An in-process room is correct for exactly one process. Then you scale
to two pods and half your users stop receiving anything, intermittently, in a way that looks like a
client bug. The drill runs three hubs over one bus and checks each message arrives **exactly once**
— because the bus delivers your own publication back to you, and re-publishing what you received is
an amplifier that takes out the cluster. Plus: auth before accept (there is no 401 after an
upgrade), a heartbeat (TCP will not tell you the peer is gone), and cutting a client that stops
reading before its backlog becomes your heap.

**03 — Webhook signing.** The runner is the attacker. Fifteen checks, each a real shipped bug:
signing the re-serialised JSON instead of the bytes that arrived, no timestamp inside the HMAC (so
an attacker edits `t` and replays forever), accepting a request twice, checking only the first `v1`
so the secret can never be rotated. The timing check measures a **258× difference** between an
early-return compare and `timingSafeEqual`.

**04 — Webhook delivery.** Now you are the provider, with six customer endpoints: healthy, flaky,
500ing, 410 Gone, rate-limiting, and one that holds every connection open without answering. The
starting code takes **20 seconds and delivers 20 of 120**. The reference finishes in 1.5s, retries
5xx with jittered backoff, honours `Retry-After`, spends exactly **one** attempt on the 410, and
times out the hanging endpoint instead of waiting on it.

**05 — SSE and resume.** The transport people skip on the way to WebSockets, and usually the better
answer for one-way data: plain HTTP, reconnects on its own, and the browser **replays the last
event id it saw** so you can resume with no gap. Plus the framing bug that ships every time —
`data:` is a *line* field, so a payload containing a real newline silently ends the event.

## Related

- [`../jobs-and-messaging/`](../jobs-and-messaging/) — Redis Streams, consumer groups and DLQs: pub/sub's durable cousin
- [`../node-runtime/drills/04-binary-framing/`](../node-runtime/drills/04-binary-framing/) — the same framing state machine, without a protocol on top
- [`../node-runtime/drills/05-backpressure/`](../node-runtime/drills/05-backpressure/) — the slow-consumer problem, over streams
- [`../auth-and-security/`](../auth-and-security/) — the constant-time comparison drill, and the runner as attacker
- [`../../realtime-ui/`](../../realtime-ui/) — the browser half: reconnection, reconciliation, CRDTs
