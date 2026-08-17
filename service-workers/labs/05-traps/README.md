# Lab 05 — The traps ⭐⭐⭐⭐⭐⭐

**Goal:** know the six ways a service worker damages production, and ship the kill switch before
you ship the worker.

**Primary metric:** you can reproduce each trap and state its user-visible symptom.

> Open <http://localhost:8080/service-workers/labs/05-traps/>

---

## Trap 0 — the one that ends careers

**A service worker can serve a broken app from cache, on a device you cannot reach, forever.**

Normal deploys don't help: the user never asks your server for anything, because the worker
answers everything locally. If the worker cached a broken shell, or has a bug in its fetch
handler, the site is broken for that user until they clear site data — which they will not do,
because they will simply stop coming back.

The defences, in order:

1. **Never long-cache `sw.js` or your HTML.** `Cache-Control: no-cache`. Browsers cap the SW
   script at 24 hours regardless, precisely because sites bricked themselves.
2. **Wrap every handler in a network fallback** so a bug degrades to "no caching":
   ```js
   event.respondWith(handle(event).catch(err => { report(err); return fetch(event.request); }));
   ```
3. **Ship a kill switch** (button 7 on the page): the worker asks a never-cached endpoint on
   activation whether it should still exist, and if not, deletes its caches and unregisters
   itself.
4. **Fail open.** If the kill-switch check fails (the user is offline), keep working. A kill switch
   that fires on every network blip is worse than the bug.
5. **Test it before you need it.** A kill switch you have never fired is a hypothesis.

Do it on the page: flip the switch, watch the worker unregister itself, reload, confirm you have a
plain working site.

## The other five

### 1. Opaque responses

`mode: 'no-cors'` gives you `status 0`, `ok: false`, no headers, no body — and it caches happily.

- **Quota padding**: the browser charges a fixed padding per opaque entry (Chrome: on the order of
  7MB), because the real size would leak cross-origin information. Precache 30 third-party assets
  opaquely and you've "used" 200MB.
- **A 404 caches as a success.** You cannot tell them apart. Your offline app ships with broken
  assets and no error anywhere.

Fix: fetch cross-origin in CORS mode (`crossorigin` + a server that allows it) and check `res.ok`
before caching. If you can't, don't precache it.

Measure it on the page: storage estimate before and after caching a ~1KB opaque response.

### 2. Range requests

`cache.match()` ignores `Range`. A cached 200 is returned for a request asking for bytes 0–99.

Symptoms: `<video>`/`<audio>` that won't seek; Safari refusing to play at all (it requires range
support); memory spikes as a whole file is handed over for a 100-byte request.

Fix: don't intercept requests with a `Range` header at all (return early), unless you're prepared
to slice the body and construct a real 206 with `Content-Range`.

### 3. Redirects

- Responding to a **navigation** with a response whose `redirected` flag is true throws
  ("Response served by service worker has redirected response") and the navigation fails.
- `redirect: 'manual'` yields an `opaqueredirect` you can't inspect and must not return.
- During precaching, a redirect stores the *final* response under the *original* URL.

Fix: let requests that may redirect pass through, or re-issue with `redirect: 'follow'` and return
the final response.

### 4. A handler that throws

Any exception inside `respondWith()` becomes a network error — for a request that worked fine
before your worker existed. Every fetch handler is a chance to break requests that used to work.
The `.catch(() => fetch(request))` wrapper is not optional.

### 5. Caching non-GET

`cache.put()` rejects for POST/PUT/DELETE by design — a cached response for a mutating request
would be a correctness disaster. If you need to cache the *result* of a POST (a GraphQL query),
key it yourself: hash the body into a synthetic `GET` Request and cache that — and be certain the
operation is a read.

### 6. Cache bloat and eviction

Cache Storage has **no** eviction policy: no LRU, no TTL, no size cap. It grows until the quota
throws `QuotaExceededError` — usually inside a background refresh where nobody is catching it.

Worse: under storage pressure the browser evicts **all** storage for an origin at once — Cache
Storage, IndexedDB, localStorage. Your offline app comes back empty and logged out.

