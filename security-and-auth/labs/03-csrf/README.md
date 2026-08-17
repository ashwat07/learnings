# Lab 03 — CSRF ⭐⭐⭐⭐

**Goal:** know exactly which defence stops which vector, and stop believing CORS is one of them.

**Primary metric:** the bank balance. If it drops, the attack worked.

> <http://localhost:8080/security-and-auth/labs/03-csrf/>
> The attacker page is served from `127.0.0.1:8081` — a different **site** from `localhost:8080`,
> so `SameSite` genuinely applies. (Ports don't make a different site; hosts do.)

---

## The one sentence

> **Cookies are attached by destination, not by who asked.**

The attacker's page cannot read one byte of the bank's response — CORS sees to that — and doesn't
need to. Causing the write *is* the attack.

## Run the matrix

Two dials: the cookie's `SameSite`, and the server-side defence. Fill this in:

| | form POST | `<img>` GET | credentialed `fetch` | top-level GET |
|---|---|---|---|---|
| SameSite=None, defence none | | | | |
| SameSite=Lax, defence none | | | | |
| SameSite=Strict, defence none | | | | |
| SameSite=None, CSRF token | | | | |
| SameSite=None, Origin check | | | | |

Two results will surprise you:

**The credentialed `fetch` fails in the attacker's console but the balance still drops.** The
browser sent the request and blocked the *response*. That's CORS working exactly as designed and
doing nothing whatsoever for CSRF.

**Top-level GET succeeds under `SameSite=Lax`.** Lax deliberately sends cookies on cross-site
top-level GET navigations — otherwise every inbound link would land users logged out. So Lax only
protects you if your mutating endpoints aren't GETs.

## Where each defence stops it

| Defence | Stops | Misses | Cost |
|---|---|---|---|
| `SameSite=Strict` | all cross-site requests | sibling subdomains are still "same site" | users arrive from links logged out |
| `SameSite=Lax` (default) | cross-site POST, `img`, `iframe`, `fetch` | **top-level GET navigation** | none |
| `SameSite=None` | nothing | everything | requires `Secure`; needed for real third-party embeds |
| CSRF token (synchroniser) | everything, *if* on every mutating route | the route you forgot; leaks via XSS | server-side session state |
| Double-submit cookie | same, statelessly | a subdomain that can set cookies on the parent can forge it | sign the token to close that |
| `Origin`/`Referer` check | everything cross-site | requests with **no** `Origin` — decide your default | proxies that strip headers |
| Custom header | forms and `<img>` can't set headers | nothing modern — it forces a preflight | useless with permissive CORS |
| **CORS** | the attacker **reading** the response | the request still arrives and still mutates | not a CSRF defence at all |

Note *where* each stops it. "No session cookie was sent" means the **browser** stopped it — your
server still received the request, just unauthenticated. "No CSRF token" means your **application**
stopped it, regardless of browser. You want both.

## Why `Origin` checking works at all

`Origin` and `Referer` are **forbidden headers**: script cannot set them, at all, ever. That's what
makes checking them a defence rather than a formality — unlike, say, a `User-Agent` check.

## What to ship, in order

1. **GET is safe.** No state change behind a GET. This single rule removes the Lax gap, the `<img>`
   vector, the prefetch vector, and the chat-link-preview vector at once.
2. **`SameSite=Lax` on the session cookie** — explicitly. Browsers default to it now, but the
   default isn't universal and being explicit survives a browser changing its mind.
3. **A token or an `Origin` check on every mutating route**, enforced by the framework in one
   place — deny by default, opt out per route. Developers remembering is not a control.
4. **For JSON APIs:** require `Content-Type: application/json` **and** a custom header. Neither can
   come from a cross-site form, and both force a preflight the attacker can't satisfy.

## Think about

- Your SPA sends `Authorization: Bearer …` instead of a cookie. Are you vulnerable to CSRF?
- You use double-submit cookies. `blog.example.com` gets popped. Are you still safe?
- Why is `SameSite=Lax` the default rather than `Strict`?

<details>
<summary>Answers</summary>

**Bearer tokens.** No — and for a precise reason: the browser never attaches an `Authorization`
header automatically. CSRF requires *ambient* credentials, which means cookies (and HTTP auth, and
client certs). This is the genuine security advantage of header-based auth, and you trade it for a
different problem: the token has to live somewhere JavaScript can reach, which makes XSS worse. Lab
04.

**Double-submit + a popped subdomain.** Not safe. A cookie set by `blog.example.com` with
`Domain=example.com` is sent to `app.example.com` too — so the attacker can *choose* the value of
the "random" cookie and submit a matching form field. The fix is a **signed** double-submit token
(HMAC over the session id), so a value the attacker plants doesn't validate. This is also why
"cookies are scoped by site, not origin" matters: your security boundary includes every subdomain
anyone in your org can publish to.

**Lax over Strict.** Strict withholds the cookie on inbound navigation, so a user clicking a link
from an email or search result arrives logged out — and then logs in again, which trains them to
type credentials after clicking links. The default has to be the one that's safe *and* deployable;
Strict is right for a second cookie gating sensitive actions, not for the session.
</details>

---

## 🏗️ Build challenge: prove your app's coverage

1. **Enumerate every mutating route** (POST/PUT/PATCH/DELETE, plus any GET that writes — find those
   and fix them first).
2. **Enforce centrally**: middleware that rejects any mutating request whose `Origin` isn't in your
   allow-list, *and* whose CSRF token doesn't validate. Explicit per-route opt-out with a comment.
3. **Write the negative test**: a test server on a different host that submits a cross-site form to
   each mutating route with valid cookies, asserting 403. Generate the route list from your router
   so a new route without protection fails the test the day it's added.
4. **Sign your double-submit token** if you use one: `HMAC(session_id, secret)`.
5. **Audit cookie scope**: does any cookie have `Domain=.example.com`? List every host that can set
   cookies there, and confirm you trust all of them.

**Done when:** adding an unprotected mutating route makes CI fail, and you can name every host that
can set a cookie on your session domain.

---

## Interview questions

1. Explain CSRF without using the word "token".
2. Why doesn't CORS prevent CSRF?
3. What does `SameSite=Lax` *not* cover?
4. Synchroniser token vs double-submit — what does each need, and how does double-submit break?
5. Are bearer-token APIs vulnerable? Why or why not, and what did you trade for it?
6. Why is checking `Origin` a real defence but checking `User-Agent` isn't?
