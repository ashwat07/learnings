# Lab 04 — An RPC layer ⭐⭐⭐⭐⭐

**Goal:** make a worker feel like a module, and find out exactly what that abstraction has to
handle — by building the parts that break.

**Primary metric:** the seven tests on the page.

> Open <http://localhost:8080/web-workers/labs/04-rpc/>

---

## The concept

Raw `postMessage` pushes the same boilerplate into every worker:

```js
// worker
self.onmessage = (e) => {
  switch (e.data.type) {                 // a hand-rolled dispatcher
    case 'search': …
    case 'load': …
  }
};
// page
worker.postMessage({ type: 'search', id: 17, q });   // hand-rolled correlation ids
```

An RPC layer replaces all of that with a `Proxy` and a promise map:

```js
const api = wrap(new Worker('./worker.js', { type: 'module' }));
const hits = await api.search('ada');
```

The core is ~40 lines and it's in `rpc.js`. What follows is why the real thing (Comlink) is ~900.

## The five things the happy path doesn't handle

### 1. Errors lose their class

An `Error` structured-clones (`name`, `message` and `stack` survive), but a **custom error class
arrives as a plain object/Error**: the prototype is gone, so `err instanceof NotFoundError` is
false and your `catch` falls through to the generic branch. Custom fields need explicit copying.

You must reconstruct a useful error on the page side: preserve `name`, `message`, the worker-side
`stack`, and enumerable own properties — and mark it so a reader can tell the stack came from
another thread. (A stack trace that stops at `postMessage` is a debugging dead end; two stacks
stitched together is what you actually want.)

### 2 & 4. Transferables, in both directions

Arguments *and* return values get structured-cloned unless you build a transfer list. A 4MB
`ArrayBuffer` returned from a worker is a 4MB copy — measurable, and blocking.

Design decision to make explicitly: **automatic detection or an explicit marker?**

- Automatic is convenient and surprising: the caller's buffer is silently detached, and a bug
  where you use it afterwards is invisible (Lab 02).
- Explicit (`api.process(transfer(buf))`, which is Comlink's choice) is verbose and honest.

Write down which you chose and why. This is the kind of API decision an interviewer will
actually dig into.

### 3. Callbacks

`api.count(pred, onProgress)` throws `DataCloneError` — functions aren't cloneable.

The fix: create a `MessageChannel` per callback, transfer one port to the worker, and invoke the
local function when the port receives a message. **Close the port when the call settles**, or
you've leaked the port and everything the callback closes over — a leak inside a worker that no
page navigation will clean up.

### 5. Cancellation

`AbortSignal` isn't cloneable either. You need a protocol: a `cancel` message carrying the call
id, a per-call flag the worker checks between slices, and an `AbortError` rejection on the page.

And then the hard part from Lab 03: a worker in a synchronous loop never sees the cancel. Decide
what your *transparent* RPC layer does about that — and whether it's allowed to terminate and
respawn a worker on the caller's behalf without telling them. (My answer: no, not silently. Expose
it as an option with a clearly named cost.)

## The shape to aim for

Look at what crosses the boundary in `worker.js`:

```js
await api.load('/api/rows?n=200000');   // a URL in
await api.search('ada', 20);            // a query in, 20 rows out
```

200,000 rows are fetched, parsed and indexed **inside the worker** and never cross the boundary.
Every later call is a tiny message. That's the pattern:

> **Long-lived state in the worker. Queries over the wire. Small results back.**

A worker you send your dataset to on every call is a worker that mostly performs structured
clones.

## Think about

- Should `wrap()` be transparent about being remote, or should the API make it obvious?
- What happens to in-flight calls when the worker crashes? (Check `rpc.js`.)
- How do you debug a stack trace that crosses a thread boundary?

<details>
<summary>Answers</summary>

**Transparency.** Comlink is deliberately transparent, and that's both its appeal and its trap:
`await api.getUser()` looks like a local call, so people write it in a loop and pay a round trip
per item (Lab 02: ~0.5ms each). A small amount of visible friction — a namespace, a `remote.`
prefix, a lint rule against awaiting in loops — prevents a whole category of performance bug. My
preference: transparent mechanics, obvious naming.

**Worker crash.** Every pending promise must be rejected, or they hang forever and the calling
code just... stops. `rpc.js` does this in the `error` listener. This is the single most important
five lines in the file: a hang is worse than an error, because it produces no signal at all.

**Cross-thread stacks.** Capture a stack on the *page* side when the call is made (`new
Error().stack` at call time), and stitch it onto the worker's stack when the error comes back.
Without it your trace shows only worker internals and you'll never find the caller.
</details>

---

## 🏗️ Build challenge: finish it, then justify it

Complete all five TODOs so the tests pass, then take it further:

1. **Nested proxies**: `await api.db.users.find(...)`. The `get` trap returns another proxy that
   accumulates a path; the call sends the whole path. ~10 lines, and it changes how you'd
   structure a worker API.
2. **Object references**: return a *handle* to a worker-side object rather than a copy
   (`const cursor = await api.openCursor(); await cursor.next()`). This needs a registry in the
   worker, and therefore a `release()` — and therefore a leak if callers forget. Use a
   `FinalizationRegistry` to release automatically, and **document that it's best-effort**, because
   GC is not guaranteed to run. (This is exactly Comlink's `releaseProxy` problem.)
3. **Streaming results**: return a `ReadableStream` (transferable) so a search can yield hits as
   it finds them instead of buffering all of them.
4. **A batching layer**: coalesce calls made in the same microtask into one message. Then measure
   the difference on a loop of 1,000 tiny calls — this is the fix for the "transparent API used in
   a loop" problem above.
5. **Type safety**: if you use TypeScript, type `wrap<T>()` so `api` has the worker API's types
   with every method's return wrapped in a `Promise`. That's the ergonomic payoff of the whole
   exercise.

**Done when:** the seven tests pass, a 1,000-call loop is under 50ms with batching (vs ~500ms
without), and you can hand someone the worker file and have them understand the API without
reading a line of message plumbing.

---

## Interview questions

1. Why does `err instanceof MyError` fail after crossing a worker boundary?
2. How would you pass a callback to a worker?
3. What must happen to in-flight RPC calls when a worker dies?
4. Automatic transferables vs an explicit marker — argue for one.
5. What's the cost of making a worker API look local, and how do you mitigate it?
6. How would you implement `await api.db.users.find()` with a single Proxy?
