# Lab 01 — Service worker lifecycle ⭐⭐⭐⭐⭐

**Goal:** be able to answer "why isn't my new service worker running?" instantly, and know exactly
what `skipWaiting()` and `clients.claim()` trade away.

**Primary metric:** you can predict the state of all four cards after any action.

> Open <http://localhost:8080/service-workers/labs/01-lifecycle/>
> **Turn OFF "Update on reload"** in Application → Service Workers first.

---

## The concept

```
register('sw.js')
      │
      ▼
  INSTALLING ──── install event; whatever you waitUntil() must succeed
      │
      ▼
   WAITING ────── stays here while ANY page controlled by the old worker is open
      │
      │ ← all old clients gone, or skipWaiting()
      ▼
  ACTIVATING ──── activate event; the only safe place to delete old caches
      │
      ▼
   ACTIVE ─────── controls pages loaded from now on (or now, if clients.claim())
```

Two facts explain nearly every question people have:

**1. The page that registers a worker is not controlled by it.** It was loaded without one.
Mixing controlled and uncontrolled resources in one document would be incoherent, so control
begins at the *next* navigation — unless the worker calls `clients.claim()`.

**2. A new worker waits.** Not out of caution — for correctness. Your page has v1's HTML and v1's
chunk URLs; activating v2 underneath it could mean requesting a chunk v2 doesn't have. The waiting
state guarantees a page sees one consistent version for its whole life.

## Do this

1. **register sw.js (v1)**. Watch: installing → waiting → active, and the fourth card saying
   *NOT controlled*.
2. Click **make a fetch**. The SW doesn't see it. Confirm in the log.
3. **Reload the page.** Now it's controlled. Fetch again — the SW logs it.
4. Click **deploy v2**. Watch v2 install, then sit in **waiting** while v1 stays active.
5. Click **registration.update()**. Nothing changes — the bytes are identical.
6. Click **skipWaiting**. v2 activates. Note that this page is still running the HTML and JS it
   loaded when v1 was in charge.
7. Click **claim**, then fetch again.
8. **Deploy v3**, then close this tab, open it again, and observe that v3 activated on its own.

Fill in what you predicted vs what happened for each step. The steps you got wrong are the lab.

## `skipWaiting()` and `clients.claim()` — the decision

```js
// The "always ship immediately" pattern. Popular, and a real risk.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));
```

What that costs you: a page loaded with build A can suddenly be served by build B's worker.
Concretely — a lazy-loaded chunk 404s because B's precache doesn't include A's hashed filenames;
an API response is rewritten in a shape A's code doesn't understand; the user's in-progress form
loses its backing state.

The three defensible positions:

| Pattern | When |
|---|---|
| Wait (the default) | Content sites, anything where the user will navigate soon anyway |
| `skipWaiting()` + force reload on `controllerchange` | Apps where a stale tab is worse than a lost scroll position — but you *must* reload, and you must guard against reload loops |
| Prompt the user ("new version — reload") | Anything where the user might be mid-task. The professional default |

The prompt version, in full:

```js
// page
reg.addEventListener('updatefound', () => {
  const nw = reg.installing;
  nw.addEventListener('statechange', () => {
    if (nw.state === 'installed' && navigator.serviceWorker.controller) {
      showToast('New version available', () => nw.postMessage('skipWaiting'));
    }
  });
});

let reloading = false;
navigator.serviceWorker.addEventListener('controllerchange', () => {
  if (reloading) return;            // guard: without this you can loop forever
  reloading = true;
  location.reload();
});
```

The `navigator.serviceWorker.controller` check matters: on a *first* install there's no controller
and no old version, so there's nothing to prompt about.

## Scope, and the two ways it bites

The scope defaults to the directory the script is served from. `/sw.js` controls everything;
`/labs/01/sw.js` controls only `/labs/01/`.

- To widen scope beyond its directory, the server must send
  `Service-Worker-Allowed: /` (the lab server does).
