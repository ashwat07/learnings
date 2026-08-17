# Lab 05 — Vary & cache keys ⭐⭐⭐⭐

**Goal:** be able to answer, for any response, "who else is going to get this?" — and know the
two opposite ways `Vary` ruins your day.

**Primary metric:** correct content served, and server hits per N requests.

> Open <http://localhost:8080/http-caching/labs/05-vary-and-cache-keys/>

---

## The concept

A cache is a map. The key is:

```
method + full URL (including query string)
      + the value of every header named in Vary
      + (in modern browsers) the top-level site — cache partitioning
```

`Vary` exists because the same URL can legitimately return different bytes: gzip or brotli,
English or German, mobile or desktop. The response has to declare which request header made the
difference, because the cache has no other way to know.

Two failure modes, in opposite directions:

| | Cause | Symptom |
|---|---|---|
| **Under-varying** | The body depends on a header that isn't in `Vary` | Users get each other's content. Wrong language, wrong currency, wrong prices, wrong *person*. |
| **Over-varying** | `Vary` names a header with many distinct values | Hit rate → 0. Origin serves everything. Nobody notices until the bill. |

`Vary: User-Agent` is the canonical over-varying disaster: hundreds of thousands of distinct UA
strings means every cache entry is used approximately once.

## Break it / measure it

**Demo 1 vs 2** is the whole lab. Same endpoint, body depends on `x-lang`, and the only difference
is whether `Vary: x-lang` is sent.

| Request | With `Vary` | Without `Vary` |
|---|---|---|
| `x-lang: en` (1st) | en, network | en, network |
| `x-lang: en` (2nd) | en, cache | en, cache |
| `x-lang: de` (1st) | de, network | **en, cache ← wrong** |
| `x-lang: de` (2nd) | de, cache | **en, cache ← wrong** |
| `x-lang: en` again | en, cache | en, cache |

Fill in your own results and note the server-hit counts. Then internalise the rule:

> **If a request header changes the response body, that header must appear in `Vary`.**

The reason this bug is so nasty in production: it's invisible locally (one user, one language),
invisible in tests (each test starts cold), and reported as "some users occasionally see the wrong
X" — the hardest class of bug report there is.

**Demo 3** shows the cost of the correct fix: N distinct header values means N cache entries and N
cold fetches. **Demo 4** shows why `Vary: Cookie` isn't the solution it looks like. **Demo 5**
covers the rest of the key.

## The safe list

| Header | Vary on it? | Note |
|---|---|---|
| `Accept-Encoding` | ✅ always, if you compress | 2–4 values. Non-negotiable: without it, a gzip body reaches a client that asked for identity. |
| `Accept` | ✅ if you content-negotiate | Keep the value set small |
| `Accept-Language` | ⚠️ **normalise first** | Raw values are unbounded (`en-GB,en;q=0.9,fr;q=0.8`). Map to your supported set at the edge and vary on that. |
| Device class | ⚠️ via edge normalisation | Vary on `X-Device-Class: mobile\|desktop`, never on UA |
| `Cookie` | ⚠️ almost never | Unbounded, and doesn't make the response private |
| `Origin` | ✅ on CORS responses | If `Access-Control-Allow-Origin` echoes the Origin, you *must* `Vary: Origin` or the cache serves one site's ACAO to another. See the CORS course. |
| `User-Agent` | ❌ | Cache destruction |
| `Referer` | ❌ | Unbounded, and usually a sign of something worse |
| `*` | ❌ | Means "never reusable" — just say `no-store` |

## Authenticated responses

`Vary: Cookie` does **not** make a response safe to store in a shared cache. It only changes the
key. A CDN would still hold per-user copies keyed on a header containing session tokens — and one
misconfiguration away from serving them to the wrong person.

The correct pattern:

```
Cache-Control: private, no-cache
ETag: "<hash of the personalised body>"
```

`private` keeps shared caches out entirely; `no-cache` + `ETag` gives the user's own browser cheap
revalidation. If you want edge caching for authenticated pages, **split the response**: a public
cacheable shell plus a small private request for the personalised parts. That's what "cache the
page, not the person" means.

One thing the spec does give you: a response to a request carrying an `Authorization` header must
not be stored by a shared cache unless it explicitly says `public` (or carries `s-maxage` /
`must-revalidate`). Nothing equivalent protects Cookie-based sessions, which is why they leak
more often.

## Cache partitioning (the modern change)

Since 2020, Chrome and Safari partition the HTTP cache by **top-level site**. `example.com` and
`other.com` do not share a cached copy of the same CDN-hosted file.

Consequences worth knowing:

- The old "load jQuery from a public CDN so users already have it" argument is dead. You get an
  extra DNS+TLS handshake and zero shared-cache benefit. Self-host.
- Third-party embeds each pay their own cold cache per top-level site.
- It closed a real privacy hole (timing a resource's load told you whether a user had visited
  another site), and it's a good example of a performance technique being removed for privacy.

## Think about

- Your API echoes `Access-Control-Allow-Origin: <the request's Origin>`. What must you add, and
  what happens if you don't?
- You compress responses at the edge. Which `Vary` is mandatory, and what's the failure mode
  without it?
- A page is identical for all logged-out users and personalised for logged-in ones. Design the
  caching so logged-out users hit the CDN and logged-in ones never see another user's data.

---

## 🏗️ Build challenge: a cache-key linter

Build `vary-lint.mjs`: given a URL (or a HAR file), work out whether the response's cache key is
correct — empirically, not by reading config.

Requirements:

1. **Detect under-varying.** Fetch the URL several times, changing one request header at a time
   (`Accept-Encoding`, `Accept-Language`, `Accept`, `x-*` headers found in the site's own JS if
   you have a HAR). If the body changes but that header isn't in `Vary`, report it. Do the
   comparison on a normalised body (strip timestamps, request ids, CSRF tokens) or you'll get
   false positives on every dynamic page.
2. **Detect over-varying.** Flag `Vary: User-Agent`, `Vary: Cookie`, `Vary: *`, or any `Vary`
   header whose observed value space is large. Estimate the hit-rate cost: given a distribution of
   values (you can supply one), compute expected entries per URL.
3. **Detect the CORS variant.** If `Access-Control-Allow-Origin` is not `*` and `Vary: Origin` is
   absent, that's a finding — with an explanation of the exact cross-site leak.
4. **Detect the compression variant.** Request with `Accept-Encoding: gzip` and `identity`; if the
   bodies differ in encoding and `Vary: Accept-Encoding` is missing, that's a finding.
5. Output: severity, the evidence (the two differing responses), and the one-line fix.

**Stretch:** take a HAR file from a real site and audit every response in it, then rank findings
by `requests × bytes` to show which one to fix first.

**Done when:** you've run it against a real site and produced at least one finding you can explain
in a sentence to the team that owns it — including what a user would actually experience.

---

## Interview questions

1. What is a cache key made of?
2. Your CDN serves the German homepage to English users about 1% of the time. What's your first
   hypothesis, and what single header would you check?
3. Why is `Vary: User-Agent` considered harmful? What do you do instead when you genuinely need
   different responses per device?
4. Does `Vary: Cookie` make an authenticated response safe to cache at the edge?
5. What is cache partitioning, and how did it change the advice about public CDNs?
6. Your API echoes the request's `Origin` into `Access-Control-Allow-Origin`. What else must the
   response carry, and what's the exploit if it doesn't?
