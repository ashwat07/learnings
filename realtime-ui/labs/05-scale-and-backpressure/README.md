# Lab 05 — Scale & backpressure ⭐⭐⭐⭐⭐

**Goal:** keep a UI usable under a firehose, and know which messages you're allowed to drop.

**Primary metric:** FPS, against received/rendered/dropped counts.

> <http://localhost:8080/realtime-ui/labs/05-scale-and-backpressure/>

---

## The mistake

Start at **200/s** with **render every message**. FPS collapses. The page is technically up to date
and completely unusable.

The mistake isn't the transport. It's treating **"a message arrived"** and **"the screen should
change"** as the same event. The screen changes at most 60 times a second, so anything above that
rate is work whose output nobody ever sees.

## Four strategies

| Strategy | Loses | Use for |
|---|---|---|
| **coalesce per frame** (rAF) | nothing | the default for any high-rate feed |
| throttle to N/s | nothing | expensive renders; data meaningless at 60Hz |
| **conflate by key** | superseded values, on purpose | tickers, cursors, "current state" facts |
| sample (every Nth) | arbitrary messages | almost never — you can't say what you dropped |
| bounded queue, drop oldest | the oldest | logs and feeds where recency wins |
| bounded queue, reject new | the newest | when order matters more than freshness |
| **ask the server to send less** | nothing | the real fix |

Record for each:

| strategy | received | rendered | dropped | FPS |
|---|---|---|---|---|
| naive | | | | |
| rAF coalesce | | | | |
| throttle 4/s | | | | |
| conflate | | | | |

**Coalescing loses nothing** — every message is still rendered, just grouped into one DOM write. It's
about four lines of code and should be your default.

In React the equivalent is letting one render handle a batch. React 18 batches automatically, but a
store that fires a listener per message will still schedule a render per message unless you buffer
*before* you `setState`.

## Fact or event?

The question that decides whether you're allowed to conflate:

> **Is each message a fact or an event?**

A **fact** ("the price is now X") supersedes its predecessor — conflating is correct, and delivering
the superseded value actively costs frames the current one needs. An **event** ("a trade occurred")
cannot be dropped without losing information forever.

Chat messages are events. Cursor positions are facts. Getting this wrong in either direction is the
bug.

## The fix that actually scales

**Don't subscribe to what you're not showing.** A table displaying 20 of 5,000 rows should subscribe
to 20 symbols, and change that subscription as the user scrolls. Every client-side backpressure
strategy is damage control for data you asked for and didn't need.

Other server-side levers:

- **server-side conflation** — one update per key per interval, computed once instead of 10,000
  times in 10,000 browsers
- **a slow-consumer policy** — if a client can't keep up, drop it and make it re-snapshot, rather
  than growing an unbounded buffer in your server for one bad connection
- SSE `retry:` and application-level "back off" messages, so you can shed load deliberately

And client-side fixes that aren't about the queue:

- **virtualize** the list, so DOM nodes don't grow with the data
- **parse and aggregate in a worker**, so the main thread receives only what it will draw
  ([web-workers labs 01 & 03](../../../web-workers/))
- **stop rendering when the tab is hidden** — a background tab animating a ticker is pure battery
  cost

## Think about

- Your feed sends 1,000 msg/s and the user watches 20 rows. Where's the fix?
- When is dropping messages the *correct* behaviour?
- Why is `requestAnimationFrame` a better flush trigger than `setTimeout(0)`?

<details>
<summary>Answers</summary>

**1,000/s for 20 rows.** In the subscription. Everything else — coalescing, conflation, virtualizing
— is mitigating a decision you can simply reverse. Subscribe to the visible keys, update the
subscription on scroll (debounced), and the problem stops existing. If the server can't do
per-key subscriptions, that's the feature request; it's cheaper than the client-side machinery.

**Correct dropping.** When each message is a *fact* that supersedes its predecessor, and when the
consumer is the screen. Delivering a price nobody will ever see costs a frame that the current price
needs. The test: if you can reconstruct the correct final state from the messages you kept, dropping
was correct.

**rAF vs `setTimeout(0)`.** rAF fires exactly once per frame, immediately before the browser paints,
so you get one flush per visible update and your write lands at the right point in the frame.
`setTimeout(0)` fires as fast as the task queue allows — often several times per frame — so you do
more work for the same pixels, and you can land a DOM write in the middle of a frame's layout,
forcing extra work. rAF also *stops* in a hidden tab, which is free battery saving.
</details>

---

## 🏗️ Build challenge

Take your highest-frequency feed and:

1. Instrument received/rendered/dropped and FPS during a busy period.
2. Add rAF coalescing. Re-measure.
3. Classify your messages fact vs event. Conflate the facts by key.
4. Move parsing into a worker; post only render-ready data to the main thread.
5. Make the subscription follow the viewport.
6. Add a `visibilitychange` handler that unsubscribes (or coarsens) when hidden and re-snapshots on
   return.

**Done when:** 60 FPS at your peak message rate, with the subscription sized to the viewport.

---

## Interview questions

1. Why is one DOM write per message wrong?
2. Coalescing vs conflation — which loses data, and when is that correct?
3. What's the difference between a fact and an event here?
4. Why is the real fix usually on the server?
5. What should happen when the tab is hidden?
