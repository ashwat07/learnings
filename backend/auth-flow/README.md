# The auth flow, end to end

**No containers.** The store counts its reads and its scans separately; the clock is yours to
advance.

```sh
npm run drills:authflow            # from backend/
npm run drills:authflow -- 02 --solution
```

[`../auth-and-security/`](../auth-and-security/) has the **primitives** — password storage,
timing-safe comparison, IDOR, SSRF, refresh rotation. Each is a correct component and each of those
drills is passable on its own.

This course is the **seams**. Every failure here comes from two correct pieces meeting.

| | | The starting code |
|---|---|---|
| **01** | The session lifecycle | scrypt + a stateless JWT + rotating refresh tokens — all recommended practice, and **logout does not log anybody out** |
| **02** | OAuth2 + PKCE | the flow works end to end, and **anyone who sees the redirect URL owns the account** |

## 01 — six seams

Read the starting code. scrypt for the password: correct. A signed, short-lived, stateless access
token: correct, and the standard advice. A rotating refresh token: correct. It fails seven checks.

| Seam | What happens |
|---|---|
| stateless token **+** logout button | logout deletes rows; the access token in the browser keeps working |
| rotation **+** two tabs refreshing at once | read-then-write gives **two valid successors** to one token |
| reuse detection **+** that race | every race now looks like theft, so teams turn the detection off |
| password change **+** other sessions | the user changes it *because* someone else has it — and that session survives |
| session list **+** `return rows` | `refreshHash` ships to the browser |
| revocation **+** the hot path | making logout work is easy; making it work **without a scan per request** is the engineering |

The drill forces a position: *an access token must stop working within one second of logout.* A
stateless JWT does not do that — that is the definition, not a bug — so you have to decide what
`verify()` checks and then make it cheap. Two cost checks stop you "fixing" it with a denylist scan:
**no scans, and at most one store read per `verify()`**.

## 02 — the runner is the attacker

The authorization server follows the spec, so the only variable is your client. The attacker's
capability is realistic and small: **they can see the redirect URL.** A malicious app registered for
your scheme, a referrer leak, a proxy, a shared machine, an open redirect anywhere on your own
domain.

That is enough to steal an authorization code — and the drill proves a stolen code must be useless.
Attacks mounted: code interception (with and without the challenge), code replay, CSRF on the
callback with a foreign `state`, `state` replay, an `id_token` minted for a different flow (four
variants — foreign nonce, no nonce, wrong `aud`, wrong `iss`), and the **mix-up attack** via `iss`.

The one worth internalising: `code_challenge_method=plain` is in the spec and is decoration — the
challenge *is* the verifier, so seeing the authorize URL gives an attacker both halves.

## What these deliberately leave out

- **Where tokens live client-side** — HttpOnly/Secure/SameSite cookies, never localStorage — and
  CSRF, which arrives the moment you use cookies: [`../../security-and-auth/`](../../security-and-auth/)
- **KDF parameters** and **constant-time comparison**: [`../auth-and-security/`](../auth-and-security/) drills 01–02
- **Rate limiting the login endpoint** — the difference between a strong hash and a strong hash
  someone gets ten thousand attempts at: [`../caching-and-queues/drills/02-the-rate-limiter/`](../caching-and-queues/drills/02-the-rate-limiter/)
- **Authorization** once you know who it is: [`../auth-and-security/drills/03-broken-authorization/`](../auth-and-security/drills/03-broken-authorization/)

## And the honest advice

Use an identity provider, or your framework's session library. Writing this once is how you
*evaluate* one — you now know that "how does logout revoke an access token, and what does it cost
per request?" is the question that separates them.
