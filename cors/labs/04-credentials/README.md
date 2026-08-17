# Lab 04 — Credentials ⭐⭐⭐⭐⭐

**Goal:** send cookies on a cross-origin request correctly, and be able to tell instantly whether
a failure is a CORS problem or a cookie problem — they look identical from the outside and have
completely different fixes.

**Primary metric:** the 5 × 2 matrix (five CORS configurations × two targets), filled in and
explained.

> Open <http://localhost:8080/cors/labs/04-credentials/>

---

## Two independent systems

This is the whole lab. Internalise the diagram:

```
Your fetch says credentials: 'include'
        │
        ├── SameSite decides:  is the cookie ATTACHED to this request?
        │      Strict → only same-site requests
        │      Lax    → same-site + top-level GET navigations
        │      None   → always (requires Secure), subject to third-party cookie blocking
        │
        └── CORS decides:      may the page SEND credentials and READ the response?
               ACAO must be an exact origin (never *)
               ACAC: true must be present, on the preflight AND the actual response
```

They can fail independently:

| CORS | SameSite | What you see |
|---|---|---|
| ✅ | ✅ | works |
| ❌ | ✅ | `TypeError: Failed to fetch` + a console CORS error |
| ✅ | ❌ | **response reads fine; the API says you're logged out** |
| ❌ | ❌ | the CORS error, hiding the cookie problem behind it |

Row three is the confusing one, and the reason this lab uses two targets:

- `localhost:8080` → `localhost:8081`: different **origin** (port differs), same **site** (port
  isn't part of a site). So SameSite is satisfied and only the CORS rules bite.
- `localhost:8080` → `127.0.0.1:8080`: different origin **and** different site. Now SameSite
  applies in full — with the default `Lax`, the cookie simply isn't attached, no matter how
  perfect your CORS headers are.

## Break it / measure it

Set the cookie, then run the matrix against **both** targets:

| Config | localhost:8081 readable / cookie seen | 127.0.0.1:8080 readable / cookie seen |
|---|---|---|
| `omit` + `ACAO: *` | | |
| `same-origin` + `ACAO: *` | | |
| `include` + `ACAO: *` | | |
| `include` + exact origin, no ACAC | | |
| `include` + exact origin + ACAC | | |

Then change the cookie's `SameSite` to `None` and re-run against `127.0.0.1`. Then to `Strict`
and re-run against both.

## The rules, precisely

**1. `fetch`'s default is `same-origin`.** Not `include`. A cross-origin `fetch()` with no options
sends **no cookies**, and the server sees an anonymous request. (`XMLHttpRequest`'s default is
also no-credentials; `withCredentials = true` is the equivalent.) This is why "it works when I
paste the URL in the address bar" — that's a same-origin navigation.

**2. With credentials, every wildcard becomes a literal.**

| Header | Without credentials | With credentials |
|---|---|---|
| `Access-Control-Allow-Origin: *` | any origin | **rejected** |
| `Access-Control-Allow-Headers: *` | any header | the header literally named `*` |
| `Access-Control-Allow-Methods: *` | any method | the method literally named `*` |
| `Access-Control-Expose-Headers: *` | all headers | the header literally named `*` |

So a credentialed API must enumerate everything explicitly. There is no shortcut, deliberately:
`*` + cookies would mean "any website may read this user's private data".

**3. `Access-Control-Allow-Credentials: true` is needed on both the preflight and the actual
response.** Middleware that only adds it to one is a common half-fix.

**4. `Vary: Origin` is mandatory** once ACAO is dynamic. Without it, a cache (browser, CDN,
corporate proxy) can hand site B a response carrying site A's `Access-Control-Allow-Origin`.

**5. You can never read `Set-Cookie` from JavaScript.** It's a forbidden response header name and
`Access-Control-Expose-Headers` cannot expose it. If your design needs JS to read the session
cookie, the design is wrong.

## Third-party cookie blocking — the part that outranks all of the above

Even a perfect configuration can fail, because browsers are removing third-party cookies:

- **Safari (ITP)** blocks third-party cookies by default and has for years.
- **Firefox (Total Cookie Protection)** partitions them by top-level site.
- **Chrome** has spent years on deprecation and offers user-level controls; treat "third-party
  cookies will be there" as a bet you shouldn't take.

So if your architecture is `app.example.com` calling `api.other-company.com` with cookies, it is
on borrowed time regardless of your headers. The options, in order of preference:

1. **Be same-site.** Put the API on `api.example.com` and the app on `app.example.com` — different
   origins, same site, so the cookie is first-party. This is the fix, and it's usually a DNS and
   proxy change.
2. **Be same-origin.** Proxy `/api/*` through the app's own origin. No CORS at all, no preflights,
   no cookie questions.
3. **`Partitioned` cookies (CHIPS)** — `Set-Cookie: …; SameSite=None; Secure; Partitioned`. The
   cookie survives, but it's keyed to the top-level site, so it's a *different* cookie per
   embedding site. Right for widgets and embeds; wrong if you needed shared state.
4. **Tokens instead of cookies** — an `Authorization` header isn't a cookie, so none of this
   applies. You pay a preflight per endpoint and you own the storage/XSS problem instead.

## Think about

- Why is `ACAO: *` + credentials forbidden, given that the server explicitly opted in?
- Your API works in Chrome and fails in Safari with no CORS error. First hypothesis?
- You move your API from `api.other.com` to `api.yourapp.com`. Which of these problems disappear:
  preflights, `SameSite=None`, `Vary: Origin`, third-party cookie blocking?

<details>
<summary>Answers</summary>

**`*` + credentials.** `*` is almost always a default someone set once and forgot. Allowing it with
credentials would mean a single careless default turns every authenticated endpoint into a
readable-by-anyone endpoint. Requiring an exact origin forces an allowlist to exist — the spec is
deliberately making the insecure thing require typing.

**Safari, no CORS error.** Third-party cookie blocking. CORS passed; the cookie was never
attached; the API answered "logged out". Check whether the response is readable — if it is, it's
not a CORS problem.

**Moving to a same-site API.** Third-party cookie blocking disappears (cookie is now first-party),
and `SameSite=None` is no longer needed (`Lax` works for same-site subdomains). Preflights and
`Vary: Origin` remain, because you're still cross-*origin*. Move to same-origin (a path on the
same host) and those go too.
</details>

