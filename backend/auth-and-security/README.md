# Auth, security & compliance ⭐⭐⭐⭐⭐⭐

Five drills where **the runner plays the attacker**. It measures timing variance, guesses the id,
replays the stolen token, and points a webhook at your cloud metadata endpoint. Passing means the
attack failed — not that the happy path worked.

```sh
cd backend
npm run drills:sec
node auth-and-security/drills/run.mjs 04 --solution
```

---

## The five

| # | Drill | What the attacker tries |
|---|---|---|
| 01 | [Store a password](drills/01-password-storage/) | two users share a password — does the dump reveal it? is hashing fast enough to brute-force? |
| 02 | [The timing oracle](drills/02-timing-safe-compare/) | measures 0-char vs 31-char prefix match — **the starting code leaks 10.5×** |
| 03 | [IDOR](drills/03-broken-authorization/) | changes the id in the URL; tries it as a string; spoofs the user object |
| 04 | [SSRF](drills/04-ssrf/) | **16 attack URLs** — metadata endpoints, localhost in six spellings, `gopher://`, userinfo confusion, and a public-looking name that resolves to 127.0.0.1 |
| 05 | [Token rotation](drills/05-token-rotation/) | steals a refresh token and replays it after the user rotates |

## Why these five

**01 — three properties, three different attacks.** Per-user salt defeats rainbow tables *and* hides
"these 4,000 users share a password" in a leaked dump. Slowness defeats offline brute force —
sha256 does billions of guesses/second on a GPU, a tuned KDF does thousands, **and that ratio *is*
the security**. The stored string carries its own parameters so you can raise the cost later without
invalidating existing hashes.

**02 — the leak is real and measurable.** The naive loop returns early on the first mismatch, so it
takes longer the more of the prefix is right. The drill measures it. The fix isn't just
`timingSafeEqual` — that throws on unequal lengths, and returning early on a length mismatch leaks
the *length*. Hash both sides first so every comparison is fixed-width.

**03 — put authorization in the query, not in an `if` after it.** Both are "correct"; only one
survives someone adding a second code path. `WHERE id = $1 AND user_id = $2` means the database
*cannot* return a row you aren't entitled to, and a missing check degrades to "not found" — a safe
default. Also: a refused order and a non-existent one must look identical, or you've built an
enumeration oracle.

**04 — check the resolved address, never the hostname.** A blocklist of `localhost` and `127.0.0.1`
misses `127.1`, `0.0.0.0`, `[::1]`, `2130706433`, and any domain the attacker owns that simply has
an A record pointing home. The drill injects a fake DNS so this is testable offline — including a
name resolving to **one public and one private address**, which you must reject, because you don't
control which one the HTTP client picks.

And the honest limit: this still leaves **DNS rebinding**, which a validation function cannot close.
The real fix is pinning the resolved address, or an egress network that can't reach anything
internal.

**05 — rotation alone buys little.** What buys something is what happens on replay: *exactly one
thing is true — two parties hold this token*. You can't tell which is the user, so you revoke the
whole family. The user is inconvenienced once; the attacker loses persistent access; and you get a
**signal that a theft occurred**, which a long-lived token never gives you.

## What this course does *not* cover yet

Honest scope. From the checklist, still missing: OAuth2/OIDC and PKCE end to end, RBAC/ABAC policy
modelling, mTLS between services, upload validation, secrets management and KMS, PII handling and
GDPR delete/export, and audit logs.

The browser half of auth — XSS, CSP, CSRF, where the token lives — is a separate course:
[security-and-auth](../../security-and-auth/).

## Related

- [api-craft](../api-craft/) — idempotency keys and safe retries, as a test suite
- [caching drill 02](../caching-and-queues/drills/02-the-rate-limiter/) — rate limiting and abuse control
- [security-and-auth lab 04](../../security-and-auth/labs/04-auth-and-sessions/) — the same rotation
  argument from the browser side
