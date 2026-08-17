# Lab 01 — Cache-Control basics ⭐⭐⭐⭐⭐

**Goal:** know, from memory, what each `Cache-Control` directive does to the network — and be
able to prove it in 30 seconds.

**Primary metric:** server hits per 3 requests (from `/api/stats`).

> Open <http://localhost:8080/http-caching/labs/01-cache-control-basics/>
> **Turn off "Disable cache" in the Network panel first.**

---

## The concept

A cache entry has two states and three outcomes:

```
fresh    → served with no network at all          0ms, 0 bytes
stale    → revalidate → 304                       1 RTT, ~200 bytes
stale    → revalidate → 200                       1 RTT, full body
absent   → download                               1 RTT, full body
```

`max-age` decides the fresh/stale boundary. Validators decide whether a stale entry can be
resurrected cheaply. `no-store` opts out of the whole system.

The four that get confused constantly:

| Header | Stores? | Reuses without asking? | Result |
|---|---|---|---|
| `no-store` | no | – | full download, every time |
| `no-cache` | **yes** | no — always revalidates | 304 with an ETag; full download without one |
| `max-age=0` | yes | no (stale immediately) | practically the same as `no-cache` |
| `max-age=0, must-revalidate` | yes | no, and may not serve stale under any circumstance | the strict version |

`no-cache` is not "don't cache". If you want "don't cache", the word is `no-store`. Getting this
one wrong costs a full download per request on a resource you meant to make cheap.

## Break it / measure it

1. Click **run every preset**. Read the `server hits` column.
2. Fill this in from your own run:

| Cache-Control | server hits / 3 | 2nd request source | Why |
|---|---|---|---|
| (none) | | | |
| (none, Last-Modified present) | | | |
| `no-store` | | | |
| `no-cache` | | | |
| `max-age=60` | | | |
| `max-age=0` | | | |
| `max-age=60, must-revalidate` | | | |
| `private, max-age=60` | | | |
| `public, max-age=60` | | | |
| `max-age=60` + `Age: 55` | | | |
| `max-age=60` + `Age: 120` | | | |

3. Now open the Network panel and re-run. Cross-check the `Size` column against your table.
   `(memory cache)` / `(disk cache)` should line up exactly with your 0-hit rows.
4. Click **new generation** and run again with **Disable cache** ticked in DevTools. Every row
   becomes 3/3. That's the setting that invalidates most people's caching investigations.

### The two rows worth staring at

**No `Cache-Control` at all.** The response is still cached — heuristically. RFC 9111 lets a cache
pick its own freshness lifetime when there's no explicit one, and the usual heuristic is 10% of
the time since `Last-Modified`. So a file last modified 10 days ago gets cached for a day. That is
almost never what you wanted, and it's why "we didn't set any caching headers" is not the same as
"it isn't cached". Compare the two heuristic rows: with `Last-Modified` the browser has something
to base the guess on; without it, behaviour is far more conservative.

**`Age: 120` with `max-age=60`.** The response arrives **already stale**. `Age` is how long a
shared cache has been holding it, and freshness is `max-age - Age`. This is the mechanism behind
"my CDN keeps serving stale content to browsers": the CDN's copy is old, it tells the truth about
`Age`, and every browser immediately revalidates.

## fetch() cache modes

Click **test all RequestCache modes**. Your code can override the stored freshness rules per
request:

| `cache:` | Reads cache | Writes cache | Use it for |
|---|---|---|---|
| `default` | if fresh | yes | normal |
| `no-store` | no | no | sensitive data; a genuine one-shot |
| `reload` | no | **yes** | "give me the truth and update the cache" — e.g. pull-to-refresh |
| `no-cache` | yes, but revalidates | yes | "cheap freshness check" |
| `force-cache` | yes, even if stale | yes | offline-tolerant reads |
| `only-if-cached` | yes, or throws | – | offline-first; requires `mode: 'same-origin'` |

`reload` vs `no-store` is the pair to remember: both always hit the network, but only one leaves
you with a warm cache afterwards.