---

## 🏗️ Build challenge: a working two-origin auth flow

Build the thing, twice, and compare. Use the lab server or your own.

**Version A — cookie session, cross-origin.**
`http://localhost:8080` (app) → `http://localhost:8081` (api)

- `POST /login` sets `HttpOnly; Secure; SameSite=None; Partitioned` session cookie
- `GET /me` returns the session or 401
- `POST /logout` clears it
- Correct CORS throughout: exact origin from an allowlist, ACAC on both preflight and response,
  `Vary: Origin`, `Access-Control-Max-Age`
- CSRF protection, because cookies are automatic: a double-submit token or an
  `Origin`-header check on every state-changing request. **Write down which one you chose and
  what it doesn't cover.**

**Version B — bearer token.**
Same endpoints, token in memory (never `localStorage` — say why in your README), refresh via a
`HttpOnly` cookie on a single dedicated endpoint.

Then produce the comparison table, from measurements:

| | requests on cold load | preflights | works with 3rd-party cookies blocked | XSS exposure | CSRF exposure |
|---|---|---|---|---|---|
| A: cookies | | | | | |
| B: bearer token | | | | | |
| C: same-origin proxy | | | | | |

Requirements:

1. Add version C (a reverse proxy on the app origin) and measure it — it should have zero
   preflights and the simplest security story.
2. Test all three with third-party cookies blocked (Chrome setting, or Safari) and record what
   breaks.
3. Handle the 401 → refresh → retry flow **once**, with a single in-flight refresh shared by all
   concurrent 401s (the coalescing pattern from the caching course). Prove it with 10 parallel
   requests hitting an expired token — exactly one refresh must be issued.

**Done when:** you can defend a choice between the three for a specific product, naming the
constraint that decided it.

---

## Interview questions

1. What is `fetch`'s default `credentials` mode, and what surprises people about it?
2. Why can't you use `ACAO: *` with credentials? What must you send instead — all of it?
3. CORS passes, the response is readable, and the API says the user is logged out. What happened?
4. What's the difference between cross-origin and cross-site, and which one does `SameSite` care
   about?
5. Your SaaS embeds a widget on customer sites and needs a session. What's your cookie
   configuration in 2026, and what are its limits?
6. Can JavaScript read a `Set-Cookie` header if the server adds it to
   `Access-Control-Expose-Headers`?
