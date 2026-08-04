# Lab 12 — Network waterfall ⭐⭐⭐

**Goal:** learn to read a waterfall, and understand what request count actually costs under HTTP/1.1
versus HTTP/2 — because the standard advice ("bundle everything") is a decade out of date and the
nuanced answer is what gets asked in interviews.

**Primary metric:** time to all-scripts-executed, and the shape of the waterfall.

> **Needs a generator and a server.**
> ```sh
> node make-modules.mjs        # writes modules/, bundle.js, chain/
> cd ../.. && ./serve.sh
> ```
> Then <http://localhost:8080/labs/12-network-waterfall/>.
> `node make-modules.mjs --clean` when you're done.

---

## The concept

A waterfall has four distinct costs, and confusing them is how people optimise the wrong thing:

1. **Per-request overhead.** DNS, TCP, TLS, and request/response headers. On HTTP/1.1 there's also a
   hard **6-connections-per-origin** limit, so request 7 waits for request 1 to finish. That's the
   queueing you can see as a staircase in the waterfall.
2. **Bandwidth.** Total bytes ÷ throughput. Bundling doesn't change this (it slightly improves it via
   better compression across files).
3. **Latency chains.** The killer. If file A must be fetched, parsed, and *then* reveals that it
   needs B, which reveals C — you pay round-trip after round-trip. A chain of 5 imports on a 200ms
   RTT connection is a second of doing nothing.
4. **Execution.** 50 files still cost 50 module evaluations, plus parse time. Bundling reduces the
   per-file overhead here too.

**HTTP/2 and HTTP/3 change #1 dramatically** — one connection, multiplexed streams, header
compression. They do *not* fix #3 at all. So the modern answer to "should I bundle?" is: bundle to
avoid **chains** and to get good compression, but don't fear a few dozen parallel requests on
HTTP/2. There's a real trade-off against caching granularity: one big bundle invalidates entirely
when one line changes.

The other thing to know: **the preload scanner** finds `<script src>` in the raw HTML early and
starts fetching. It cannot see imports inside a module, and it cannot see a `fetch()` your code
will make. That's why dynamic dependency graphs produce waterfalls that static ones don't.

## Break it

Four pages:

| Page | What it does |
|---|---|
| [01-fifty-scripts.html](01-fifty-scripts.html) | 50 separate `<script>` tags. The classic. |
| [02-bundled.html](02-bundled.html) | The same 50 modules concatenated into one file. |
| [03-import-chain.html](03-import-chain.html) | 10 modules, each importing the next. A latency chain — the genuinely bad one. |
| [04-your-fix.html](04-your-fix.html) | **Yours.** |

## Measure it

For each page, incognito, cache disabled, at **Fast 3G** and again at **no throttling**:

1. **Network panel** — sort by Waterfall. Screenshot each. Note:
   - Queueing/Stalled time per request (hover the waterfall bar for the breakdown)
   - Connection reuse: enable the **Connection ID** and **Protocol** columns
   - How many requests are genuinely in flight at once
2. **Performance panel** — total Scripting time and per-file `Evaluate Script` entries.
3. The pages print their own timing: first module executed, last module executed, and total span.
4. **Compare protocols.** `./serve.sh` uses `python3 -m http.server`, which is **HTTP/1.1** — so
   you'll see the 6-connection limit clearly. Then serve the same directory over HTTP/2 to compare:
   ```sh
   npx http-server -S -C cert.pem -K key.pem   # or caddy file-server, or `npx serve`
   # generate a local cert first:
   openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 30 \
     -subj "/CN=localhost"
   ```
   This comparison is the most valuable part of the lab. Do not skip it.

| Page | Protocol | Requests | Total transfer | Queued time (max) | First→last module | Scripting |
|---|---|---|---|---|---|---|
| 01 fifty | HTTP/1.1 | 50 | | | | |
| 01 fifty | HTTP/2 | 50 | | | | |
| 02 bundled | HTTP/1.1 | 1 | | | | |
| 02 bundled | HTTP/2 | 1 | | | | |
| 03 chain | HTTP/1.1 | 10 | | | | |
| 03 chain | HTTP/2 | 10 | | | | |

## Why is it slow?

1. In page 01 on HTTP/1.1, draw the waterfall shape from memory. Why the staircase, and why exactly
   6 wide?
2. On HTTP/2, page 01 gets much faster. How much of page 02's advantage remains, and where does it
   come from now?
