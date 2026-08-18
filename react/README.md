# React — the model, the internals, and building one ⭐⭐⭐⭐⭐⭐

Most React material teaches the API. This course teaches the **machine**: what an element is, where
hook state lives, what reconciliation actually compares, and what changed when rendering became
interruptible. The last lab is a working React in 260 lines — after which none of the earlier
questions are mysterious.

```sh
# labs 01–06 run in the shared sandbox
cd react-sandbox && npm install && npm run dev      # http://localhost:5173

# lab 07 needs nothing at all
./serve.sh   # then http://localhost:8080/react/labs/07-mini-react/
```

> **StrictMode is on deliberately** in the sandbox, so renders and effects double-invoke in
> development. If a number looks doubled, that's why — and it's the honest number to think about.

---

## Curriculum

| # | Lab | Question it answers | ⭐ |
|---|---|---|---|
| 01 | [The core model](labs/01-core-model/) | What is an element, and what does JSX compile to? | ⭐⭐⭐⭐ |
| 02 | [Hooks in depth](labs/02-hooks-in-depth/) | Batching, effect timing, stale closures, dependency arrays | ⭐⭐⭐⭐⭐ |
| 03 | [Rendering & reconciliation](labs/03-rendering-and-reconciliation/) | What triggers a re-render, and what does a key decide? | ⭐⭐⭐⭐⭐ |
| 04 | [State, data & types](labs/04-state-data-and-types/) | Where does state live, and how do you type all of this? | ⭐⭐⭐⭐⭐ |
| 05 | [Patterns](labs/05-patterns/) | Compound, controllable, headless — designing a component API | ⭐⭐⭐⭐⭐ |
| 06 | [Concurrent React](labs/06-concurrent/) | Transitions, Suspense, and the one new bug: tearing | ⭐⭐⭐⭐⭐⭐ |
| 07 | **[Write a mini React](labs/07-mini-react/)** | All of the above, mechanically | ⭐⭐⭐⭐⭐⭐ |

Prerequisites: [javascript](../javascript/) labs 01 and 05 (closures decide what a hook captures;
microtasks decide when batching flushes) and [typescript](../typescript/) labs 02–04 for lab 04.

## The four things worth taking away

**1. "Re-render" means "the function ran".** It does not mean the DOM changed. Lab 07 shows the gap
directly: a state change re-runs every child component, and reconciliation then decides that almost
nothing needs writing. Most "performance work" in React is really about the first half; most of the
*cost* is in the second.

**2. A key is an identity, not a hint.** It decides which fiber — and therefore which hook state and
which DOM node — an element continues. `test.mjs` in lab 07 asserts the corruption index keys cause:
the label changes and the state doesn't.

**3. Hooks are a list indexed by call order.** There are no names. That single implementation detail
is the entire reason for the rules of hooks, why custom hooks compose for free, and why you can't
call one from a callback.

**4. Rendering is interruptible, and that's where everything modern comes from.** Transitions,
Suspense, and the existence of `useSyncExternalStore` all follow from "React can build a tree and
throw it away".

## Where the React material in this repo lives

Several other courses already own a piece of React, and this course cross-references rather than
repeats them:

| Topic | Where |
|---|---|
| render cost, `memo`, virtualization, profiling | [web-vitals-and-react-perf lab 05](../web-vitals-and-react-perf/labs/05-react-render-perf/) |
| state strategy: local / context / store / server / URL | [architecture-and-state lab 02](../architecture-and-state/labs/02-state-strategy/) |
| optimistic updates and rollback | [architecture-and-state lab 04](../architecture-and-state/labs/04-consistency-and-sync/) |
| reducers as state machines | [architecture-and-state lab 05](../architecture-and-state/labs/05-state-machines/) |
| error boundaries and what they miss | [resilience lab 01](../resilience/labs/01-error-boundaries/) |
| RSC, streaming SSR, hydration | [rendering-strategies](../rendering-strategies/) and [hydration-strategies](../hydration-strategies/) |
| testing components by role | [quality-and-delivery lab 02](../quality-and-delivery/labs/02-testing-in-practice/) |
