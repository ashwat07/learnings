# Lab 03 — Debug a preflight failure ⭐⭐⭐⭐⭐

**Goal:** diagnose any CORS failure in under a minute, from the error message and one look at the
raw `OPTIONS`.

**Primary metric:** how many of the eight cases you diagnose correctly before revealing.

> Open <http://localhost:8080/cors/labs/03-debugging-preflight/> with the console open.

---

## The workflow

This is the whole thing, and it never changes:

```
1. Read the console error.        ← it names the missing header. Chrome's messages are excellent.
2. Does it say "preflight"?
     yes → look at the OPTIONS response
     no  → look at the ACTUAL response (including its error responses)
3. Look at the RAW exchange.      ← curl -i -X OPTIONS, with Origin and
                                     Access-Control-Request-Method/-Headers set
4. Compare what was asked with what was allowed. Fix exactly one header.
```

Step 3 is the one people skip, and it's the one that ends the argument. The browser deliberately
hides the failing response from your JavaScript, so `try/catch` tells you nothing — you get
`TypeError: Failed to fetch` for a missing header, a 500, a DNS failure, and an offline network
alike. The page's **probe** button runs this for you server-side:

```sh
curl -i -X OPTIONS 'https://api.example.com/v1/things' \
  -H 'Origin: https://app.example.com' \
  -H 'Access-Control-Request-Method: PUT' \
  -H 'Access-Control-Request-Headers: x-token, content-type'
```

Learn that command. It's the single most useful thing in this course.

## The eight cases

Work through them in order. For each: run it, read the error, probe the OPTIONS, write your
diagnosis, then reveal.

| | Symptom | Your diagnosis |
|---|---|---|
| A | PUT with `x-token` | |
| B | PATCH fails, GET works | |
| C | Worked until we added a tracing header | |
| D | Endpoint is behind auth middleware | |
| E | URL has a redirect | |
| F | OPTIONS is 204 with all headers, request still blocked | |
| G | Two origins allowed | |
| H | `credentials: 'include'` with `ACAO: *` | |

## The error → cause table

Learn this cold. It is most of the value of this lab.

