# Lab 05 — Response headers & opaque responses ⭐⭐⭐⭐

**Goal:** know exactly which response headers your code can read cross-origin, how to expose more,
and what an opaque response is actually good for.

**Primary metric:** number of readable headers per configuration.

> Open <http://localhost:8080/cors/labs/05-response-headers/>

---

## The concept

CORS restricts reading in three places, not one:

1. the **body** (needs `Access-Control-Allow-Origin`)
2. the **status** (opaque responses hide it)
3. the **headers** — and this one has its own separate allowlist

Cross-origin, only seven response headers are readable by default — the **CORS-safelisted response
headers**:

```
Cache-Control   Content-Language   Content-Length   Content-Type
Expires         Last-Modified      Pragma
```

Everything else — your `X-Total-Count`, `X-RateLimit-Remaining`, `Link`, `X-Request-Id`,
`Content-Disposition`, even `ETag` — reads as `null` unless the server names it:

```
Access-Control-Expose-Headers: X-Total-Count, Link, X-Request-Id, ETag
```

This is the most commonly *unknown* header in the whole CORS surface. The symptom is always the
same: "the header is right there in the Network panel and `res.headers.get()` returns null." It's
there because the browser received it; it's null because the server didn't expose it.

### The wildcard, and its exception

`Access-Control-Expose-Headers: *` exposes everything except forbidden names — **unless** the
request used credentials, in which case `*` means the header literally named `*` and you get
nothing. Same rule as every other wildcard in CORS (Lab 04).

`Set-Cookie` can never be exposed. There is no combination of headers that lets JavaScript read a
`Set-Cookie` cross-origin.

## Break it / measure it

| Scenario | `response.type` | readable headers | `x-total-count` |
|---|---|---|---|
| cross-origin, no Expose | | | |
| with `Expose-Headers` | | | |
| `Expose-Headers: *` | | | |
| `*` + credentials | | | |
| same-origin | | | |
| `mode: 'no-cors'` | | | |
| `redirect: 'manual'` | | | |

## Response types

| `res.type` | When | What you get |
|---|---|---|
| `basic` | same-origin | everything |
| `cors` | cross-origin, allowed | body, status, safelisted + exposed headers |
| `opaque` | `mode: 'no-cors'` | **nothing**: status 0, `ok: false`, no headers, empty body |
| `opaqueredirect` | `redirect: 'manual'` | a redirect happened; you can't see where to |
| `error` | network failure | a rejected promise |

### Opaque responses: the two traps

1. **Quota padding.** `cache.put()` on an opaque response charges your Cache Storage quota a
   fixed padding — around 7MB per entry in Chrome — because reporting the real size would leak
   cross-origin information. Precache 30 opaque third-party assets and you've "used" 200MB and
   may be evicted.
2. **Opaque errors cache as successes.** An opaque 404 looks exactly like an opaque 200. A service
   worker that precaches opaque responses will happily store the error page and serve it forever.
   Always request cross-origin assets in CORS mode when you can (`crossorigin` attribute + a
   server that allows it), and check `res.ok` — which you *can't* do on an opaque response, which
   is the point.

## Error opacity — the thing to actually fix at work

Run demo 7. A 500 **with** CORS headers gives you the status, the body, the request id. A 500
**without** them gives you `TypeError: Failed to fetch` — identical to a DNS failure, an offline
device, an ad blocker, or a server that never existed.

The consequences are organisational, not just technical:

- Your error reporting groups every backend failure under one meaningless bucket.
- Your frontend can't distinguish "your input was invalid" from "we're down".
- Nobody can correlate a user's report with a log line.

**Fix: attach CORS headers in the outermost middleware, after the response is generated**, so
they cover 4xx, 5xx, framework errors and timeouts — not just your happy path. Then expose
`X-Request-Id`. Those two changes pay for themselves in a week.

## The headers worth exposing, by use case