Fill the cache on the page and watch `navigator.storage.estimate()` climb. Then read the
browser-storage course on eviction and `navigator.storage.persist()`.

## The checklist before shipping any service worker

- [ ] `sw.js` and HTML are `no-cache`
- [ ] Every handler falls back to `fetch()` on error
- [ ] A kill switch exists, and you have fired it in staging
- [ ] Cache sizes are bounded (entries, bytes, age) with lazy eviction
- [ ] Range requests pass through
- [ ] Requests that may redirect pass through
- [ ] Cross-origin assets are fetched in CORS mode and `res.ok`-checked before caching
- [ ] Non-GET requests are never intercepted for caching
- [ ] `skipWaiting` is a deliberate decision, with a reload strategy (Lab 01)
- [ ] Navigation preload is enabled and `event.preloadResponse` is used (Lab 04)
- [ ] Errors inside the worker are reported to your error tracker (they don't appear in the
      page's `window.onerror` — a whole class of bugs is invisible without this)
- [ ] You can answer: "how does a user recover if this worker is broken?"

## Think about

- A user reports the site is broken. They're on a two-week-old service worker. How do you even
  find that out?
- Your worker's error rate spikes after a deploy. Where do those errors go?
- What's the smallest change that makes a service worker "safe to ship" for a team that has never
  used one?

<details>
<summary>Answers</summary>

**Finding out.** You can't, unless you built for it: have the worker report its version via
`postMessage` on startup and include it in every error report and analytics event. Without that,
"which build is this user's worker on" is unanswerable — and it's the first question worth asking
for any weird bug report.

**Where SW errors go.** Nowhere, by default. The service worker has its own global scope; the
page's error handler never sees them, and `console.error` in a worker goes to a separate DevTools
context most people never open. Install an error reporter *inside* the worker
(`self.addEventListener('error')` and `'unhandledrejection'`), and post errors to the page or
straight to your endpoint.

**Smallest safe change.** Three things: the `.catch(() => fetch(request))` wrapper on every
handler, `no-cache` on `sw.js`, and a kill switch you've tested. With those, the worst case of any
mistake is "the site is as fast as it was before", which is a recoverable position.
</details>

---

## 🏗️ Build challenge: an incident kit

The exercise is not "write a service worker" — it's "be able to survive one".

Build three things:

**1. `sw-report.js`** — error and version reporting from inside the worker.
- Catch `error` and `unhandledrejection` in the worker scope.
- Attach: worker version, cache names and entry counts, `navigator.storage.estimate()`, whether
  the client was controlled, the request URL that failed.
- Batch and send with `fetch(..., {keepalive: true})`, with a hard cap so a broken worker can't
  DDoS your endpoint.
- Expose `getVersion()` via `postMessage` so the page can attach the worker version to *its*
  error reports.

**2. `kill-switch.js`** — the rescue path, done properly.
- A config endpoint (`no-store`) returning `{minVersion, disabled, message}`.
- Check on activate, on a timer, and on `visibilitychange`.
- Fail open on network errors; fail closed only on an explicit "disabled: true".
- Unregister, clear caches, notify clients, and reload them exactly once.
- A staged variant: disable for a percentage of users, keyed by a stable client ID.

**3. A runbook** (the actual deliverable, ~1 page):
> "Symptom: users report a blank page after the 4.2 deploy.
> Step 1: check %-of-sessions reporting worker version 4.2 …
> Step 2: flip the kill switch for the 4.2 cohort …
> Step 3: verify recovery by …
> Step 4: what we change so it can't recur."

**Done when:** you can deliberately ship a worker that caches a broken shell, observe the failure
the way a user would, and recover every client using only the kill switch — timed, with a written
runbook you followed rather than improvised.

---

## Interview questions

1. Why is a bad service worker deploy worse than a bad JS deploy?
2. What's an opaque response and what does it cost you in Cache Storage?
3. Why do Range requests break under a naive fetch handler?
4. What happens to a request when your fetch handler throws?
5. What evicts Cache Storage, and what else goes with it?
6. Design the recovery path for a service worker that's serving a broken app shell.
