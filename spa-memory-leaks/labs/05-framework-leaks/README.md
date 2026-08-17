# Lab 05 — Framework leaks ⭐⭐⭐⭐⭐

**Goal:** recognise the five leaks that survive every framework's unmount, and fix all of them
with one primitive.

**Primary metric:** store subscribers, live components, and heap growth per navigation.

> Open <http://localhost:8080/spa-memory-leaks/labs/05-framework-leaks/>

---

## The premise

The framework removed your DOM correctly. What it **cannot** do is retract the references you
handed to things it doesn't own: `window`, a store, the timer queue, an in-flight request, a
module-level cache.

Run 30 navigations in each mode:

| | Leaky | Fixed |
|---|---|---|
| store subscribers | | |
| interval ticks in 1.5s | | |
| components still registered | | |
| heap growth | | |

## The five, with their React equivalents

**1. An effect with no cleanup**

```jsx
useEffect(() => { setInterval(poll, 500); }, []);          // ✗ no return
useEffect(() => { const id = setInterval(poll, 500);
                  return () => clearInterval(id); }, []);   // ✓
```

**2. A `window`/`document` listener in an effect**

```jsx
useEffect(() => { window.addEventListener('resize', onResize); }, []);            // ✗
useEffect(() => { const ac = new AbortController();
                  window.addEventListener('resize', onResize, { signal: ac.signal });
                  return () => ac.abort(); }, []);                                 // ✓
```

**3. A subscription whose unsubscribe is dropped**

```jsx
useEffect(() => { store.subscribe(setUser); }, []);               // ✗ return value ignored
useEffect(() => store.subscribe(setUser), []);                     // ✓ if it returns unsubscribe
```

Note the second form only works if `subscribe` returns the unsubscribe function *and nothing
else*. `useEffect(() => { return store.subscribe(cb); }, [])` is the explicit version.

**4. A fetch that outlives the component**

```jsx
useEffect(() => { fetch(url).then(r => r.json()).then(setData); }, []);   // ✗
useEffect(() => {
  const ac = new AbortController();
  fetch(url, { signal: ac.signal }).then(r => r.json()).then(setData)
    .catch(e => { if (e.name !== 'AbortError') report(e); });
  return () => ac.abort();
}, []);                                                                   // ✓
```

This is the one behind the old *"Can't perform a React state update on an unmounted component"*
warning. The common "fix" was an `isMounted` flag — which silences the warning and **keeps the
leak**: the request still runs, the promise still retains the closure, and the response is still
downloaded and parsed. Abort the request; don't hide the symptom.

**5. A route/component cache that never evicts**

```js
const cache = new Map();
cache.set(routeKey, mountedComponent);       // "keep mounted routes for speed"
```

Every keep-alive cache needs a bound and an eviction rule (lab 04). "For speed" is not a
retention policy.

## The fix: one lifecycle per component

```js
function lifecycle() {
  const ac = new AbortController();
  const cleanups = [];
  return {
    signal: ac.signal,
    onCleanup: (fn) => cleanups.push(fn),
    dispose() {
      ac.abort();
      for (const fn of cleanups.reverse()) { try { fn(); } catch (e) { console.error(e); } }
    },
  };
}
```

Then every hazard takes `signal` or registers `onCleanup`, and unmount calls `dispose()` once.
Five leaks become structurally impossible rather than individually remembered.

Framework-native equivalents:

| Framework | Where the cleanup goes |
|---|---|
| React | the function returned from `useEffect` |
| Vue | `onUnmounted` / the scope of `effectScope()` |
| Svelte | the function returned from `onMount`, or `onDestroy` |
| Angular | `ngOnDestroy`, or `takeUntilDestroyed()` on observables |
| Solid | `onCleanup()` |

Every one of them is the same idea. The bug is never that the hook doesn't exist; it's that
somebody didn't use it, and nothing failed when they didn't.

## Framework-specific traps worth knowing

- **React StrictMode in development double-invokes effects** (mount → unmount → mount). That's
  deliberate: it makes a missing cleanup *visible* immediately. If StrictMode breaks your effect,
  the effect was already broken.
- **Stale closures.** An effect with `[]` deps captures the first render's props forever. That's a
  correctness bug first and a retention bug second: the captured props (and everything they
  reference) can't be freed.
- **Context providers** holding large values keep them for the provider's lifetime, which is
  usually the app's.
- **Keep-alive / `<KeepAlive>` / route caching** is an explicit decision to leak. Bound it.
- **Portals and modals** attach DOM outside your component tree; cleanup must be explicit.

## Think about

- Your framework logs "state update on an unmounted component". What's the actual bug?
- StrictMode's double-invoke breaks one of your effects. What have you learned?
- What would a lint rule that catches leaks 1–4 look like?

<details>
<summary>Answers</summary>

**Unmounted-component warning.** The bug is that an async operation outlived the component and
nothing cancelled it. The `isMounted` flag hides the warning while keeping the request, the
promise, the closure and the parsed response. Abort the operation.

**StrictMode breakage.** That your effect isn't idempotent and doesn't clean up after itself.
Mount→unmount→mount is a sequence that happens in production too — a user navigating quickly,
a suspense boundary re-rendering. StrictMode just makes it happen every time.

**A lint rule.** Enforce that inside an effect, any call to `addEventListener`, `setInterval`,
`setTimeout`, `subscribe`, `observe`, or `fetch` is matched by a cleanup in the returned function
*or* passed a `signal`. `react-hooks/exhaustive-deps` covers stale closures; the cleanup rule
mostly doesn't exist off the shelf, which is exactly why these leaks are everywhere. Writing it
for your own codebase is a high-leverage afternoon.
</details>

---

## 🏗️ Build challenge: make your own app prove it

1. **Instrument.** Add a dev-only registry: every component registers on mount with its name and a
   `FinalizationRegistry` tag, and deregisters on unmount. `window.__components.report()` prints
   what's still alive. (Best-effort — lab 04.)
2. **Automate.** Write the navigation cycle test from lab 01's build challenge for the five
   heaviest routes in your app: navigate A→B→A 30 times, assert the growth slope is ~0.
3. **Fix one real leak** in your app, and write it up: the retainer chain, the line responsible,
   the fix, and the before/after numbers (nodes, listeners, heap slope).
4. **Prevent recurrence.** Add the lint rule *or* the lifecycle primitive to the codebase, and
   make new code use it by default.
5. **Field measurement.** Report `performance.memory.usedJSHeapSize` (Chrome) or
   `performance.measureUserAgentSpecificMemory()` (cross-origin isolated) against session length
   in your telemetry, bucketed by route. A rising line for long sessions is the field signature of
   a leak — and it's how you find the ones your lab tests miss.

**Done when:** you can show a graph of heap vs navigations that used to slope and now doesn't.

---

## Interview questions

1. Your framework unmounts a component. What does it *not* clean up?
2. What's wrong with an `isMounted` flag?
3. Why does React StrictMode double-invoke effects, and what does breakage tell you?
4. How does a stale closure cause a leak as well as a bug?
5. Design the primitive that makes effect cleanup hard to get wrong.
6. How would you detect this class of bug in production, not in a lab?