| Error message | Look at | Cause |
|---|---|---|
| `No 'Access-Control-Allow-Origin' header is present` (no mention of preflight) | the **actual** response | ACAO missing on the real response — often only on the error path |
| `Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin'` | the **OPTIONS** | ACAO missing on the preflight |
| `Method X is not allowed by Access-Control-Allow-Methods` | the OPTIONS | ACAM missing or too narrow |
| `Request header field x is not allowed by Access-Control-Allow-Headers` | the OPTIONS | ACAH missing or too narrow |
| `It does not have HTTP ok status` | the OPTIONS status | Auth/rate-limit/routing rejected the OPTIONS |
| `Redirect is not allowed for a preflight request` | the OPTIONS status | A 30x — trailing slash, https upgrade, locale prefix |
| `header contains multiple values` | the ACAO value | A comma-separated list; only one value is legal |
| `must not be the wildcard '*' when the request's credentials mode is 'include'` | the ACAO value | Wildcard + credentials |
| `Credentials flag is 'true', but ... 'Access-Control-Allow-Credentials' header is ''` | the actual response | ACAC missing on the real response (it's needed on both) |

## The four structural causes behind almost all of them

1. **CORS is handled on the wrong layer.** Auth, rate limiting, or a router runs before the CORS
   middleware and answers the OPTIONS itself. The preflight arrives *without* credentials by
   design, so any middleware that requires auth will reject it.
2. **The error path has no CORS headers.** Your 200 has them; your 500, 404, and 429 don't. So the
   moment something goes wrong the client sees a CORS error rather than the real problem, and the
   team chases the wrong bug. **Attach CORS headers in the outermost middleware, after the
   response is generated, not in the happy path.**
3. **A proxy strips or duplicates them.** Two layers both add ACAO → "contains multiple values".
   A CDN strips unknown headers → ACAH disappears. Always probe against the *public* URL, not the
   origin server.
4. **The client changed, the server didn't.** Someone added `Authorization` or a trace header;
   every cross-origin call now preflights and the server's ACAH doesn't list it.

## Think about

- Why can't a preflight carry credentials or your `Authorization` header?
- Why is a redirect forbidden on a preflight but allowed on the actual request?
- Your API works from Postman and fails in the browser. What have you learned from that? (Careful
  — the answer is "almost nothing", and knowing why is the point.)

<details>
<summary>Answers</summary>

**No credentials on a preflight.** The preflight is asking whether the request is permitted at
all; sending the user's cookies to make that decision would mean the server could act on
credentials before the browser has decided the exchange is allowed. It also lets a server give a
consistent answer regardless of who's asking. Consequence: **never put a preflight behind auth.**

**Redirect on preflight.** The preflight result is cached against a specific URL and header set;
following a redirect would mean the permission you cached applies to a URL you never asked about,
and the redirect target might be a different origin. The actual request can follow redirects
because each response is re-checked for CORS at every hop.

**Postman.** Postman is not a browser: no origin, no same-origin policy, no preflight. It proves
your endpoint works, which was never in doubt. If anything it's a trap — it makes people conclude
"the API is fine, it's a frontend bug", when the fix is always a server response header.
</details>

---

## 🏗️ Build challenge: `cors-doctor`

A CLI that diagnoses a CORS setup the way you just did, but exhaustively.

```sh
npx cors-doctor https://api.example.com/v1/things \
  --origin https://app.example.com \
  --method PUT --headers x-token,content-type --credentials
```

Output:

```
preflight  OPTIONS https://api.example.com/v1/things
  ✓ status 204
  ✓ Access-Control-Allow-Origin: https://app.example.com  (echoed, exact match)
  ✗ Access-Control-Allow-Headers: content-type
      you asked for: x-token, content-type
      missing: x-token
  ⚠ Access-Control-Max-Age absent — every call pays an extra round trip
  ✗ Vary: Origin missing while ACAO is origin-specific
      a shared cache may serve this ACAO to a different origin

actual     PUT https://api.example.com/v1/things
  ✗ Access-Control-Allow-Origin absent on the 500 response
      (200 response has it; the error path does not)

verdict: the browser will fail with
  "Request header field x-token is not allowed by Access-Control-Allow-Headers in preflight response."
fix: add x-token to Access-Control-Allow-Headers on the OPTIONS response.
```

Requirements:

1. Send the preflight exactly as a browser would and validate every header against the Fetch
   spec's *CORS-preflight fetch* algorithm — including the credentials rules (no wildcards) and
   the safelist.
2. **Test the error paths too.** Request a URL that 404s and one that 500s (or let the user
   supply them) and check whether the CORS headers survive. This finding is the one that saves
   the most debugging time and no online CORS checker does it.
3. Check `Vary: Origin` whenever ACAO isn't `*`, and explain the cache-poisoning consequence.
4. Try the request from **two different origins** (one allowed, one not) and detect naive origin
   validation: send `https://app.example.com.evil.com` and `https://evil-app.example.com` and see
   whether either is reflected. That's a security finding, not a config nit.
5. Report the **preflight cost**: measured OPTIONS latency, and what `Max-Age` would save over N
   calls.
6. Exit non-zero on any error-level finding, so it can gate a deploy.

**Stretch:** a `--fix` flag that prints the exact config snippet for Express, nginx, Caddy, or
Cloudflare Workers.

**Done when:** you point it at a real API and it reproduces the browser's exact error message
before you ever open a browser — and when it finds at least one thing you didn't know was wrong.

---

## Interview questions

1. Walk me through debugging "TypeError: Failed to fetch" on a cross-origin API call.
2. The preflight returns 204 with correct headers and the request still fails. What's your next
   step?
3. Why does putting CORS handling behind auth middleware break everything?
4. Your API returns CORS headers on 200 and not on 500. What does the frontend team see and
   report?
5. What's wrong with `Access-Control-Allow-Origin: https://a.com, https://b.com`? What's the
   correct implementation, and what must accompany it?
6. Why is a redirect not allowed on a preflight?
