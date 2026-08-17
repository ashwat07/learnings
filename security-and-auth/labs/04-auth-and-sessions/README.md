# Lab 04 — Client auth & sessions ⭐⭐⭐⭐⭐

**Goal:** decide where the credential lives, how long it's valid, and how you revoke it — and be
able to defend all three.

**Primary metric:** what the simulated XSS captures.

> <http://localhost:8080/security-and-auth/labs/04-auth-and-sessions/>
> Real HMAC-signed tokens, a rotating refresh token in an `HttpOnly` cookie, and working reuse
> detection. Nothing is mocked.

---

## The three questions

| Question | The trade |
|---|---|
| **Where does it live?** | reachable by JS (usable, stealable) vs `HttpOnly` (not stealable, needs a server session or a BFF) |
| **How long is it valid?** | short (frequent refresh, small un-revokable window) vs long (fewer round trips, longer theft window) |
| **How do you revoke it?** | stateless (can't) vs a server-side session list (can, at the cost of a lookup) |

## Run the exfiltration

Log in with each storage option, then run the injected script:

| Storage | XSS captures it? | Survives reload? | Survives tab close? |
|---|---|---|---|
| `localStorage` | | | |
| `sessionStorage` | | | |
| memory (module variable) | | | |
| readable cookie | | | |
| `HttpOnly` cookie (the refresh token) | | | |

### The honest reading

**Memory is better, not safe.** An attacker running script in your origin doesn't *need* your
token — they can call your API from your page with your session and read the data directly.

What storage choice actually controls is what happens **after the tab closes**. An exfiltrated
`localStorage` token gives the attacker offline, long-lived, portable access from their own
machine. That's a materially worse outcome than "they abused the session while the tab was open."
The ranking is real, and modest:

```
HttpOnly cookie  →  never in the JS heap at all
memory           →  gone on reload; a later injected script finds nothing
sessionStorage   →  survives across the tab; readable by any script in the origin
localStorage     →  survives forever, across tabs; readable; the worst option
```

**Fix XSS first** (labs 01–02). Storage choice is a mitigation, not a substitute.

## JWTs: signed, not encrypted

Decode the token in the lab — no key, no server call. Two consequences:

1. **Never put anything in a JWT you wouldn't print on the page.** It's readable by the user and by
   anything that logs the token.
2. **Client-side decoding is for UI hints, never authorisation.** Show the username, pre-empt an
   expiry — fine. `role === 'admin' → show the admin page` is a *rendering* decision; the API must
   behave identically whether or not that button rendered.

Press **tamper**: the forged `role: admin` is rejected because the signature covers header + claims.
The verification failure modes, all of them real CVEs:

| Failure | Fix |
|---|---|
| `alg: "none"` accepted | pin the expected algorithm; never read it from the token |
| HS256/RS256 confusion — verify an HS256 token using your RSA *public* key as the HMAC secret | pin the algorithm |
| `exp` unchecked, or checked against a client clock | check server-side |
| `aud`/`iss` unchecked | a token minted for your *other* service is accepted here |
| string comparison of signatures | `crypto.timingSafeEqual` — a byte-by-byte compare leaks it one character at a time |

## Refresh, rotation, and reuse detection

Press **wait for expiry**, then **refresh**, then **replay the previous refresh token**.

Rotation on its own buys little. What buys something is what happens when the old token is presented
again: **exactly one thing is true — two parties hold it.** You can't tell which is the user, so you
revoke the whole family and force a real login. The user is inconvenienced once; the attacker loses
persistent access; and you get a *signal that a theft occurred*, which you'd otherwise never have.

That's also the answer to "why not long-lived tokens": a stolen long-lived token is silent and
permanent. **Rotation converts theft into a detectable event.**

### Silent refresh — the three bugs everyone ships

| Bug | Symptom | Fix |
|---|---|---|
| **Stampede** | ten requests 401 at once → ten refreshes → nine present an already-rotated token → reuse detection logs the user out | one shared in-flight refresh promise; every 401 awaits it, then retries **once** |
| **Retry loop** | refresh 401s, requests retry forever | fail closed: log out |
| **Multi-tab** | five tabs rotate each other out | elect one tab (`navigator.locks.request`) and broadcast the new token |

Better than reacting to a 401: **refresh proactively at ~75% of lifetime**, keep the 401 path as a
fallback, and measure expiry against your own monotonic timer, never the client clock.

## Revocation is why sessions still exist

Press **what the server knows**. A pure stateless JWT cannot do *any* of: "log out everywhere",
"show my active sessions", "revoke that laptop", "this user was just banned — cut them off now".

So real systems keep a list anyway, and the design question becomes: **what's the shortest access
token lifetime you can afford** (that's your un-revokable window) versus how often you're willing to
hit refresh. 5–15 minutes is the usual answer. If you're checking a revocation list on *every*
request, you've rebuilt sessions with extra steps — which is fine, but then just use sessions.

## Logout is three things

1. revoke server-side — otherwise the token still works
2. clear the client copy — storage, memory, Cache API, IndexedDB, the service worker's caches
3. **tell the other tabs** (`BroadcastChannel`, or the `storage` event)

Number 3 is the one that ships broken.

## The BFF / token-handler pattern

The design that dodges most of this: the browser holds **only a session cookie** (`HttpOnly`,
`SameSite=Lax`, `Secure`); a small backend-for-frontend holds the OAuth tokens server-side and
attaches them to upstream calls. No token in the JS heap, revocation is a session delete, and refresh
is invisible to the client.

Cost: a server you must run and scale, plus you're back to needing CSRF protection (lab 03) because
you're back on cookies. For first-party web apps this is the current recommendation — see
[architecture-and-state lab 03](../../../architecture-and-state/labs/03-data-fetching-and-bff/), which
builds the BFF itself.

## Think about

- Your SPA uses OAuth against a third-party IdP. Where does the code exchange happen?
- Why is PKCE mandatory for public clients?
- Is `sessionStorage` "safer" because it's per-tab?

<details>
<summary>Answers</summary>

**Code exchange.** On your BFF if you have one — the client secret never reaches the browser. If
you're a genuine public client with no backend, the exchange happens in the browser with **PKCE and
no client secret**, and you accept that the resulting tokens live in the JS heap. What you must not
do is ship a client secret to the browser and call it confidential; anything in the bundle is
public.

**PKCE.** The authorisation code arrives via a redirect — a URL, which lands in browser history,
server logs, and referrers, and on mobile could be intercepted by another app claiming your custom
scheme. PKCE binds the code to a secret the client generated (`code_verifier`) and only committed to
as a hash (`code_challenge`) beforehand, so an intercepted code is useless without it. It replaces
the client secret for clients that can't keep one.

**`sessionStorage` per-tab.** Marginally, and not in the way that matters. It's still readable by any
script in the origin — so an XSS on the page gets it just as easily. What it buys is a smaller
lifetime (closing the tab clears it) and no leakage to other tabs, which lowers the value of a stolen
copy without changing whether it can be stolen.
</details>

---

## 🏗️ Build challenge: an auth client that survives the edge cases

Build a token client with:

1. **In-memory access token**, refresh token in an `HttpOnly` cookie scoped to the refresh path.
2. **Proactive refresh** at 75% of lifetime, with a **single shared in-flight promise** and
   at-most-once retry on 401.
3. **Cross-tab coordination** via `navigator.locks` — exactly one tab refreshes, and it broadcasts
   the result over a `BroadcastChannel`.
4. **Logout** that revokes, clears every client store (including Cache API and IndexedDB), and
   broadcasts.
5. **Reuse detection handling**: a "your session was ended for security reasons" path, not a
   generic error toast.

Then break it deliberately: fire 20 concurrent requests as the token expires, and reload three tabs
simultaneously. If either logs the user out, your refresh isn't serialised.

**Done when:** 20 concurrent expiring requests produce exactly **one** refresh call, and three tabs
produce exactly one.

---

## Interview questions

1. Where do you store an access token, and what's the actual threat model that answer addresses?
2. Why is "memory is XSS-safe" wrong?
3. Signed vs encrypted — what can a user read from your JWT?
4. What does refresh-token rotation buy that a long-lived token doesn't?
5. How do you implement "log out everywhere" with stateless tokens?
6. Ten requests 401 simultaneously. What happens in your client?
