# Lab 05 — When *not* to use a worker ⭐⭐⭐⭐

**Goal:** be able to say, with numbers, whether a worker is the right tool for a specific job —
and know the two cases where the answer is obviously yes.

**Primary metric:** spawn cost, round-trip latency, and the crossover point.

> Open <http://localhost:8080/web-workers/labs/05-when-not-to/>

---

## The three fixed costs

| Cost | Typical (desktop) | Typical (mid phone) |
|---|---|---|
| `new Worker()` → ready | 10–40ms | 50–250ms |
| Round trip per call | 0.1–0.5ms | 0.5–2ms |
| Payload copy | see Lab 02 | worse |

Measure them on the page. Then all the guidance below is arithmetic on your own numbers:

| Measurement | Yours |
|---|---|
| spawn cost | |
| round-trip latency | |
| crossover task size | |

## The crossover

Run the sweep. Same total work, different task sizes, one worker call per task:

| Task size | Main thread | Worker | Overhead |
|---|---|---|---|
| 0.1ms | | | |
| 1ms | | | |
| 5ms | | | |
| 25ms | | | |
| 50ms | | | |

Small tasks are dominated by the round trip; big ones amortise it. Per-call messaging usually
crosses over somewhere around 5–20ms of work per call.

**But** — and this is the point of the lab — that table measures *total time*, not
*responsiveness*. Even where the worker is 30% slower overall, the main thread stayed free the
whole time. "The worker is slower" is not by itself an argument against it; it's an argument
against *that shape* of using it.

And the shape is usually the problem: **one call with all the work beats N calls with a slice
each**, at any task size. If your sweep shows the worker losing, check whether you're paying the
round trip per item.

## When a worker is the wrong tool

| Situation | Do this instead |
|---|---|
| Work under ~5ms | Just do it on the main thread |
| Work you can chunk and yield through | `scheduler.yield()` chunking — event-loop course, Lab 03 |
| Work dominated by payload size | Move the data boundary, or don't move the work |
| Animation of `transform`/`opacity` | CSS/WAAPI — it's already off the main thread |
| Anything needing the DOM | It can't. Compute in the worker, apply on the main thread |
| Work you could simply not do | Fix that first. Nothing beats deleting the work |
| Work the server could do | Especially for initial render — a worker still runs on the user's phone |
| Nothing measurable is janking | Don't. You're adding a thread, an async boundary, a build config and a debugging tax for a hypothesis |

That last row matters. A worker permanently changes your code: every call is async, errors cross a
thread boundary (Lab 04), state is duplicated or unreachable, and your bundler needs to emit a
separate entry point with the right `type: 'module'` and public path. That's a real ongoing cost
paid by everyone who touches the code afterwards.

## When it's unambiguous

1. **A single unbreakable operation over ~50ms**: a big `JSON.parse`, crypto, compression, image
   decode/encode, a heavy regex, wasm compute. You cannot chunk these, so a worker is the only
   option.
2. **OffscreenCanvas rendering** that must stay smooth while the main thread does unpredictable
   work — charts on a busy dashboard, maps, games, live waveforms.

Run demo 3: block the main thread for 2 seconds and watch the worker-rendered canvas keep going.

### OffscreenCanvas constraints, before you commit

- `transferControlToOffscreen()` is **one-way and once per canvas**.
- The worker has **no DOM**: no `getBoundingClientRect`, no CSS, no hit testing. You forward input
  events yourself, with coordinates computed on the main thread.
- Fonts must be loaded by the page; text metrics work in the worker.
- Debugging is harder — separate DevTools context, and errors don't reach `window.onerror`.

## Module workers and bundling

```js
new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
```

That exact form is what modern bundlers (Vite, webpack 5, Rollup, esbuild) statically detect to
emit the worker as a separate chunk with correct URLs. Anything dynamic —
`new Worker(someVariable)` — usually breaks the build silently, producing a worker that 404s in
production and works in dev.

`type: 'module'` also gets you `import` inside the worker instead of `importScripts`, and strict
mode by default. Use it; the only reason not to is very old Safari.

## Think about

- Your team wants to "move everything heavy to workers". What do you ask for first?
- When is a worker slower *and* still the right call?
- What's the smallest change that would let you skip the worker entirely?

<details>
<summary>Answers</summary>

**"Move everything heavy."** Ask for a profile with an actual long task, with its duration, and
the interaction it delays. Then ask whether that task can be chunked, cached, made smaller, or
moved to the server. Workers are the answer to "one unbreakable CPU-bound operation is blocking
interaction" — a narrower question than "this is slow".

**Slower and still right.** Whenever a user is interacting during the work. Total duration of
background work is nearly imperceptible; a frozen UI is instantly noticeable. Report both numbers
so nobody can accuse you of hiding the regression.

**The smallest change.** Usually one of: request less data (pagination, field selection); parse
less (NDJSON, or let the server pre-aggregate); or cache the result so the work happens once
instead of per interaction. In practice the "do less work" fix beats the "do the work elsewhere"
fix most of the time — and it's the one nobody suggests, because moving work is more fun than
deleting it.
</details>

---

## 🏗️ Build challenge: a decision record

Not code — the artefact that makes the code defensible.

Pick a real piece of heavy work in an app you know. Produce a one-page ADR:

1. **The measurement**: the long task, its duration at 4× throttle, and the interaction it delays
   (with the INP number).
2. **The options**, each costed with numbers from *this* lab: do less work · chunk it · worker ·
   OffscreenCanvas · server-side · wasm.
3. **The recommendation**, with the crossover arithmetic: payload size × clone rate, spawn cost,
   round trips per interaction.
4. **What it costs**: build config, debugging, error reporting, testing, the new async boundary in
   the API.
5. **How you'll know it worked**: the metric, the target, and the regression gate.

Then implement it and check your prediction against reality. Write down where you were wrong —
that's the part that makes you good at this rather than merely opinionated.

**Done when:** someone who disagrees with your conclusion can point to the exact number they'd
dispute.

---

## Interview questions

1. What does a worker cost before it runs any of your code?
2. Where's the crossover between "do it on the main thread" and "send it to a worker"?
3. Name three things you'd try before reaching for a worker.
4. When is a worker slower overall and still correct?
5. What can't you do inside an OffscreenCanvas worker?
6. Why does `new Worker(new URL('./w.js', import.meta.url))` matter to your bundler?
