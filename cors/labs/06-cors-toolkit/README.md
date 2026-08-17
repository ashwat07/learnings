# Lab 06 — Build a CORS diagnoser ⭐⭐⭐⭐⭐

**Goal:** turn everything from labs 01–05 into a config you can defend and a tool that explains
itself — including the security failures, which is where CORS stops being a nuisance and becomes a
vulnerability class.

**Primary metric:** a config that passes every legitimate request, blocks every illegitimate one,
and survives the audit.

> Open <http://localhost:8080/cors/labs/06-cors-toolkit/>

---

## Part 1 — use the simulator

The page implements the Fetch spec's CORS check in about 80 lines. Read `app.js` — that really is
the whole protocol. Then:

1. Start from `preset: public read-only API` and run the simulation. Which requests fail? Should
   they?
2. Switch to `preset: credentialed SPA API`. Note what had to change and why: allowlist instead of
   `*`, `Vary: Origin` appears, `ACAC` appears, methods enumerated.
3. Deliberately break each of these, one at a time, and read the error the simulator predicts:
   - remove `Vary: Origin` with an allowlist
   - switch to "reflect any origin" while credentials are on
   - tick "auth middleware also guards OPTIONS"
   - untick "CORS headers on 4xx/5xx"
   - tick "the endpoint redirects"
4. Run the **security audit** on each configuration.

## The three configurations worth memorising

**Public, read-only, no user data:**

```
Access-Control-Allow-Origin: *
Access-Control-Max-Age: 7200
Access-Control-Expose-Headers: X-Total-Count, Link, X-RateLimit-Remaining
```

No `Vary` needed (the value is constant). No credentials. Simple, cacheable, safe — *provided*
the data really is public and the service isn't on a private network.

**Credentialed API for your own SPA:**

```
Access-Control-Allow-Origin: https://app.example.com     ← exact, from an allowlist
Access-Control-Allow-Credentials: true
Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE
Access-Control-Allow-Headers: Content-Type, X-Request-Id
Access-Control-Max-Age: 7200
Access-Control-Expose-Headers: X-Request-Id, X-Total-Count
Vary: Origin
```

Plus: OPTIONS handled before auth, headers attached to error responses, and cookies as
`HttpOnly; Secure; SameSite=None; Partitioned`.

**Embeddable widget (unknown customer origins):**

```
Access-Control-Allow-Origin: <reflected>
Vary: Origin
Access-Control-Max-Age: 7200
(no Allow-Credentials — authenticate with a token in the request instead)
```

Reflecting is acceptable here **only because credentials are off**. The moment someone adds
`Access-Control-Allow-Credentials: true` to this, every site on the internet can read your
customers' data as their logged-in user.

## The vulnerability, stated plainly

```
Access-Control-Allow-Origin: <echo of the request's Origin>
Access-Control-Allow-Credentials: true
```

This is a critical vulnerability, it is a one-line change, and it is usually introduced to "fix
CORS in staging". Any page the victim visits can then read any response from your API using the
victim's session.

Its cousins, all of which are exploited in the wild:

| Mistake | Why it fails |
|---|---|
| `origin.endsWith('example.com')` | `https://example.com.evil.com` passes |
| `origin.startsWith('https://example.com')` | `https://example.com.evil.com` passes |
| `origin.includes('example.com')` | anything containing it passes |
| A regex without anchors | same |
| Allowing `null` | sandboxed iframes and some redirects send `Origin: null` — trivially forged by an attacker |
| Allowing `http://` origins | anyone on the network can spoof them |
| Trusting all subdomains | one XSS on `blog.example.com` becomes full API access |

**The only correct check is an exact string comparison against an allowlist**, and the allowlist
must not contain `null`.

## Part 2 — build it for real

### 🏗️ `cors-doctor` — the CLI

Take the Lab 03 build challenge to completion, now that you have the full picture:

```sh
npx cors-doctor https://api.example.com/v1/things \
  --origin https://app.example.com \
  --method PUT --headers x-token,content-type --credentials \
  --probe-security
```

Beyond Lab 03's requirements, add:

1. **`--probe-security`**: send requests with `Origin: https://app.example.com.evil.com`,
   `Origin: https://evil-app.example.com`, `Origin: null`, and `Origin: http://app.example.com`
   (downgraded scheme). Report anything reflected as a **critical** finding, with the exact curl
   that proves it.
2. **Preflight cost report**: measured OPTIONS latency, count of distinct preflight cache keys in
   a supplied HAR, and the saving at `Max-Age: 600 / 7200`.
3. **Error-path coverage**: request a 404 and a 500 and check whether CORS headers survive.
4. **`--fix <platform>`**: emit correct config for Express, nginx, Caddy, Cloudflare Workers, and
   Spring — including the OPTIONS-before-auth ordering, which is the part every generated snippet
   gets wrong.
5. **Exit codes**: 0 clean, 1 config errors, 2 security findings — so it can gate a deploy
   differently from a lint.

### 🏗️ A CORS middleware, from the spec

Write your own, in the server framework you use, without looking at an existing implementation.
Then diff yours against the spec's *CORS-preflight fetch* and *CORS check* algorithms, and against
a mainstream library, and write up every difference you find. Requirements:

- Exact-match allowlist, configurable per route
- Correct wildcard behaviour, including "wildcards are literals under credentials"
- Reflect `Access-Control-Request-Headers` only after validating each name
- `Vary: Origin` whenever the ACAO is dynamic — and `Vary: Origin, Access-Control-Request-Headers`
  where the preflight response depends on the requested headers
- Runs **before** auth, and attaches headers to error responses via an outer wrapper
- Never sends CORS headers on same-origin requests (they're pointless, and they hide bugs)

Test it with a table: 20 request shapes × 6 configs, asserted against the browser's real behaviour
using a headless browser. That test table is the deliverable — it's what makes the difference
between "I've configured CORS" and "I know CORS".

**Done when:** your middleware passes the table, `cors-doctor` reports your own API clean, and it
finds a real finding on someone else's.

---

## The one-page summary you should be able to write from memory

1. Origin = scheme + host + port. SOP blocks *reading* cross-origin responses, not sending
   requests.
2. Simple requests (form-shaped) go straight out; anything else preflights with `OPTIONS`.
3. Every CORS response — preflight, actual, **and errors** — needs `Access-Control-Allow-Origin`.
4. Credentials require an exact origin, `Access-Control-Allow-Credentials: true`, and kill every
   wildcard.
5. `Vary: Origin` whenever ACAO is dynamic.
6. Only 7 response headers are readable by default; name the rest in
   `Access-Control-Expose-Headers`.
7. `Access-Control-Max-Age` removes a round trip per call and is almost always unset.
8. Reflecting arbitrary origins with credentials is a critical vulnerability.
9. Handle `OPTIONS` before auth; never redirect a preflight.
10. The best CORS config is no CORS: serve the API from the same origin.

## Interview questions

1. Design the CORS configuration for a public read-only API, a credentialed SPA API, and an
   embeddable widget. What differs and why?
2. What's wrong with reflecting the `Origin` header, and when is it acceptable?
3. How would you validate an origin against an allowlist? Name three ways people get it wrong.
4. Where in your server stack do CORS headers belong, and why does the position matter?
5. How would you reduce the number of preflights in an app making 30 API calls per page?
6. Someone proposes putting `Access-Control-Allow-Origin: *` on an internal admin API that's only
   reachable on the corporate VPN. Is that fine?
