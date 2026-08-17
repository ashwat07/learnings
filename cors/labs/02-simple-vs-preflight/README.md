# Lab 02 — Simple vs preflighted requests ⭐⭐⭐⭐⭐

**Goal:** predict, for any request, whether the browser will send an `OPTIONS` first — and know
why the rule is shaped the way it is.

**Primary metric:** your prediction vs the server's actual OPTIONS counter.

> Open <http://localhost:8080/cors/labs/02-simple-vs-preflight/>

---

## The rule

A cross-origin request is **simple** (no preflight) when **all** of these hold:

1. Method is `GET`, `HEAD`, or `POST`.
2. Every header your code set is CORS-safelisted: `Accept`, `Accept-Language`,
   `Content-Language`, `Content-Type` (with the restriction below), and `Range` (simple forms
   only).
3. If `Content-Type` is present, it is one of exactly three values:
   - `application/x-www-form-urlencoded`
   - `multipart/form-data`
   - `text/plain`
4. No `ReadableStream` body, and no listener on `XMLHttpRequest.upload`.

Otherwise: preflight.

### Why *that* list?

Because it is precisely **what an HTML form could already do before CORS existed**.

A server written in 2003 was already exposed to cross-origin `GET`s and form `POST`s — any page
could always submit a form to any URL. CORS could not retroactively restrict those without
breaking the web. But `PUT`, `DELETE`, `Content-Type: application/json`, and custom headers were
*new* powers, and no pre-CORS server had ever been exposed to them. So the browser asks first.

Once you have that sentence, you never need to memorise the list again — you derive it.

## Break it / measure it

Use the builder. Predict, then send, and check that the OPTIONS counter agrees. Fill in:

| Request | Preflight? | Why |
|---|---|---|
| `GET`, no headers | | |
| `GET` + `Authorization` | | |
| `POST` + `x-www-form-urlencoded` | | |
| `POST` + `multipart/form-data` | | |
| `POST` + `text/plain` | | |
| `POST` + `application/json` | | |
| `PUT` + `text/plain` | | |
| `DELETE`, no body | | |
| `GET` + `X-Requested-With` | | |
| `HEAD` + `Accept-Language` | | |

Two results that matter in practice:

**`POST` + `text/plain` does not preflight.** You can send a JSON *string* with
`Content-Type: text/plain` and skip the extra round trip. `navigator.sendBeacon` does exactly
this. The security corollary is important: "we only accept JSON, so we're CSRF-safe" is **false**
if your server parses the body regardless of the declared content type — an attacker can send your
JSON payload as `text/plain` from any page, with no preflight to stop them. If you rely on the
preflight as a CSRF control, you must *reject* requests whose `Content-Type` isn't
`application/json`.

**`GET` + `Authorization` does preflight.** Adding a bearer token to a read doubles your request
count. This surprises people constantly, because "it's just a GET".

## The cost of a preflight

A preflight is a full round trip before your request even starts. On a 100ms-RTT mobile
connection, every preflighted call costs 200ms minimum instead of 100ms.

Run the **Max-Age** demo. `Access-Control-Max-Age` caches the permission:

| Browser | Cap on `Access-Control-Max-Age` |
|---|---|
| Chrome | 7200s (2 hours) |
| Firefox | 86400s (24 hours) |
| Safari | 600s (10 minutes) |

Sending `86400` doesn't get you a day in Chrome — it gets you 2 hours. Send it anyway; the caps
differ and the header is free.

**The cache key is origin + URL + method + the exact set of requested headers.** So:

- Different URL path → separate preflight. A REST API with 40 endpoints preflights 40 times.
- Adding one header to one call → separate preflight for that shape.
- The cache is dropped on network change.

### How to have fewer preflights

1. **Cache them** — `Access-Control-Max-Age: 7200`. Free, and almost always left unset.
2. **Don't cross the origin.** A same-origin path (`/api/*` proxied by your own server or CDN) has
   no CORS at all. This is the real answer for most production apps and it's usually a 10-line
   reverse-proxy rule.
