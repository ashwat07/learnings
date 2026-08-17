# Browser mastery — hands-on labs

You don't read your way to browser intuition. You break things on purpose, watch them bleed in
DevTools, fix them, and prove the fix with numbers.

Every lab in this repo ships **broken on purpose** or **unpredictable on purpose**. Your job is
the same four questions every time:

| Question | How you answer it |
|---|---|
| **1. How do I break it?** | Reproduce on demand. If you can't trigger it reliably you can't measure it. |
| **2. How do I measure it?** | One primary metric, from a panel — not vibes. |
| **3. Why is it slow / wrong?** | Name the mechanism. "The preflight failed" is not an answer; "the preflight response omitted `Access-Control-Allow-Headers`, so `x-token` was not allowed" is. |
| **4. How do I fix it?** | The smallest change that moves the primary metric. Re-measure. |

---

## Courses

| Course | What it makes automatic | Labs |
|---|---|---|
| [Critical rendering path](critical-rendering-path/) | Parse → DOM/CSSOM → layout → paint → composite; what triggers layout thrash | 18 + 3 capstones |
| [Event loop & scheduling](event-loop/) | Task vs microtask ordering, starvation, yielding, frame timing, INP | 7 |
| [HTTP caching](http-caching/) | `Cache-Control`, validators, `stale-while-revalidate`, a real header policy | 6 |
| [CORS](cors/) | Same-origin policy, preflight, credentials, debugging a failure end to end | 6 |
| [Resource hints](resource-hints/) | `preload` / `prefetch` / `preconnect` / `fetchpriority`, killing a waterfall | 5 |
| [Service workers](service-workers/) | Lifecycle, cache-first vs network-first vs SWR, offline, the traps | 6 |
| [Web workers](web-workers/) | Moving parse/transform off the main thread, transferables, pools, RPC | 5 |
| [Browser storage](browser-storage/) | IndexedDB, Cache API, quotas, eviction, an offline-first data layer | 6 |
| [SPA memory leaks](spa-memory-leaks/) | Detached nodes, dangling listeners, closures, the heap-snapshot workflow | 6 |
| [Rendering strategies](rendering-strategies/) | CSR / SSR / SSG / ISR / streaming / RSC, chosen per route | 6 |
| [Hydration strategies](hydration-strategies/) | The cost of hydration, islands, lazy triggers, resumability, mismatches | 5 |
| [SEO for rendered content](seo-for-rendering/) | What crawlers see, metadata, structured data, crawlability | 5 |
| [Asset optimization](asset-optimization/) | Images, fonts, compression, CDN/edge, budgets | 6 |
| [Bundle strategy](bundle-strategy/) | Splitting, tree shaking, dynamic import, size gates (esbuild) | 5 |
| [Next.js caching](nextjs-caching/) | Request memo, data cache, full route cache, router cache (real Next.js) | 5 |

Order isn't enforced, but the dependencies are real: **event loop** underpins everything about
jank and scheduling, **HTTP caching** underpins service workers, and **CORS** shows up inside
resource hints (`crossorigin`) and service workers (opaque responses).

Suggested run: `event-loop` → `http-caching` → `cors` → `resource-hints` → `service-workers` →
`web-workers` → `browser-storage` → `spa-memory-leaks` → `rendering-strategies` →
`hydration-strategies` → `seo-for-rendering` → `asset-optimization` → `bundle-strategy` →
`nextjs-caching`.

The last six form their own arc: **how a page is produced (rendering) → what the browser must do
with it (hydration) → who else reads it (SEO) → what it weighs (assets, bundles) → how a framework
caches all of it (Next.js)**.

---

## Running the labs

Everything except `critical-rendering-path` needs a real server — the whole point is HTTP
headers, origins, and caches.

```sh
./serve.sh          # then open http://localhost:8080/event-loop/labs/01-task-vs-microtask/
```

That starts one Node process (no dependencies, Node 18+) listening on **two** ports:

| Origin | Role |
|---|---|
| `http://localhost:8080` | the app origin — open labs here |
| `http://localhost:8081` | the "other" origin — cross-origin fetches, preconnect targets |
| `http://127.0.0.1:8080` | a third origin — same server, different host, so still cross-origin |

### The lab API

`server.mjs` exposes endpoints whose HTTP behaviour you set from the query string. You will use
these constantly; skim the table now and come back to it.