| Need | Expose |
|---|---|
| Pagination | `X-Total-Count`, `Link` |
| Rate limiting | `X-RateLimit-Limit`, `-Remaining`, `-Reset`, `Retry-After` |
| Support / debugging | `X-Request-Id`, `X-Trace-Id` |
| Downloads | `Content-Disposition` (for the filename) |
| Client-side caching | `ETag` (yes — it isn't safelisted) |
| Deprecation | `Sunset`, `Deprecation`, `Warning` |
| Progress on compressed bodies | `X-Uncompressed-Length` (custom) |

## Think about

- Why is `Content-Length` safelisted but `ETag` isn't? (What could an attacker learn from each?)
- You need a download progress bar for a gzipped file. What are your options?
- Your service worker precaches 40 third-party assets with `no-cors`. What's your storage usage,
  and what happens when one of those URLs starts 404ing?

<details>
<summary>Answers</summary>

**Content-Length vs ETag.** Both leak something, but `Content-Length` is already inferable by an
attacker who can time the response or read the body length in the cases where they can read the
body — and it's needed by too much old code. `ETag` is a *server-chosen identifier* that can
encode session state, user identity, or a resource version an attacker shouldn't be able to probe.
The safelist is a compatibility-vs-leakage judgement call, not a principle.

**Progress on gzip.** `Content-Length` is the compressed size, while the stream you read is
decompressed — so a naive percentage overshoots. Options: have the server send a custom
`X-Uncompressed-Length` and expose it; show bytes-received without a percentage; or show an
indeterminate progress indicator. You cannot observe the compressed stream from `fetch`.

**40 opaque precached assets.** Chrome pads each to ~7MB, so you're charged ~280MB against a quota
you don't control, risking eviction of the whole origin's storage. And a 404 caches as an opaque
success, so a dead URL becomes a permanently broken asset with no error anywhere. Fetch them in
CORS mode and check `res.ok` before caching.
</details>

---

## 🏗️ Build challenge: a fetch client that survives CORS

Build `api-client.js` — the wrapper you'd actually put in an app, designed around what CORS lets
you see.

```js
const api = createClient({ baseUrl: 'https://api.example.com', origin: location.origin });
const { data, meta, error } = await api.get('/things?page=2');
// meta.totalCount from X-Total-Count, meta.rateLimit from X-RateLimit-*, meta.requestId
```

Requirements:

1. **Classify failures honestly.** `TypeError: Failed to fetch` is ambiguous, so *disambiguate it*:
   check `navigator.onLine`, race a same-origin health-check ping, and inspect whether a
   `PerformanceResourceTiming` entry exists for the URL (it usually does for a CORS rejection and
   doesn't for a DNS failure). Report `offline` / `cors-blocked` / `server-unreachable` /
   `http-error` rather than one useless bucket. Document the confidence of each heuristic — this
   is inference, not certainty, and pretending otherwise is worse than nothing.
2. **Surface a "the header you need isn't exposed" developer warning.** If a caller asks for
   `meta.totalCount` and `X-Total-Count` is null while the response is cross-origin, log a
   one-time console warning naming the exact server-side fix. This turns a two-hour debugging
   session into a five-second one, for every future developer on the team.
3. **Retry policy** that respects `Retry-After` when it's exposed and backs off exponentially when
   it isn't — never retry a non-idempotent request automatically.
4. **Never use `mode: 'no-cors'`** as a fallback, and explain in a comment why the "fix" that
   makes the error disappear makes the bug permanent.
5. **A dev-mode preflight report**: count preflights per session and warn when the same endpoint
   preflights repeatedly (missing `Access-Control-Max-Age`).

**Done when:** on a deliberately misconfigured API, your client's error messages tell a developer
exactly which header to add to which response — and you've verified each classification by
actually causing that failure (unplug wifi, block the domain, return a 500, remove ACAO).

---

## Interview questions

1. Which response headers can JavaScript read from a cross-origin response by default?
2. `res.headers.get('x-total-count')` is null but the header is visible in DevTools. Explain, and
   give the fix.
3. What is an opaque response? Name a legitimate use and two hazards.
4. Why does exposing headers require an opt-in at all — the body is already allowed?
5. Your API returns CORS headers on 200 but not on 500. What does the frontend team experience?
6. Can `Access-Control-Expose-Headers: *` expose `Set-Cookie`? When does `*` stop working?