3. **Drop unnecessary custom headers.** `X-Requested-With` is a jQuery relic that costs a round
   trip per endpoint.
4. **Move auth into a cookie** where appropriate — cookies aren't author-set headers, so they
   don't trigger a preflight (but see Lab 04: credentials bring their own rules).
5. **Batch**: one preflighted request that carries ten operations beats ten preflighted requests.

Do **not** reach for `text/plain` to dodge preflights on an authenticated API unless you've
thought through the CSRF consequence above.

## Think about

- Your SPA makes 12 API calls on load, all `GET` with a bearer token, all cross-origin. How many
  HTTP requests actually happen? What are the three ways to reduce it, and what does each cost?
- Why does a preflight not include the request body?
- The preflight succeeds but the real request is still blocked. How is that possible?

<details>
<summary>Answers</summary>

**12 calls.** 24 requests, minimum (12 preflights + 12 real), and the preflights don't share a
cache entry because the URLs differ. Fixes: `Access-Control-Max-Age` (still 12 preflights on the
first load, 0 after); same-origin proxy (0 preflights, ever); cookie auth instead of a header
(0 preflights if nothing else is unsafelisted).

**No body in the preflight.** It's a permission check, not the request. Sending the body twice
would double upload cost, and the server hasn't agreed to receive it yet. This is also why a
preflight can't be authenticated by anything in the body.

**Preflight OK, real request blocked.** The two responses are checked independently. The `OPTIONS`
response carried `Access-Control-Allow-Origin`, and the actual `GET`/`POST` response didn't —
extremely common when CORS is implemented in a middleware that only handles `OPTIONS`, or when the
real response is generated by a different code path (an error handler, a 500, a redirect to a CDN).
**Every CORS response needs `Access-Control-Allow-Origin`, including the error ones.**
</details>

---

## 🏗️ Build challenge: a preflight budget analyser

Turn "we have too many preflights" from a hunch into a number.

Build `preflight-budget.mjs` that takes a HAR file (export one from the Network panel of a real
app) and reports:

```
cross-origin requests:      146
preflighted:                 88  (60%)
distinct preflight keys:     31   ← how many OPTIONS were actually necessary
redundant preflights:        57   ← same key, re-asked because Max-Age was missing/short
time spent in OPTIONS:    4,180ms  (p50 47ms, p95 210ms)
Access-Control-Max-Age:   absent on 29 of 31 keys

top offenders by cost:
  1. GET  api.example.com/v2/users/*  (23 preflights, 1,120ms)  ← Authorization header
  2. POST api.example.com/v2/events   (18 preflights,   890ms)  ← application/json
```

Requirements:

1. Compute the **preflight cache key** correctly (origin + URL + method + sorted header set) and
   count how many preflights were genuinely required vs re-asked.
2. Model each browser's `Max-Age` cap and report what the savings would be at 600s / 7200s.
3. Identify which safelist rule triggered each preflight, so the report suggests the specific fix
   (drop the header / change the content type / proxy same-origin).
4. Estimate the saving from a same-origin proxy: total OPTIONS time removed.
5. Handle HTTP/2 and /3 (where connection reuse hides some of the cost) and say what your numbers
   do and don't include.

**Stretch:** add a `--simulate` mode that takes a proposed CORS config and re-plays the HAR
against it, reporting the new request count.

**Done when:** you've run it against a real app's HAR and can state, in one sentence with a
number, what removing preflights would save on a cold load.

---

## Interview questions

1. What makes a cross-origin request "simple"? Derive the list rather than reciting it.
2. Why does `Content-Type: application/json` trigger a preflight when `text/plain` doesn't?
3. Does a preflight include the request body? Why not?
4. You add an `Authorization` header to a `GET`. What changes on the wire?
5. What's in the preflight cache key, and what's the cap on `Access-Control-Max-Age`?
6. A team dodges preflights by sending JSON as `text/plain`. What have they just broken?
7. The `OPTIONS` returns 200 and the `POST` is still blocked. Explain.
