# Lab 05 — Updates ⭐⭐⭐⭐⭐

**Goal:** ship a new version to users who never reload, without breaking the ones mid-session.

**Primary metric:** time from deploy to a long-lived tab running the new code — and whether anything
broke on the way.

> <http://localhost:8080/offline-and-pwa/labs/05-updates/>
> See also [service-workers lab 01](../../../service-workers/labs/01-lifecycle/), which builds the
> lifecycle from first principles.

---

## The waiting worker

Register, then **simulate a deploy**. The new worker installs and **waits**. The page is still
controlled by the old one.

That's correct: swapping the worker under a running page would mean the page's next fetch is served
by a version that may disagree with the JavaScript already executing.

The waiting worker activates only when **every tab controlled by the old one is closed** — and **a
reload is not enough**, because during a reload the old page is still controlling until the new one
takes over. That's the entire explanation for "I reloaded and it's still the old version".

## The two calls that change the shape

| Call | Does | Danger |
|---|---|---|
| `self.skipWaiting()` | activate immediately instead of waiting | **does not reload the page** — it swaps the controller under running code |
| `self.clients.claim()` | control pages loaded before this worker existed | without it, the first load after registration is uncontrolled |

`skipWaiting()` without a reload causes the nastiest service-worker bugs: the page runs v1's
JavaScript, its next lazy chunk is served from v2's cache with different hashes, `import()` 404s, and
the route breaks.

**The safe pairing, always:** `skipWaiting()` only in response to a user-approved message, then
reload on `controllerchange`.

## The update policy

| Policy | UX | Risk | Use |
|---|---|---|---|
| wait (default) | eventually | a tab open for weeks never updates | low-stakes content |
| `skipWaiting()` on install | instant | **breaks running pages** | almost never |
| **prompt → `skipWaiting` + reload** | a banner they control | they may dismiss | **the default recommendation** |
| auto-reload when idle | invisible | losing unsaved work if "idle" is wrong | read-heavy apps |
| force after a deadline | interruptive | annoying | security fixes, breaking API changes |

Make the prompt good: a quiet banner not a modal; say what it is, not what to do; a "Later" that
means later (re-offer on the next navigation, don't nag); and **never reload while the user has
unsaved input**.

## Checking for updates

The browser checks on every in-scope navigation, when the script is over 24 hours old, and after
push/sync events. `reg.update()` forces it — the script is compared **byte for byte**.

**Serve `sw.js` with `Cache-Control: max-age=0`.** Browsers cap it at 24h regardless, but a worker
cached for a day is a day of users on a version you can't reach.

A good in-app policy: call `update()` on a 30–60 minute timer and on `visibilitychange`, so a
long-lived tab discovers a deploy without the user doing anything.

## Version skew is the normal state

At any moment after a deploy you have users on the old bundle, users on the new one, and someone
whose tab has been open since last week.

| Skew | Breaks | Fix |
|---|---|---|
| old page ⇄ new API | a field was removed | **additive changes only** |
| new page ⇄ old API | a field doesn't exist yet | **deploy the API first, always** |
| old page ⇄ new lazy chunk | the hash is gone → `import()` 404s | keep old assets for days; **reload once** on a chunk error |
| old SW ⇄ new assets | a stale index referencing missing hashes | version the cache; delete old ones on `activate` |
| two tabs, two versions | IndexedDB schemas disagree | forward-compatible migrations; coordinate over `BroadcastChannel` |

**Three rules that make it survivable:**

1. **Deploy the API before the client, and make API changes additive.** Removing a field is a
   two-release operation: stop using it, ship, wait for old clients to age out, then remove.
2. **Keep old assets.** Don't delete the previous build from your CDN on deploy — a user mid-session
   will request a chunk from the build they loaded.
3. **Handle the chunk-load error explicitly.** When `import()` rejects, reload once (guard with a
   `sessionStorage` flag so you can't loop). The single highest-value error handler in a deployed
   SPA.

**And measure it:** send the build version with every request and error report. "Which version was
this user on?" is the first question in half of all production investigations.

## The kill switch

For the case that overrides everything — a security fix, or a client now incompatible with the API —
you need a version endpoint the app polls that can say *"you're too old, reload now"*. **Build it
before you need it**, because the moment you need it is the moment you can't ship anything to reach
those users. [service-workers lab 05](../../../service-workers/labs/05-traps/) builds the
service-worker half.

## Think about

- You deployed 30 minutes ago. What fraction of users are on it?
- Why is `skipWaiting()` on install dangerous?
- Your users report a bug you fixed last week. First question?

<details>
<summary>Answers</summary>

**Fraction on the new version after 30 minutes.** Unknowable without instrumentation — which is the
point of the question. It depends on session length, whether they navigate, whether a service worker
is caching the shell, and whether anything prompts them. Add the build version to your telemetry and
you can answer it; most teams discover the tail is far longer than they assumed, with a small
population days behind.

**`skipWaiting()` on install.** It activates a new worker under pages that are already running older
JavaScript. The immediate symptom is chunk mismatch (v1 code requesting a hash only v1's cache
knows), and the subtler one is a page whose in-flight requests are now answered by different caching
logic than the ones before them. It's the "works on my machine, breaks in production for ten minutes
after every deploy" bug.

**Bug fixed last week, still reported.** "Which version are they on?" Almost always they're on an old
one: a service worker that never updated, a CDN caching the HTML, a tab open for days, or an app
shell cached with a long max-age. Check the client version before re-investigating the fix — and if
you can't check, that's the real finding.
</details>

---

## 🏗️ Build challenge

1. Implement the prompt → `skipWaiting` → reload-on-`controllerchange` flow. Guard against reloading
   over unsaved work.
2. Call `reg.update()` on a timer and on `visibilitychange`.
3. Confirm `sw.js` is served with `max-age=0`.
4. Add the chunk-load-error reload-once handler and test it: deploy, then navigate to a lazy route in
   an old tab.
5. Keep the last N builds on your CDN. Write down what N is and why.
6. Add build version to telemetry and chart adoption after a deploy. Look at the tail.
7. Build the kill switch.

**Done when:** you can state your p95 time-to-adoption after a deploy, and a deploy mid-session
breaks nothing.

---

## Interview questions

1. Why does a new service worker wait, and why doesn't a reload activate it?
2. What does `skipWaiting()` do, and why is it dangerous without a reload?
3. What's version skew, and name three forms of it?
4. Why deploy the API before the client?
5. What happens when a lazy chunk 404s after a deploy, and what should?
