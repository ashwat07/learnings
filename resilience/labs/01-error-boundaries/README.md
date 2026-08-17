# Lab 01 — Error boundaries ⭐⭐⭐⭐⭐

**Goal:** know exactly what a boundary catches, what it misses, and where to put them.

**Primary metric:** how much of the page survives a thrown error.

```sh
cd react-sandbox && npm run dev     # then http://localhost:5173/#boundaries
```

> Source: [`react-sandbox/src/routes/boundaries.jsx`](../../../react-sandbox/src/routes/boundaries.jsx)

---

## What a boundary catches

A React error boundary is a class component with `getDerivedStateFromError` and/or
`componentDidCatch`. It catches errors thrown **during rendering, in lifecycle methods, and in
constructors of the tree below it.**

## What it does *not* catch — run each of these

| Thrown from | Caught? | Why |
|---|---|---|
| render / lifecycle below the boundary | ✅ | |
| an event handler | ❌ | the handler runs outside React's render, in a browser event — use `try/catch` |
| `setTimeout` / `requestAnimationFrame` | ❌ | different task, no React stack |
| a rejected promise (`async` work) | ❌ | there's no synchronous throw to intercept |
| the boundary's *own* render | ❌ | a boundary can't catch itself — you need one above it |
| server-side rendering | ❌ (differently) | SSR errors need their own handling |

The async cases are the ones that bite. The usual fix is to put the error **into state** so the next
render throws where a boundary can see it:

```jsx
const [, setError] = useState();
fetchThing().catch(e => setError(() => { throw e }));   // now the boundary catches it
```

Or use a data library (TanStack Query, RSC + Suspense) that does this for you.

## Granularity is the whole design

One boundary at the root is the same as no boundary: any error blanks the app.

| Placement | Effect |
|---|---|
| root only | one bad widget → white screen |
| per route | one bad route → the rest of the app navigates |
| **per widget** | one bad widget → a placeholder, everything else works |
| too fine | a boundary around every div is noise nobody reads |

**Rule: put a boundary wherever you'd be willing to show a placeholder.** That's the same question
as the tier model in [lab 03](../03-degradation/).

## Recovery

A boundary that only shows "Something went wrong" is half a feature. Give it:

- a **retry** that resets the boundary's state — and remounts the subtree via a changing `key`
- an escape hatch (go back, go home) so the user isn't trapped
- **reporting** in `componentDidCatch`, with `errorInfo.componentStack` — that stack is the thing
  that makes the report actionable

## The lazy-chunk case

Run the **lazy chunk failure** demo. `import()` rejecting after a deploy is the single most common
production error boundary trigger: the user's `index.html` references chunk hashes that no longer
exist.

The fix is specific — **reload the page once** (and guard with a sessionStorage flag so you can't
loop), because the new HTML references the new chunks. Don't retry the import; it will fail
identically.

## Think about

- Where do you put boundaries in an app with 30 routes?
- Why don't boundaries catch event handler errors?
- Should a boundary retry automatically?

<details>
<summary>Answers</summary>

**30 routes.** One at the root (last resort, with reporting), one per route (so a broken route
doesn't kill navigation), and one around each independently-valuable widget — dashboards, feeds,
third-party embeds. Plus one specifically around anything lazy-loaded, for the chunk case. The
question to ask per location is "would I ship a placeholder here?"

**Event handlers.** React only wraps rendering and lifecycle in its own try/catch — that's what a
boundary hooks into. An event handler runs as a browser event callback, outside that machinery, so
the error goes to `window.onerror` like any other. This is defensible: an error while rendering
leaves the UI in an unknown state, whereas an error in a click handler usually doesn't, so the right
response is a toast rather than unmounting a subtree.

**Automatic retry.** Once, with a delay, for errors that are plausibly transient (a chunk load, a
failed fetch turned into a render error). Never in a loop — a component that throws
deterministically will throw again, and an automatic retry loop is a busy-wait that burns battery
and floods your error reporting. Beyond one attempt it should be user-initiated.
</details>

---

## 🏗️ Build challenge

1. Build a reusable `<Boundary tier="critical|important|decorative">` whose fallback matches the
   tier, and which reports with `componentStack`, route, and release version.
2. Add a retry that remounts via `key`, and a once-only reload for chunk errors.
3. Add `window.onerror` and `unhandledrejection` handlers so errors outside React are reported too —
   the boundary is not your error strategy, it's one piece of it.
4. Write a test per boundary that renders a throwing child and asserts the rest of the page is still
   there. Without it, someone will hoist a boundary to the root during a refactor.
5. Turn on the chaos injector from [lab 05](../05-chaos/) and use the app for ten minutes.

**Done when:** every boundary in the app has a test proving what survives when its child throws.

---

## Interview questions

1. What does an error boundary catch, and name three things it doesn't.
2. How do you get an async error into a boundary?
3. Why does boundary *placement* matter more than boundary *code*?
4. `import()` fails after a deploy — what do you do and why?
5. What belongs in a good error report from `componentDidCatch`?
