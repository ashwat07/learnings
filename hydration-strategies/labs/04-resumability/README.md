# Lab 04 — Resumability ⭐⭐⭐⭐

**Goal:** understand the idea well enough to steal it, and to state honestly what it costs.

**Primary metric:** JS executed on load (should be ~0 regardless of component count) and
first-interaction latency.

> Open <http://localhost:8080/hydration-strategies/labs/04-resumability/>

---

## The idea

Hydration re-executes your components on the client so the framework can **discover** which element
has which handler and what it closes over.

Resumability observes that **the server already knew all of that** — and writes it into the HTML:

```html
<div data-component data-state='{"count":3}'>
  <span data-value>3</span>
  <button data-on-click="./handlers.js#increment">+</button>
</div>
```

The client ships one global listener ([`resume.js`](resume.js), 30 lines). On an event it looks up
the reference, dynamically imports the module, deserialises the state from the DOM, and calls the
function. **No component code runs on load.**

Read `resume.js` before anything else — once you have, the idea stops sounding magical. It's a
lookup table instead of a re-execution.

## Measure it

| | value |
|---|---|
| components on the page | |
| component code executed on load | **0** |
| runtime shipped on load | |
| TBT contribution of hydration | **0ms — there is none** |
| first click on a handler | |
| second click | |

The property being demonstrated: **O(1) startup instead of O(components).** Ten components or ten
thousand, the load cost is the same listener.

## The honest comparison

| | Full hydration | Islands / lazy | Resumability |
|---|---|---|---|
| Load-time cost | N × per-component | eager islands only | ~0 |
| Scales with | component count | eager island count | nothing |
| First interaction | instant | instant, or the island's cost | **one dynamic import** |
| Ships on load | framework + all components | framework + eager islands | a small listener |
| Uncanny valley | yes | reduced | **none** |

### What it costs

1. **The first interaction with each handler pays a network round trip.** Invisible on fast
   connections; a click that hangs on 3G. Frameworks mitigate by speculatively prefetching handler
   chunks on hover/idle — which is Lab 03's interaction trigger, again.
2. **All state must be serialisable into HTML.** No functions, no class instances, no DOM
   references, no closures over unwritable things. (Same constraint as `postMessage` and RSC props.
   It keeps coming back because it's the same problem: state crossing a boundary.)
3. **The HTML gets bigger.** Every handler reference and every piece of state is bytes on the wire,
   on every page load, including for users who never interact.
4. **It requires a compiler.** You can't write ordinary closures and have them split into
   separately-loadable chunks by hand — that's Qwik's entire optimiser, and it's the reason
   resumability isn't a library you can adopt incrementally.

## The serialisation trap

Run the demo. Note the **silent** failures:

| State value | Serialisable? | What happens |
|---|---|---|
| number, string, boolean, plain object | ✅ | fine |
| `Date` | ⚠️ | survives as a **string**, comes back as a string — `state.createdAt.getTime()` throws on the *second* interaction, not the first |
| `Map` / `Set` | ❌ with JSON | needs a custom codec |
| a function | ❌ | `JSON.stringify` returns `undefined` and **omits it silently** — no error |
| a DOM node | ❌ | — |
| a reference to another component's state | ⚠️ | only with an id-based scheme |

This is why real resumability frameworks ship their own serialiser: Dates, Maps, Sets, circular
references, and — the hard one — **references between pieces of state**, so two components sharing
an object still share it after resuming rather than getting two copies.

## The idea worth stealing

Even if you never use Qwik:

> **Put what the server already knew into the HTML, instead of making the client recompute it.**

That's the same principle as SSR, applied to *behaviour* instead of *markup*. Places you can apply
it today without adopting a framework:

- `data-*` attributes carrying computed values, instead of recomputing them client-side
- handler references resolved on demand (exactly this lab) for rarely-used widgets
- server-rendered ARIA state, so assistive tech is correct before any JS runs
- pre-serialised initial store state (most SSR frameworks already do this — check whether yours
  ships it *and* refetches it, which is a common and invisible duplication)

## Think about

- Why does resumability need a compiler, when islands don't?
- Your state contains a `Date`. What breaks, and when?
- Is resumability faster than islands? Under what measurement?

<details>
<summary>Answers</summary>

**Why a compiler.** Islands are a *manual* boundary: you point at a component and say "this one".
Resumability needs every closure to be independently loadable — a handler that closes over three
variables must become a chunk that can reconstruct those three variables from serialised state. No
human writes that by hand; it's a source transformation.

**The Date.** It serialises to a string. First interaction works (the handler receives the value
the server made). After the first `data-state` write-back it's a string, so any method call on it
throws. This is the worst kind of bug: correct on the path you tested, broken on the second
interaction, and only in production where you didn't re-run the server render.

**Faster than islands?** On *startup*, yes, and unboundedly so as component count grows — that's the
real claim. On *first interaction*, it can be slower (a round trip vs already-loaded code). On total
bytes for a heavily-used page, similar. The metric that decides it is which one your users
experience: a content site where most visitors interact with two things favours resumability; an app
where the user immediately starts clicking favours having already loaded the code. Measure your
interaction distribution before believing either camp.
</details>

---

## 🏗️ Build challenge: make it real

Extend the 30-line runtime until it could plausibly run a page:

1. **More events**: `input`, `change`, `submit`, `keydown`, plus delegated handling for elements
   added later. Watch out for `submit` — you must `preventDefault` *before* the async import, then
   decide whether to re-submit.
2. **A serialiser** that handles `Date`, `Map`, `Set`, `undefined`, and **shared references** (two
   components pointing at the same object must still share it after resuming — use an id table and
   a two-pass encode).
3. **Speculative prefetch**: on `pointerover`/`focusin`, `import()` the handler module without
   running it, so the click is instant. Measure the hit rate — if hover rarely precedes clicks in
   your app (touch devices), this buys nothing and costs bytes.
4. **A build step** that takes ordinary component source with inline handlers and emits the
   attribute form plus per-handler chunks. Even a crude version teaches you why the real one is
   hard: closure capture.
5. **Correctness tests**: state survives multiple interactions; two components with the same handler
   don't share state; a failed module load leaves the page usable and reports the error.
6. **Compare it** against Lab 03's lazy hydration on the same page: TBT, JS on load, first
   interaction latency, and total bytes after 5 interactions. Write down which wins on which metric
   and for which user.

**Done when:** your page has 1,000 components, 0ms of startup JS, a first interaction under 100ms
with prefetch, and state that survives ten interactions across three components.

---

## Interview questions

1. What does resumability replace, and with what?
2. Why is startup cost O(1) rather than O(components)?
3. What must be true of all component state for this to work?
4. What does the first interaction cost, and how do frameworks hide it?
5. Why does resumability require a compiler when islands don't?
6. Name one idea from resumability you could apply to an app that will never adopt it.
