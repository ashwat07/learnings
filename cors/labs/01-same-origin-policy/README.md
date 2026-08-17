# Lab 01 — Same-origin policy ⭐⭐⭐⭐⭐

**Goal:** be precise about what an origin is and what the policy blocks — because every later CORS
question reduces to those two things.

**Primary metric:** the origin quiz, cold, with reasons.

> Open <http://localhost:8080/cors/labs/01-same-origin-policy/>

---

## The concept

**Origin = scheme + host + port.** All three, exactly. Not "domain", not "site".

```
https://example.com/a/b?c=1#d
└──┬──┘ └────┬────┘
scheme     host      (port 443 implied)
```

**The policy: a document from origin A may not read a response from origin B.** Note the two words
doing the work:

- *document* — this is about what a **page** can do, not what a **client** can do. `curl` is
  unaffected. So is your mobile app. So is an attacker with a server.
- *read* — the request is still sent, the server still runs it. Only the response is withheld.

That second point is the one that changes how you build things:

> **CORS is not a security control for your API.** It stops a page on `evil.com` from reading a
> response from `bank.com` *using the user's cookies*. It does not stop anyone from calling your
> API. If your endpoint needs protection, it needs authentication and authorisation — CORS is a
> browser-side privacy boundary, not an access-control list.

And its inverse:

> **A blocked response does not mean a blocked side effect.** `DELETE /account` sent cross-origin
> and blocked by CORS has still deleted the account. This is why CSRF exists as a separate
> problem with separate defences (SameSite cookies, CSRF tokens, and requiring a preflight).

## Do the quiz first

Eleven pairs on the page. Decide each one before revealing. The ones people miss:

- `https://example.com` vs `https://example.com:443` — **same** (default port)
- `http://localhost:8080` vs `http://127.0.0.1:8080` — **different** (different host string)
- `https://a.example.com` vs `https://b.example.com` — **different** (and `document.domain`, the
  old escape hatch, is deprecated and being removed)
- `https://example.com` vs `https://example.com.evil.com` — **different**, and a server that
  validates origins with `endsWith('example.com')` has just handed the attacker everything
- `data:text/html,…` — **opaque origin**, same-origin with nothing at all

### Origin vs site

Two different boundaries, used by different mechanisms. Mixing them up causes real bugs:

| | Origin | Site (eTLD+1) |
|---|---|---|
| Definition | scheme + host + port | registrable domain + scheme-ish |
| `a.example.com` vs `b.example.com` | different | **same** |
| `https://example.com` vs `http://example.com` | different | different (schemeful same-site) |
| Used by | SOP, CORS, `postMessage`, storage | cookies (`SameSite`, `Domain=`), cache partitioning, CHIPS |

That's why a cookie can be shared across subdomains that are *not* same-origin, and why "we're on
the same site" and "we're same-origin" are different claims.

## Run the demos

1. **fetch same-origin** — no CORS at all.
2. **fetch cross-origin, no headers** — `TypeError: Failed to fetch`, and your JS learns nothing.
   Open the console to see the real message. This opacity is deliberate: distinguishing
   "403 Forbidden" from "connection refused" would itself leak information about the user's
   session elsewhere.
3. **fetch cross-origin with ACAO** — one header on the server, no client change.
4. **did the blocked request reach the server?** — read the counter. It did. Sit with that.
5. **the tags** — `<img>`, `<script>`, `<link>` all load cross-origin with no headers, because
   they always could. Notice that `<script>` *executes* third-party code with your page's full
   privileges: CORS was never the control for that (CSP and SRI are).
6. **canvas tainting** — the image renders, the pixels are unreadable. Same rule: display yes,
   read no.
7. **`crossorigin="anonymous"`** — switches a tag to a CORS load. If the server allows it, you can
   read the pixels; if it doesn't, **the load now fails**. Adding `crossorigin` "to be safe" is a
   common way to break working images.
8. **`mode: 'no-cors'`** — an opaque response: `status 0`, no headers, no body, `ok: false` even
   on success.

## Where each mechanism actually applies