| Endpoint | What it's for |
|---|---|
| `/api/asset` | The caching workhorse: `cc`, `etag`, `weak`, `lm`, `vary`, `age`, `delay`, `size`, `status`, `type=js\|css\|json\|txt\|svg`. Honours `If-None-Match` / `If-Modified-Since` with a real 304. `freeze=1` pins the validators while the body changes (a server that lies); `echoHeader=x-lang` makes the body depend on a request header. |
| `/api/bump?name=x` | Change the content version of an asset, so validators have something to detect. |
| `/api/stats` | **How many times each URL actually reached the server.** The number that proves a cache worked. |
| `/api/reset` | Zero the counters (does not touch the browser cache). |
| `/api/cors` | Configurable CORS: `acao` (`*`, an origin, or `echo`), `acam`, `acah`, `acac`, `expose`, `maxage`, `preflightStatus`, `preflightDelay`, `preflightRedirect`, `noActualCors`. Omit a param and the header is simply missing — exactly how real bugs look. |
| `/api/probe` | A server-side `curl` you can call from a page: `?url=…&method=OPTIONS&origin=…&acrm=…&acrh=…` returns the raw status and headers. CORS hides failing responses from JS; this is how you see them. |
| `/api/echo` | Mirrors your request back: method, origin, all headers. |
| `/api/set-cookie`, `/api/whoami` | Cookie + credentials experiments (`samesite`, `secure`, `httponly`). |
| `/api/script.js`, `/api/style.css`, `/api/image.svg` | Resources with a `delay`, for building waterfalls on purpose. `style.css?img=…` creates a real CSS→image discovery chain. |
| `/api/rows?n=200000` | A big JSON body, gzipped. Parsing it costs real main-thread time. |
| `/api/blob?mb=8` | Bulk bytes, for storage and quota labs. |
| `/api/flaky?failEvery=2` | Fails on a schedule, for fallbacks and retries. |
| `/api/redirect?n=3&to=…` | Redirect chains. |

Example — a JS file that takes 800ms to arrive, then may be cached for a minute with an ETag:

```
/api/asset?name=analytics&type=js&delay=800&cc=max-age%3D60&etag=1
```

Add `?isolate=1` to any lab page's URL to get `Cross-Origin-Opener-Policy` +
`Cross-Origin-Embedder-Policy` on that document — required for `SharedArrayBuffer` and
`performance.measureUserAgentSpecificMemory()` (web-workers lab 02, spa-memory-leaks lab 06).

### The rendering sandbox

Three of the later courses share one small app rendered seven ways from identical templates —
read [`shared/app/render.mjs`](shared/app/render.mjs), it is the whole rendering-strategies course
in 300 lines:

```
/render/csr/product/3        a shell + JS
/render/ssr/product/3        per request, data fetched sequentially  (TTFB 1706ms)
/render/ssr-par/product/3    the same page, fetched in parallel      (TTFB 903ms)
/render/ssg/product/3        rendered once, cached forever
/render/isr/product/3?revalidate=10    cached, refreshed in the background
/render/stream/product/3     shell flushed immediately               (TTFB 1ms)
/render/rsc/product/3        a serialised tree, rendered by the client
```

Knobs: `?repeat=`, `?hydrationCost=`, `?hydrate=load|idle|visible|interaction`, `?meta=full`,
`?productDelay=`, `?reviewsDelay=`. Control and introspection at `/api/render`. Every page carries a
live TTFB/FCP/LCP/CLS/TBT scoreboard.

### Courses that need their own setup

| Course | Setup | Why |
|---|---|---|
| [asset-optimization](asset-optimization/) | `node make-images.mjs`, `node make-fonts.mjs` | real image encoding and real font files; both gitignored, both have `--clean` |
| [bundle-strategy](bundle-strategy/) | `npm install` (esbuild, ~10MB) | you cannot learn tree shaking from a description of tree shaking |
| [nextjs-caching](nextjs-caching/) | `npm install` (next + react) | the four cache layers only exist in the framework |

Everything else is zero-dependency and runs on `./serve.sh` alone.

### Shared front-end bits

- `/shared/lab.css` — the chrome. Cheap to paint on purpose.
- `/shared/lab-ui.js` — `Log`, `renderTable`, `renderBars`, `busy(ms)`, `resourceInfo(url)`, `serverStats()`.
- `/shared/perf-hud.js` — live FPS / worst-frame / long-task overlay (`PerfHUD.start()`).

---

## DevTools setup you should do once

- **Use an incognito window.** Extensions add listeners, force layouts, and inject requests.
- **Network panel:** turn on the `Priority`, `Protocol`, and `Size` columns (right-click the
  header row). Turn off *Disable cache* except when a lab tells you to turn it on.
- **Performance panel:** CPU throttling 4× for every jank measurement. Use the *same* throttle
  for before and after or the numbers are fiction.
- **Application panel:** Service Workers (check *Update on reload* while developing, uncheck it
  when you're studying the lifecycle), Storage, Cache Storage, IndexedDB.
- **Memory panel:** Heap snapshot + Allocation instrumentation on timeline.
- **Console:** enable *Preserve log* when a lab reloads the page.

## Definition of done for a lab

- [ ] You can state, in one sentence, what the mechanism was — naming the specific header,
      queue, or API that caused it.
- [ ] You have before/after numbers for the lab's primary metric.
- [ ] The fix is the *minimal* one, and you know which part of it did the work.
- [ ] You built the build challenge and it hits its budget.
- [ ] You can answer the lab's interview questions out loud, without notes.
