# Lab 03 — Timers & observers ⭐⭐⭐⭐

**Goal:** recognise the leaks that keep *running*, and standardise on one cleanup mechanism for
all of them.

**Primary metric:** interval ticks, observer calls and rAF frames occurring *after* unmount.

> Open <http://localhost:8080/spa-memory-leaks/labs/03-timers-and-observers/>

---

## The concept

Timers and observers are **GC roots with a schedule**. They retain their callbacks (and therefore
your component), and they keep executing:

| Hazard | Retains | Also does |
|---|---|---|
| `setInterval` | callback + closure, forever | runs on schedule, often fetching |
| `setTimeout` | callback + closure until it fires | fires once (a 1-hour timeout retains for an hour) |
| `IntersectionObserver` | callback + observed elements | runs in the rendering steps |
| `ResizeObserver` | callback + observed elements | runs in the rendering steps, per frame |
| `MutationObserver` | callback + observed nodes | runs as a microtask (before paint) |
| Self-scheduling `rAF` | callback + closure, forever | one callback per frame, per instance |
| A promise that never settles | its continuation and closure | nothing — silently retains |

## Measure it

| Run | Interval ticks | Observer calls | rAF frames | Pending promises |
|---|---|---|---|---|
| A. setInterval | | | | |
| B. observers | | | | |
| C. rAF loop | | | | |
| D. pending promise | | | | |
| E. one AbortSignal | 0 | 0 | 0 | 0 |

## The version that reaches production

```js
useEffect(() => {
  setInterval(() => fetch('/api/notifications').then(render), 5000);
}, []);        // no cleanup returned
```

Navigate ten times → ten pollers. Your API sees 10× traffic from one user, nine of the renders
target detached DOM, and **the first symptom is usually a backend graph, not a frontend one**.
That's what makes this class expensive: it's discovered by the wrong team.

## The pattern to standardise on

```js
function mount(el) {
  const ac = new AbortController();
  const { signal } = ac;

  addEventListener('resize', onResize, { signal });          // native support

  const id = setInterval(tick, 1000);                        // wrap the rest
  signal.addEventListener('abort', () => clearInterval(id), { once: true });

  const io = new IntersectionObserver(cb);
  signal.addEventListener('abort', () => io.disconnect(), { once: true });

  fetch(url, { signal });                                    // native support

  return () => ac.abort();          // one cleanup function, impossible to get partially right
}
```

Better: wrap it once so nobody repeats the abort-listener dance:

```js
const { signal, onCleanup, dispose } = lifecycle();
onCleanup(() => clearInterval(id));
```

Lab 05 builds this into a component lifecycle.

## Details worth knowing

- **rAF loops need a flag, not just `cancelAnimationFrame`.** If the callback already scheduled
  the next frame, cancelling the old handle does nothing. Check an `alive` flag *inside* the
  callback.
- **rAF doesn't run in a background tab**, so this leak hides while you're not looking at it.
- **`ResizeObserver` fires inside the rendering steps.** A hundred stale observers is a hundred
  callbacks inside every frame that resizes anything — a jank problem as well as a memory one.
- **Pending promises don't show up in a listener or timer audit.** In a heap snapshot, look for
  objects retained by a `Promise` or an "async function context".
- **`setTimeout` retains until it fires.** A 30-minute "session expiry" timeout holds its whole
  closure for 30 minutes, per registration.

## Think about

- Why isn't `cancelAnimationFrame(handle)` enough to stop a self-scheduling loop?
- A component polls every 5s and the user navigates 20 times. What does your backend see?
- How would you find a leaked `setInterval` in a page you didn't write?

<details>
<summary>Answers</summary>

**cancelAnimationFrame.** By the time you cancel, the callback has usually already run and
scheduled the *next* frame under a new handle you don't have. The flag checked inside the callback
is what actually stops the chain; cancel the handle too, for the frame already queued.

**20 navigations.** 20 concurrent pollers: 4 requests/second from one user, growing linearly with
session length. You'll see it as a suspicious traffic pattern (one user, many identical requests,
never stopping) before anyone reports a slow page.

**Finding a leaked interval.** In dev, patch `setInterval`/`clearInterval` to keep a registry with
stacks, and print it on route change — that finds it in one navigation. Without patching:
Performance panel recording will show repeating `Timer Fired` tasks, and clicking one gives you
the registration stack in the Initiator/Call Tree.
</details>

---

## 🏗️ Build challenge: a lifecycle primitive

Build `lifecycle.js` — the smallest thing that makes all of this impossible to get wrong.

```js
const { signal, onCleanup, dispose, interval, timeout, observe, raf } = lifecycle();

interval(() => poll(), 5000);                  // auto-cleared
timeout(() => save(), 30_000);                 // auto-cleared
observe(new IntersectionObserver(cb), el);     // auto-disconnected
raf(function loop() { …; raf(loop); });        // auto-stopped
fetch(url, { signal });                        // native

dispose();                                     // everything, once
```

Requirements:

1. Idempotent `dispose()` — calling it twice must be safe (double-unmount happens).
2. Cleanups run in **reverse registration order**, and one throwing must not prevent the rest.
3. A dev-mode warning if a lifecycle is garbage collected without `dispose()` — use a
   `FinalizationRegistry`, and document that it's best-effort (lab 04).
4. `child()` producing a nested lifecycle disposed with its parent (`AbortSignal.any`).
5. A dev-mode registry of all live lifecycles with their creation stacks, plus `report()` — so
   "why do I have 47 live components on a page with 3" is answerable in one console call.
6. Zero-cost in production builds.

**Done when:** you can port lab 05's leaking router to it and every counter reads zero after
navigation, and the dev registry names any lifecycle you forget to dispose.

---

## Interview questions

1. What does an uncleaned `setInterval` retain, and what does it cost besides memory?
2. Why is a leaked observer a rendering problem as well as a memory one?
3. How do you stop a self-scheduling `requestAnimationFrame` loop?
4. How can a promise leak memory?
5. What's your one-mechanism answer for cleaning up listeners, timers, observers and fetches?
6. Where would this leak show up first in your monitoring?