| You want to… | Cross-origin allowed? | Controlled by |
|---|---|---|
| Show an image | yes | nothing (or `crossorigin` for pixel access) |
| Read its pixels | no | CORS + `crossorigin` attribute |
| Run a script | yes | CSP, SRI |
| Read a script's source / stack traces | no | CORS + `crossorigin` |
| Load a font | **CORS required, always** | CORS + `crossorigin` on preload |
| Read a fetch/XHR response | no | CORS |
| Send a form POST | yes | SameSite cookies, CSRF tokens |
| Read an iframe's DOM | no | SOP; use `postMessage` |
| Embed an iframe | yes unless refused | `X-Frame-Options` / CSP `frame-ancestors` |

## Think about

- Your API returns `Access-Control-Allow-Origin: *`. Is any data at risk? Under exactly what
  circumstances would that be a leak?
- Your login endpoint has no CORS headers. Is it safe from a malicious page?
- Someone proposes "just disable CORS in the browser with a flag" to fix a bug. What are you
  actually turning off, and for whom?

<details>
<summary>Answers</summary>

**`ACAO: *` risk.** With `*`, credentials are *not* sent, so the response contains only what an
anonymous client would get — which anyone could fetch with `curl` anyway. So `*` on genuinely
public data is fine. It becomes a leak when the endpoint is on a **private network** (an intranet
service, a router admin page, `localhost` dev servers), because there the browser is the
attacker's only route in and `*` hands it over. That's the entire motivation for the Private
Network Access spec.

**Login endpoint with no CORS headers.** The request still reaches it. A malicious page can submit
a cross-origin POST (via a form, or fetch, both fine) and cause a login attempt, a password-reset
email, or a rate-limit lockout. It just can't read the answer. Protection comes from CSRF tokens
and `SameSite` cookies.

**Disabling CORS in the browser.** You're removing the protection for *your own browsing session*
on every site — every page you visit can then read your authenticated responses from every other
site. It's a debugging trick for an isolated profile, never a fix, and the fact that someone
proposed it usually means the real problem is that nobody has looked at the OPTIONS response yet.
</details>

---

## 🏗️ Build challenge: `origin.js`, and a CSRF demo

**Part A** — implement origin comparison properly:

```js
sameOrigin('https://example.com:443/a', 'https://example.com/b')   // true
sameOrigin('http://localhost:8080', 'http://127.0.0.1:8080')       // false
isSite('https://a.example.com', 'https://b.example.com')           // true (same site)
```

Requirements: handle default ports, opaque origins (`data:`, sandboxed iframes), `blob:` and
`filesystem:` inheritance, IDN/punycode hosts, IPv6 literals, and trailing dots
(`example.com.` — yes, that's valid, and yes, it's a different host). Write a test for each. Then
implement `isSite()` using a public-suffix list and explain in the README why you cannot compute
it correctly with string operations alone (`.co.uk`, `.github.io`).

**Part B** — build a two-origin CSRF demonstration, entirely locally, and then defend against it:

1. On `localhost:8080`: a tiny "bank" with a cookie session and a `POST /transfer` endpoint.
2. On `localhost:8081`: an "attacker" page that submits a hidden form to the bank on load.
3. Show the transfer succeeding while the attacker page reads *nothing*.
4. Now defend it, one control at a time, and record which ones actually stop it:
   `SameSite=Lax` · `SameSite=Strict` · a CSRF token · requiring `Content-Type: application/json`
   (forcing a preflight) · checking the `Origin` header server-side.
5. Write down which defences the *form* submission bypasses that a `fetch` would not, and why
   `SameSite=Lax` protects `POST` but not top-level `GET` navigations.

**Done when:** you have a table of five defences × two attack shapes (form POST, fetch) with a
tick or cross in every cell, produced by running it — not by reading about it.

---

## Interview questions

1. Define "origin". Now define "site". Name one mechanism that uses each.
2. A cross-origin `fetch` is blocked by CORS. Did the server process the request?
3. Why does JavaScript get `TypeError: Failed to fetch` instead of the status code?
4. `<img>` loads cross-origin without any headers. Why does `fetch` need permission when `<img>`
   doesn't?
5. What does `crossorigin="anonymous"` change, and what can it break?
6. Is `Access-Control-Allow-Origin: *` on a public API a security problem? When is it?
7. Does CORS protect against CSRF?
