# Lab 02 — Cache first & precaching ⭐⭐⭐⭐⭐

**Goal:** make an app shell load instantly and offline, without freezing users on an old build.

**Primary metric:** shell load time (should be ~0ms), and shell load time with the network off.

> Open <http://localhost:8080/service-workers/labs/02-cache-first/>

---

## The concept

**Cache first**: look in Cache Storage; if it's there, return it and stop. No network, no
revalidation, works offline, ~0ms.

That's the fastest possible answer and it comes with an absolute condition:

> **The bytes at that URL must never change.**

There is no expiry, no `max-age`, no validator — nothing will ever check again. Cache-first on a
mutable URL is permanent staleness with no recovery path except deleting the cache. Run the
**staleness trap** demo and watch it happen.

So cache-first is for content-addressed URLs (`app.a1b2c3.js`), fonts, and anything else where a
change means a new URL. Same rule as `immutable` in the HTTP caching course — a service worker
doesn't change the rule, it just moves the enforcement into your code.

## Precaching

```js
self.addEventListener('install', (e) => e.waitUntil(
  caches.open(CACHE).then((c) => c.addAll(PRECACHE))
));
```

Three things about `addAll` that matter:

1. **It's all-or-nothing.** One failed request rejects the promise, the install fails, and the
   worker never activates — so you can never end up with half a shell. Good behaviour, but it
   means one bad URL in your manifest blocks every deploy. **Generate the manifest from the
   build; never hand-maintain it.**
2. **It ignores your HTTP cache semantics** unless you're careful: `addAll` uses the HTTP cache by
   default, so you can precache a stale copy of a file. Workbox appends a cache-busting parameter
   for exactly this reason. Consider `cache: 'reload'` on the requests.
3. **It's a fixed cost on every install** — every user pays the full download of your shell on
   every deploy. Precache the shell, not the app: 200KB is a reasonable ceiling, 5MB is a
   deploy-time tax on every user, most of whom will never see most of it.

## Versioning and cleanup

```js
const CACHE = `shell-v${VERSION}`;                    // new version = new cache

self.addEventListener('activate', (e) => e.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
})()));
```

**Delete old caches in `activate`, never in `install`.** During install, the old worker is still
serving pages from the old cache. Deleting it there breaks every open tab.

## Do this

1. Register, reload once so the page is controlled.
2. **load the shell 3×** — note the times.
3. **inspect Cache Storage** — see `shell-v1` and its entries.
4. Go **offline** (Network panel) and reload. What still renders? What's missing? Write it down —
   that gap is your real offline story.
5. **deploy v2**. Inspect again: `shell-v2` exists and `shell-v1` is gone. Check *when* it was
   deleted (the log tells you: on activate).
6. Run the **staleness trap**.

| Measurement | Value |
|---|---|
| Shell load, uncontrolled | |
| Shell load, controlled | |
| Shell load, offline | |
| Caches after v1 | |
| Caches after v2 | |
| Staleness trap: did version 2 ever appear? | |

## What belongs in a precache — and what doesn't

| Asset | Precache? |
|---|---|
| HTML shell / `index.html` | ✅ — it's the entry point for offline navigations |
| Fingerprinted CSS/JS for the shell | ✅ |
| Fonts | ✅ (small, immutable, and painful when missing) |
| The offline fallback page | ✅ |
| Logo, icons, critical SVGs | ✅ |
| Route chunks | ❌ — cache them on first use (runtime caching) |
| Product images | ❌ — runtime, with a size cap |
| API responses | ❌ — Lab 03/04 |
| Anything over ~200KB total | ❌ think hard: every user pays this on every deploy |

## Think about

- Why delete old caches in `activate` rather than `install`?
- Your precache manifest includes `/index.html`. A user opens `/products/42` offline. What
  happens, and what do you have to add?
- What's the difference between cache-first in a service worker and
  `Cache-Control: immutable`?

<details>
<summary>Answers</summary>

**Cleanup timing.** During install, the previous worker is still active and serving open tabs from
the old cache. Delete it there and those tabs start failing mid-session. `activate` runs only once
no client is using the old worker.

**Offline deep link.** The navigation request is for `/products/42`, which isn't in the cache, so
it fails. You need a **navigation fallback**: intercept `request.mode === 'navigate'` and serve
the precached shell for any navigation that isn't in the cache. That single handler is what makes
an SPA work offline at all — see Lab 03.

**vs `immutable`.** Very similar in effect, and different in three ways: the SW version works
**offline**; it's under your control per-request (you can add expiry, size caps, fallbacks); and
it lives in a different storage bucket with a different eviction story (`navigator.storage`
quota vs the HTTP cache). The HTTP cache version is free and requires no JavaScript, so prefer it
unless you need offline or the extra control.
</details>

---

## 🏗️ Build challenge: a real precache manifest pipeline

Hand-written precache lists rot. Build the pipeline:

1. **A build step** that walks your output directory, computes a content hash per file, and emits
   `precache-manifest.json` (`[{url, revision}]`). Files whose names already contain a hash get
   `revision: null` — they're immutable, so their URL *is* their version.
2. **A worker** that reads the manifest and:
   - precaches everything on install, using `cache: 'reload'` so it can't precache a stale copy;
   - on update, **only re-downloads entries whose revision changed** — copying the rest from the
     old cache. This is the difference between a 3KB update and a 2MB one, and it's the single
     biggest reason to use a real precaching library.
   - cleans up entries no longer in the manifest.
3. **A budget check** that fails the build if the precache exceeds N KB or M entries, printing the
   biggest offenders.
4. **An integrity check**: verify each precached response's hash after install, and fail the
   install (so the old worker keeps serving) if anything mismatches — this catches a CDN serving a
   truncated or wrong file, which is otherwise a permanently cached broken asset.

Then measure, at Fast 4G:

| | first install | update with 1 changed file |
|---|---|---|
| naive `addAll` every deploy | | |
| revision-aware | | |

**Done when:** changing one source file causes exactly one file to be re-downloaded on update, and
your budget check fails on a deliberately bloated manifest.

---

## Interview questions

1. When is cache-first correct, and what property must the URL have?
2. Why is `cache.addAll` all-or-nothing, and what does that imply for your manifest?
3. Where do you delete old caches, and why not earlier?
4. A user is stuck on an old version of a cached asset. Walk me through what went wrong.
5. What should and shouldn't go in a precache?
6. How would you make an update only re-download the files that actually changed?