- A worker at `/static/sw.js` cannot control `/` — a very common deployment mistake, because
  bundlers love to put files in `/static/` or `/assets/`.

## Things that will confuse you at least once

| Symptom | Cause |
|---|---|
| Registered, but nothing is intercepted | The page isn't controlled yet. Reload. |
| Changed sw.js, nothing happened | Byte-identical, or the browser served the SW script from HTTP cache. Never cache the SW file. |
| New worker stuck in "waiting" forever | Another tab in scope is open. Count *all* tabs, including background ones. |
| Works in dev, not in prod | "Update on reload" is on in dev, hiding every lifecycle problem |
| Worker keeps restarting between events | Normal. It's terminated when idle; module-scope state is gone |
| It won't register at all | Not a secure context (`https` or `localhost`), wrong MIME type, or a syntax error in the SW — check the console |

## Think about

- Why does the browser require the *install* to succeed fully before a worker can activate?
- You call `skipWaiting()` in `install`. A user has your app open in three tabs. What can go wrong?
- Your SW script is served with `Cache-Control: max-age=31536000`. Describe the worst case.

<details>
<summary>Answers</summary>

**Install must succeed.** `install` is where you precache. A partially populated cache is worse
than no cache: your app shell would be half-there and you'd serve broken pages offline, forever,
with no error. All-or-nothing means a failed precache leaves the previous worker in charge.

**skipWaiting with three tabs.** All three are running old HTML/JS and are suddenly served by the
new worker. Any lazy chunk they request that the new precache doesn't contain will 404. Any
in-flight assumption about response shape may break. The fix is to reload them on
`controllerchange`, which loses their state — hence the prompt-first pattern.

**Long-cached SW script.** The browser may not re-fetch it for up to that lifetime (capped at 24h
by modern browsers precisely because of this). If that worker has a bug — say, it caches a broken
HTML shell — the user is stuck with a broken site and you have no way to push a fix. This is the
"bricked site" scenario, and it has happened to large companies. It's why Lab 05 makes you build a
kill switch before anything else.
</details>

---

## 🏗️ Build challenge: an update UX you'd actually ship

Build `sw-update.js`, the page-side module, plus the SW half.

```js
import { watchForUpdates } from './sw-update.js';

watchForUpdates({
  onUpdateReady: (apply) => showToast('New version available', apply),
  checkInterval: 15 * 60 * 1000,
  reloadStrategy: 'on-next-idle',       // 'immediate' | 'on-next-idle' | 'manual'
});
```

Requirements:

1. Detect an update correctly: distinguish **first install** (no controller — say nothing) from a
   genuine update (controller exists → prompt).
2. Poll with `registration.update()` on an interval **and** on `visibilitychange → visible`, so a
   long-lived tab doesn't sit on a two-week-old build.
3. `on-next-idle`: apply the update when the user is idle and no form is dirty, using
   `requestIdleCallback` plus a check for unsaved state. Getting this right is what separates a
   nice update flow from one that eats someone's half-written comment.
4. Guard against reload loops (`controllerchange` can fire more than once).
5. Handle the "old chunk 404" case: catch dynamic-import failures, and if a new worker is waiting,
   reload once instead of showing an error.
6. Expose `getVersion()` via `postMessage` so your error reports can include *which* build the
   user's worker was on — invaluable when a bug only affects people on a stale worker.

**Stretch:** add a staged rollout — the SW asks a `/sw-config` endpoint whether it is allowed to
activate, so you can halt a bad release without shipping a new worker.

**Done when:** you can deploy three versions in a row in a tab that stays open, and the user
experience is: a toast, one reload, correct version, no lost state, no loop.

---

## Interview questions

1. Why is a newly installed service worker not immediately active?
2. What's the difference between `skipWaiting()` and `clients.claim()`?
3. The page that calls `register()` — is it controlled by that worker?
4. How does the browser decide a service worker has changed?
5. What are the consequences of caching your `sw.js` for a year?
6. Where should you delete old caches, and why there specifically?
