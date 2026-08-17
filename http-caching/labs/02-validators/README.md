# Lab 02 — Validators: ETag & Last-Modified ⭐⭐⭐⭐⭐

**Goal:** know what a revalidation costs, what makes one succeed, and the two ways validators
silently break.

**Primary metric:** bytes over the wire and wall time for the *second* request.

> Open <http://localhost:8080/http-caching/labs/02-validators/>

---

## The concept

When a cache entry is stale, the browser doesn't throw it away. It asks:

```
GET /app.js
If-None-Match: "a1b2c3"
If-Modified-Since: Tue, 12 Aug 2025 10:00:00 GMT

→ 304 Not Modified          (no body — reuse what you have)
→ 200 OK + full body        (it changed)
```

**Revalidation converts a bandwidth cost into a latency cost.** For a 200KB file on a slow
connection that's a great trade. For a 200-byte file it's a terrible one — you paid a full round
trip to avoid sending 200 bytes. That's why `max-age` matters more than validators: the fastest
revalidation is the one that doesn't happen.

| | `ETag` | `Last-Modified` |
|---|---|---|
| Request header | `If-None-Match` | `If-Modified-Since` |
| Resolution | exact | **1 second** |
| Depends on clocks | no | yes — skew between servers breaks it |
| Works for generated content | yes | awkward |
| Priority when both present | **ETag wins** | fallback |

`ETag` beats `Last-Modified` whenever both are present. Send both anyway: some intermediaries and
older clients only do dates.

### Strong vs weak

`ETag: "abc"` (strong) means byte-for-byte identical. `ETag: W/"abc"` (weak) means semantically
equivalent. For caching they behave the same. The difference:

- **Range requests** (resuming a download, video seeking) require a strong ETag — splicing two
  "semantically equivalent" but differently-encoded bodies would corrupt the file.
- **`If-Match` on writes** (optimistic concurrency: "update this row only if it's still at the
  version I read") requires a strong ETag.

If your ETag comes from a hash of the response bytes, it's strong. If it comes from a database
row version, it's weak — mark it `W/` and be honest.

## Break it / measure it

Run demos 1–4 with a 200KB payload. Fill in:

| Scenario | 2nd request wire bytes | 2nd request ms | Verdict |
|---|---|---|---|
| ETag | | | |
| Last-Modified | | | |
| no validator | | | |
| weak ETag | | | |

Expect ~200 bytes and one RTT for the first two, and a full 200KB for the third.

> **A gotcha you must know:** `fetch()` reports `res.status === 200` even when the network returned
> 304. The browser handles the 304 internally and hands your code the reconstructed response.
> The only way to see the truth from JS is `PerformanceResourceTiming.transferSize` — which is
> what this lab does. In the Network panel you *do* see the 304, in grey.

Then:

5. **content changed** — the ETag differs, you get a 200 with the new body. The system working.
6. **server lies** — the content changes but the ETag doesn't. The browser serves stale bytes
   forever and nothing looks wrong anywhere. Read the explanation on the page carefully; this bug
   costs teams days.
7. **revalidation storm** — 30 assets with `max-age=0` + ETag vs `max-age=60`. Both have a "100%
   cache hit rate" by the usual metric. One of them costs 30 round trips per page load.
8. **does a 304 refresh freshness?** — yes, if the 304 carries `Cache-Control`. If your
   hand-rolled conditional handler omits it, everything revalidates forever.

## The two ways validators break

**1. The ETag isn't derived from the bytes.**

```js
// wrong: the template didn't change, but the rendered output did
res.setHeader('ETag', hash(templateFile));

// wrong: personalised content, shared ETag
res.setHeader('ETag', hash(post.updatedAt));   // …but the response embeds the viewer's name
```

**2. The ETag is derived from something machine-specific.**

Apache's classic default ETag included the file **inode**, which differs per server. Behind a load
balancer, the same file gets a different ETag from each machine, so every request to a new server
misses revalidation and re-downloads. The fix (`FileETag MTime Size`) is a canonical example of
the failure being in *configuration*, not code.

Both bugs are invisible in a single-server dev environment. Ask "what exactly is this hash of?"
in code review.

## Think about

- When is `no-cache` + ETag *worse* than `max-age=60`? When is it better?
- Your JSON API responses are 800 bytes. Is an ETag worth it? What's the break-even payload size
  against a 60ms RTT on a 5 Mbps connection? (Do the arithmetic — it's about 37KB.)
- You add `If-Match` for optimistic concurrency on `PUT`. What must change about your ETag?
- Nginx drops the `ETag` when it gzips a response (or converts it to weak). Why would it do that,
  and what breaks if it doesn't?

---

## 🏗️ Build challenge: conditional requests, both ends

Two parts, and you need both to really own this.

**Part A — a correct conditional server.** Extend the lab server (or write your own) with an
endpoint that implements RFC 9110 conditional request precedence properly:

1. `If-Match` → 412 on mismatch (this is the write path, and getting it wrong loses data)
2. `If-Unmodified-Since` → 412
3. `If-None-Match` → 304 for GET/HEAD, 412 for others
4. `If-Modified-Since` → 304, **only** considered when `If-None-Match` is absent
5. `If-Range` → serve a partial 206 only when the validator still matches, else the whole 200

Test it with `curl` for every combination, including a request with *both* `If-None-Match` and
`If-Modified-Since` where they disagree — that precedence rule is where most hand-rolled
implementations are wrong.

**Part B — an ETag audit script.** Given a URL, determine whether the server's ETag is
trustworthy:

- Fetch twice with no changes → same ETag? (If not, the ETag is non-deterministic — the cache
  never hits. Surprisingly common with dynamically compressed responses.)
- Fetch with `Accept-Encoding: gzip` vs `identity` → does the ETag change? Should it? Does
  `Vary: Accept-Encoding` accompany it? (See Lab 05.)
- Fetch from two different IPs / with different `Host` headers if you can → same ETag?
- Send a conditional request with the returned ETag → do you actually get a 304?
- Send a conditional request with a *modified* ETag → do you correctly get a 200?

Report a verdict: `trustworthy` / `non-deterministic` / `ignores conditionals` / `weak-only`.

**Done when:** you've run Part B against three real origins and found at least one that returns
200 for a valid `If-None-Match`. (You will. It's very common.)

---

## Interview questions

1. What exactly does a 304 response contain, and what does the browser do with it?
2. Both `ETag` and `Last-Modified` are present on a stale entry. What does the browser send, and
   which does the server check first?
3. Give a concrete way an ETag can be *wrong* while the server is behaving exactly as coded.
4. Why does `fetch()` report status 200 for a revalidated response, and how do you observe the
   real 304 from JavaScript?
5. Your cache hit ratio is 98% and repeat page loads are still slow. What's your first hypothesis?
6. When would you deliberately use `Last-Modified` and not `ETag`?