3. Page 03 has only 10 requests but may be slower than page 01's 50. Explain — and calculate the
   theoretical minimum time from the RTT alone.
4. Which of the four costs does bundling *not* help with?

## Fix it yourself

Build **04-your-fix.html**, and be careful — "bundle it all" is not the answer this lab wants.

- [ ] **Flatten the chain.** Restructure page 03's dependency graph so no module discovers a
      dependency at runtime. Measure. Then achieve the same thing *without* restructuring, using
      `<link rel="modulepreload">`. Compare the two approaches and explain when you'd use each.
- [ ] **Split sensibly.** Instead of 1 bundle or 50 files, produce 3–4 chunks: a critical path
      chunk, a lazily-imported chunk (via `import()` on interaction), and a vendor chunk. Measure
      first-paint-blocking bytes rather than total bytes — that's the metric that matters.
- [ ] **Measure the caching trade-off.** Simulate a deploy where one module changed. With one
      bundle, how many bytes must a returning user re-download? With your chunks? With 50 files?
      Build the table. This is the argument that decides real bundling strategy.
- [ ] **Compression.** Serve with gzip and then brotli, and measure. Then measure 50 small files
      versus 1 large file *with* compression on, and explain why bundling improves the compression
      ratio (hint: shared dictionary across the whole input).
- [ ] **Preload vs prefetch vs modulepreload.** Use each once, correctly, and demonstrate the
      difference with a trace. Then find the case where a `preload` makes things *worse* (hint:
      bandwidth contention with something more important, or preloading something unused — check the
      console warning).
- [ ] **Priority.** Look at the Priority column in the Network panel across all four pages. Explain
      how the browser assigned them and how you'd override one (`fetchpriority`).

<details>
<summary>Hint — the chain maths</summary>

With RTT = 200ms and a 5-deep import chain, you pay at minimum 5 round trips just to *discover*
what to download: 1s of latency before any real work. Bundling collapses that to 1 RTT.
`modulepreload` also collapses it — you declare the graph in HTML so the browser can fetch it all
in parallel, without changing your module structure. That's the trick worth remembering.
</details>

<details>
<summary>Hint — why 6 connections</summary>

HTTP/1.1 has no multiplexing: one request per connection at a time (pipelining exists in the spec
but is effectively dead). Browsers cap concurrent connections per origin — 6 in Chrome — to avoid
hammering servers. So 50 requests queue in waves of 6. This is also why "domain sharding" was once a
real technique, and why it's now an anti-pattern under HTTP/2.
</details>

---

## 🏗️ Build challenge: a loading-strategy comparison harness

Build a tool that answers "how should I split my bundles?" with data rather than folklore.

**The harness:**
1. Takes a dependency graph description (or reads a real one from your project's build output).
2. Generates N loading strategies: single bundle, per-route chunks, vendor split, granular ESM,
   and a chain (as a control).
3. Serves each over HTTP/1.1, HTTP/2, and HTTP/3 if you can, with configurable RTT and bandwidth
   (Playwright's CDP `Network.emulateNetworkConditions`, or `tc`/`dummynet` if you're brave).
4. Measures for each combination: FCP, LCP, TTI-ish (first long-task-free 5s window), total bytes,
   bytes before first paint, and requests before first paint.
5. Also measures the **repeat-visit** case after a simulated one-module change, which is the axis
   everyone forgets.
6. Outputs a matrix and a recommendation with the reasoning shown.

**Then use it on something real** — your own project, or a large open-source app. Produce a
one-page recommendation for that codebase: chunk boundaries, what to preload, what to lazy-load, and
the measured justification for each.

**Done when:** the matrix contains at least one result that contradicts what you believed before you
started, and you can explain it. (If nothing contradicted your priors, you probably didn't test the
HTTP/2 + granular-modules case, or the repeat-visit case.)

---

## Interview questions

1. Why does HTTP/1.1 queue requests, and what changed in HTTP/2?
2. Given HTTP/2, should we still bundle? Argue both sides and land somewhere.
3. What's an import chain and why is it worse than the same bytes in parallel?
4. `preload` vs `prefetch` vs `modulepreload` vs `dns-prefetch` — one sentence each.
5. What can the preload scanner see, and what is invisible to it?
6. One bundle vs 50 files: which is better for a returning user after a small change, and why?
7. When does adding a `preload` make a page slower?