## Think about

- Why is `no-store` on an API response usually the wrong default, and what would you use instead
  for a response that must never be *shared* but can be reused by the same user?
- Your CDN sends `Cache-Control: max-age=31536000` on your HTML. Describe, precisely, what a user
  experiences after you deploy a fix.
- What is the difference between `max-age=0` and `no-cache` in practice? Between
  `max-age=0, must-revalidate` and `no-cache`? (One of these pairs is nearly identical and one
  isn't.)

<details>
<summary>Answers</summary>

**`no-store` on APIs**: it forces a full download on every request, including ones where the user
just navigated back. `private, max-age=0, must-revalidate` with an `ETag` gives you the same
correctness (never a stale answer, never stored by a CDN) at the cost of ~200 bytes instead of
your whole JSON payload.

**Year-long HTML**: users who have visited before get the old page until the cache expires or they
hard-reload. You cannot fix it by deploying — there is no way to reach into their cache. This is
the single most expensive caching mistake there is, and it's why HTML is *always*
`no-cache`/short-lived and only fingerprinted subresources get long `max-age`.

**`max-age=0` vs `no-cache`**: nearly identical in practice — both make the entry stale
immediately, so both revalidate. `no-cache` is more explicit about intent and can't be overridden
by heuristics. `must-revalidate` adds a real constraint on top: a cache may otherwise serve a
stale response in some conditions (e.g. disconnected), and `must-revalidate` forbids it, requiring
a 504 instead.
</details>

---

## 🏗️ Build challenge: `cache-probe.mjs`

A CLI that tells you, for any URL, exactly what the caching behaviour is — the tool you'd reach
for when auditing someone else's site.

```sh
node cache-probe.mjs https://example.com/app.js
```

Output:

```
https://example.com/app.js
  Cache-Control  public, max-age=31536000, immutable
  ETag           "a1b2c3"
  Age            842        (freshness remaining: 31535158s)
  Vary           Accept-Encoding
  → fresh for 364d 22h; browser will not revalidate; shared caches may store
  ⚠ immutable on a URL with no fingerprint — a deploy cannot invalidate this
```

Requirements:

1. Parse `Cache-Control` properly, including quoted forms and unknown directives, and compute
   **remaining freshness** = `max-age - Age`. Handle `s-maxage` overriding `max-age` for shared
   caches, and `Expires` as a fallback when no `max-age` is present.
2. Issue a second, conditional request using the returned validators and report whether the server
   actually honours them — a startling number don't, and returning 200 to a valid
   `If-None-Match` is a real, common bug.
3. Warn on the classic mistakes:
   - `immutable` or `max-age > 1 year` on a URL with no content hash in it
   - `public` on a response that also sets a `Set-Cookie` or requires `Authorization`
   - `Vary: *`, or `Vary: User-Agent` (which shatters the cache)
   - `no-cache` with no validator (revalidation always costs a full body)
   - `max-age` present with no `ETag`/`Last-Modified` (nothing to revalidate with)
4. Accept a list of URLs and print a summary table, sorted by "bytes you'd save per repeat view".

**Stretch:** add `--crawl <page>` that pulls every subresource out of a page's HTML and audits all
of them at once, and outputs the total transferable bytes on a repeat view.

**Done when:** you've run it against three real sites and can explain every warning it produced —
including at least one you initially thought was a false positive.

---

## Interview questions

1. What's the difference between `no-cache` and `no-store`? Which one would you put on the HTML of
   a logged-in dashboard?
2. A response has no `Cache-Control`. Is it cached?
3. What does `Age` do to freshness, and where does the number come from?
4. `private` vs `public` — name a concrete data leak that `private` prevents.
5. Your API sets `Cache-Control: max-age=300`. A user updates their profile and the old name comes
   back for five minutes. Give three different fixes and the trade-off of each.
6. What's the difference between `fetch(url, {cache: 'reload'})` and `fetch(url, {cache: 'no-store'})`?
