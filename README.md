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
| **Languages** | | |
| [JavaScript](javascript/) | Closure retention, prototypes vs class fields, coercion algorithms, promises from scratch, generators, Proxy, engine cliffs | 8 |
| [TypeScript](typescript/) | Assignability, inference, exhaustiveness, mapped/conditional types, type-level programming, branded types | 7 |
| [React](react/) | The core model, hooks, reconciliation, patterns, concurrency — and **a working React in 260 lines** | 7 |
| **Foundations** | | |
| [Critical rendering path](critical-rendering-path/) | Parse → DOM/CSSOM → layout → paint → composite; what triggers layout thrash | 18 + 3 capstones |
| [Event loop & scheduling](event-loop/) | Task vs microtask ordering, starvation, yielding, frame timing, INP | 7 |
| **Network & caching** | | |
| [HTTP caching](http-caching/) | `Cache-Control`, validators, `stale-while-revalidate`, a real header policy | 6 |
| [CORS](cors/) | Same-origin policy, preflight, credentials, debugging a failure end to end | 6 |
| [Resource hints](resource-hints/) | `preload` / `prefetch` / `preconnect` / `fetchpriority`, killing a waterfall | 5 |
| [Service workers](service-workers/) | Lifecycle, cache-first vs network-first vs SWR, offline, the traps | 6 |
| **Compute & memory** | | |
| [Web workers](web-workers/) | Moving parse/transform off the main thread, transferables, pools, RPC | 5 |
| [Browser storage](browser-storage/) | IndexedDB, Cache API, quotas, eviction, an offline-first data layer | 6 |
| [SPA memory leaks](spa-memory-leaks/) | Detached nodes, dangling listeners, closures, the heap-snapshot workflow | 6 |
| **Rendering & delivery** | | |
| [Rendering strategies](rendering-strategies/) | CSR / SSR / SSG / ISR / streaming / RSC, chosen per route | 6 |
| [Hydration strategies](hydration-strategies/) | The cost of hydration, islands, lazy triggers, resumability, mismatches | 5 |
| [SEO for rendered content](seo-for-rendering/) | What crawlers see, metadata, structured data, crawlability | 5 |
| [Asset optimization](asset-optimization/) | Images, fonts, compression, CDN/edge, budgets | 6 |
| [Bundle strategy](bundle-strategy/) | Splitting, tree shaking, dynamic import, size gates (esbuild) | 5 |
| [Next.js caching](nextjs-caching/) | Request memo, data cache, full route cache, router cache (real Next.js) | 5 |
| **Architecture & state** | | |
| [Architecture & state](architecture-and-state/) | Component boundaries, state strategy, BFF, sync, machines, design systems, micro-frontends | 7 |
| [Real-time UI](realtime-ui/) | SSE vs WebSocket vs polling, reconnection, reconciliation, CRDTs, backpressure | 5 |
| [Resilience](resilience/) | Error boundaries, retries & idempotency, degradation, circuit breaking, chaos | 5 |
| [Offline & PWA](offline-and-pwa/) | Installability, the offline experience, a durable outbox, conflicts, updates | 5 |
| **Performance & experience** | | |
| [Core Web Vitals & React perf](web-vitals-and-react-perf/) | LCP / CLS / INP measured properly, React render cost, budgets | 6 |
| [Animation, canvas & GPU](graphics-and-animation/) | The pipeline, animation APIs, frame budget, canvas 2D, WebGL | 6 |
| [Accessibility](accessibility/) | Semantics, focus, ARIA & live regions, forms, contrast & motion, testing | 6 |
| [Multi-device](multi-device/) | Input modalities, container queries, TV & the 10-foot UI, adaptive delivery | 4 |
| [Internationalization](i18n/) | `Intl`, plurals & ICU messages, bidi & typography, delivery | 4 |
| **Backend** | | |
| [Backend engineering](backend/) | Real Postgres + Redis. Plans, indexing, locking, N+1, caching, delivery guarantees, API craft, and security drills where **the runner plays the attacker** | 5 labs, **19 drills**, 25 API tests |
| **Security & delivery** | | |
| [Security & auth](security-and-auth/) | XSS, CSP, CSRF, tokens & sessions, supply chain | 5 |
| [Quality & delivery](quality-and-delivery/) | Testing strategy, observability, build speed, release safety, the system | 6 |

## The order to do them in

**29 courses, 178 labs.** The order below is not arbitrary — each phase uses the mechanisms the
previous one established, and doing it backwards means memorising things you could have derived.

Work top to bottom. Inside a course, do the labs in number order; they build on each other.

### Phase 1 — The language (do this first)

Everything else is a consequence of these. Skipping ahead is why people plateau: you end up learning
React's rules instead of the machine underneath them.

| # | Course | Why here | Time |
|---|---|---|---|
| 1 | [javascript](javascript/) | closures, prototypes, coercion, promises, generators, Proxy, engine cliffs — the substrate for every other course | ~2 weeks |
| 2 | [typescript](typescript/) | assignability, inference, exhaustiveness, type-level programming. Needs nothing but §1 | ~1 week |

> **You can now answer:** what does a closure retain, why does `await` in a loop serialise, why is
> `[] == false`, and how do you make a missing case a compile error?

### Phase 2 — What the browser actually does

| # | Course | Why here | Time |
|---|---|---|---|
| 3 | [event-loop](event-loop/) | tasks vs microtasks, starvation, yielding. **The single highest-leverage course in the repo** — it underpins jank, INP, hydration and scheduling | ~4 days |
| 4 | [critical-rendering-path](critical-rendering-path/) | parse → layout → paint → composite, and what forces each. 18 labs; the biggest single course | ~2 weeks |

> **Do these before any performance work.** Almost every "why is this slow" answer lives in one of
> them, and every later performance course assumes you can name the stage.

### Phase 3 — The network

| # | Course | Why here | Time |
|---|---|---|---|
| 5 | [http-caching](http-caching/) | `Cache-Control`, validators, SWR. Prerequisite for service workers, Next.js caching and the CDN labs | ~4 days |
| 6 | [cors](cors/) | the same-origin policy. Shows up inside resource hints (`crossorigin`), service workers (opaque responses) and security | ~4 days |
| 7 | [resource-hints](resource-hints/) | preload scanner, `preconnect`, `fetchpriority`. Uses §5 and §6 | ~3 days |

### Phase 4 — React, properly

| # | Course | Why here | Time |
|---|---|---|---|
| 8 | [react](react/) | the core model, hooks, reconciliation, patterns, concurrency — and **[lab 07](react/labs/07-mini-react/), which implements React in 260 lines** | ~1.5 weeks |

> Needs **§1** (closures decide what a hook captures), **§2** (for typing props, events and refs)
> and **§3** (batching flushes on a microtask; interruptible rendering is a scheduling story).
>
> **Do lab 07 even if you think you know React.** Everything afterwards — memoisation, keys, the
> rules of hooks, tearing — stops being folklore once you have written the renderer.

### Phase 5 — Measure and fix

Now that you know the machine, learn to point at the number.

| # | Course | Why here | Time |
|---|---|---|---|
| 9 | [web-vitals-and-react-perf](web-vitals-and-react-perf/) | LCP / CLS / INP measured properly, then React render cost. Needs §3, §4 and §8 | ~1 week |
| 10 | [spa-memory-leaks](spa-memory-leaks/) | detached nodes, retainer chains, the heap-snapshot workflow. Direct sequel to [javascript 01](javascript/labs/01-scope-and-closures/) | ~4 days |
| 11 | [web-workers](web-workers/) | the other answer to "the main thread is busy". Needs §3 | ~4 days |
| 12 | [graphics-and-animation](graphics-and-animation/) | the pipeline, frame budget, canvas, WebGL. Needs §4 and §3 | ~1 week |

### Phase 6 — How a page is produced and delivered

| # | Course | Why here | Time |
|---|---|---|---|
| 13 | [rendering-strategies](rendering-strategies/) | CSR / SSR / SSG / ISR / streaming / RSC from identical templates | ~5 days |
| 14 | [hydration-strategies](hydration-strategies/) | what the browser must then do with it. Follows §13 directly | ~4 days |
| 15 | [seo-for-rendering](seo-for-rendering/) | who else reads it. Follows §13 | ~3 days |
| 16 | [bundle-strategy](bundle-strategy/) | what it weighs (real esbuild) | ~4 days |
| 17 | [asset-optimization](asset-optimization/) | images, fonts, compression, CDN. Pairs with §9 | ~5 days |
| 18 | [nextjs-caching](nextjs-caching/) | four cache layers in a real framework. Needs §5 and §13 | ~4 days |

> These six are one arc: **produced → hydrated → indexed → weighed → delivered → cached by a
> framework.** Do them together.

### Phase 7 — Data, state and failure

| # | Course | Why here | Time |
|---|---|---|---|
| 19 | [architecture-and-state](architecture-and-state/) | component boundaries, state strategy, BFF, sync, machines, design systems. Needs §8 | ~1.5 weeks |
| 20 | [browser-storage](browser-storage/) | IndexedDB, Cache API, quotas | ~5 days |
| 21 | [service-workers](service-workers/) | lifecycle and cache strategies. Needs §5 and §20 | ~5 days |
| 22 | [offline-and-pwa](offline-and-pwa/) | the durable outbox, conflicts, updates. Needs §20 and §21 | ~4 days |
| 23 | [realtime-ui](realtime-ui/) | SSE/WS, reconnection, reconciliation, CRDTs, backpressure. Needs §3 and §19 | ~1 week |
| 24 | [resilience](resilience/) | error boundaries, retries, degradation, circuit breaking, chaos | ~5 days |

> §22, §23 and §24 share one idea — **prefer facts over deltas, and make every operation
> idempotent** — approached from three directions. Do them close together.

### Phase 7.5 — The other side of the API

Optional, and parallel to everything above — start it whenever you like. It needs Docker rather than
a browser, and it is the only part of this repo with **drills**: problems with machine-checked
answers, not demonstrations.

| # | Course | Why here | Time |
|---|---|---|---|
| — | [backend](backend/) | plans, indexing, locking, N+1, caching & delivery guarantees, API craft — against a real Postgres and Redis | ~2 weeks for what exists |

> **Do the drills rather than reading the labs**, if you only do one — they fail until you solve
> them, and the thresholds are set so a plausible-but-wrong answer still fails.
> `npm run drills:pg` · `npm run drills:cache` · `npm run drills:sec` · `npm run test:api`

### Phase 8 — The user, and the team

Independent of each other. Do them in whatever order matches your work.

| # | Course | Why here | Time |
|---|---|---|---|
| 25 | [accessibility](accessibility/) | semantics, focus, ARIA, forms, contrast. **The one most likely to change how you write everyday code** | ~1 week |
| 26 | [security-and-auth](security-and-auth/) | XSS, CSP, CSRF, tokens, supply chain. Needs §6 | ~5 days |
| 27 | [i18n](i18n/) | `Intl`, plurals, bidi, delivery | ~4 days |
| 28 | [multi-device](multi-device/) | input modalities, container queries, TV, adaptive delivery. Needs §25 | ~4 days |
| 29 | [quality-and-delivery](quality-and-delivery/) | testing strategy, observability, build speed, release safety. **Last on purpose** — it is about keeping everything above true while a team changes it | ~5 days |

**Total, at a steady pace: about five months.** At one lab a day, about six.

### If you don't have five months

Three shorter routes, each internally consistent:

| Goal | Order |
|---|---|
| **Interview in ~3 weeks** | [javascript](javascript/) 01–05, 08 → [typescript](typescript/) 01–04, 06 → [event-loop](event-loop/) → [react](react/) 02, 03, 06, **07** → [web-vitals-and-react-perf](web-vitals-and-react-perf/) 01–05 → [architecture-and-state](architecture-and-state/) 02, 04, 05 → [accessibility](accessibility/) 01, 02 |
| **Fix a slow app at work** | [event-loop](event-loop/) 03–05 → [critical-rendering-path](critical-rendering-path/) 01, 03, 14, 15, 17, 18 → [web-vitals-and-react-perf](web-vitals-and-react-perf/) (all) → [bundle-strategy](bundle-strategy/) → [asset-optimization](asset-optimization/) → [spa-memory-leaks](spa-memory-leaks/) |
| **React depth only** | [javascript](javascript/) 01, 05, 07 → [typescript](typescript/) 02–04 → [react](react/) (all, **07 last**) → [web-vitals-and-react-perf](web-vitals-and-react-perf/) 05 → [architecture-and-state](architecture-and-state/) → [resilience](resilience/) 01 |

### The hard prerequisites

Everything else is soft. These four will genuinely not make sense out of order:

| Do this first | Before |
|---|---|
| [javascript 01](javascript/labs/01-scope-and-closures/) (closures) | [spa-memory-leaks](spa-memory-leaks/), [react 02](react/labs/02-hooks-in-depth/) |
| [javascript 05](javascript/labs/05-promises-from-scratch/) + [event-loop](event-loop/) | [react 06](react/labs/06-concurrent/), any INP work |
| [http-caching](http-caching/) | [service-workers](service-workers/), [nextjs-caching](nextjs-caching/) |
| [cors](cors/) | [security-and-auth 03](security-and-auth/labs/03-csrf/), opaque responses in [service-workers](service-workers/) |

### How to do a single lab

1. Read the lab README's **goal** and **primary metric** — nothing else yet.
2. Open the page and **break it first**. Reproduce the bad number before you read the explanation.
3. Fix it, and **re-measure with the same throttle**. A fix you didn't measure is a guess.
4. Answer the **interview questions out loud, without notes**. If you can't, redo the lab.
5. Do the **🏗️ build challenge** against your own codebase — that's where it stops being a demo.

Don't read a lab you haven't run. The numbers are the content.

### Where topics overlap

Several courses deliberately hand off to each other rather than repeating material. The
cross-references are worth following:

| If you are reading about | Also read |
|---|---|
| optimistic updates, conflicts | [architecture-and-state 04](architecture-and-state/labs/04-consistency-and-sync/) → [realtime-ui 04](realtime-ui/labs/04-collaboration/) → [offline-and-pwa 04](offline-and-pwa/labs/04-conflict-resolution/) |
| retries and backoff | [resilience 02](resilience/labs/02-retries-and-idempotency/) → [realtime-ui 02](realtime-ui/labs/02-reconnection/) |
| caching strategies | [http-caching](http-caching/) → [service-workers](service-workers/) → [nextjs-caching](nextjs-caching/) |
| focus and keyboard | [accessibility 02](accessibility/labs/02-keyboard-and-focus/) → [multi-device 03](multi-device/labs/03-tv-and-10-foot/) |
| layout, paint, composite | [critical-rendering-path 03–05](critical-rendering-path/) → [graphics-and-animation 01](graphics-and-animation/labs/01-the-pipeline/) → [web-vitals 03](web-vitals-and-react-perf/labs/03-cls/) |
| version skew and deploys | [offline-and-pwa 05](offline-and-pwa/labs/05-updates/) → [quality-and-delivery 05](quality-and-delivery/labs/05-release-safety/) |
| bundle size | [bundle-strategy](bundle-strategy/) → [web-vitals 06](web-vitals-and-react-perf/labs/06-profiling-and-budgets/) → [quality-and-delivery 04](quality-and-delivery/labs/04-build-and-tooling/) |
| closures & memory | [javascript 01](javascript/labs/01-scope-and-closures/) → [spa-memory-leaks 04](spa-memory-leaks/labs/04-closures-and-caches/) → [react 02](react/labs/02-hooks-in-depth/) |
| why did this re-render | [react 03](react/labs/03-rendering-and-reconciliation/) → [react 07](react/labs/07-mini-react/) → [web-vitals 05](web-vitals-and-react-perf/labs/05-react-render-perf/) |
| making illegal states impossible | [typescript 06](typescript/labs/06-branded-types-and-boundaries/) → [architecture-and-state 05](architecture-and-state/labs/05-state-machines/) |
| microtasks & scheduling | [javascript 05](javascript/labs/05-promises-from-scratch/) → [event-loop](event-loop/) → [react 06](react/labs/06-concurrent/) |
| "facts, not deltas" | [realtime-ui 03](realtime-ui/labs/03-reconciliation/) → [resilience 02](resilience/labs/02-retries-and-idempotency/) → [offline-and-pwa 04](offline-and-pwa/labs/04-conflict-resolution/) |

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
| `/api/events` | **Server-Sent Events**: `interval`, `dropAfter`, `retry`, `flaky`, and replay from `Last-Event-ID`. |
| `ws://localhost:8080/ws` | A hand-rolled **WebSocket** (RFC 6455 handshake, masking, frames) — `interval`, `dropAfter`. Echoes and broadcasts. |
| `/api/reflect` | Reflects input five ways (`raw\|attr\|escaped\|sanitized\|textnode`) — **deliberately vulnerable**, localhost only, for the XSS lab. |
| `/api/csp-page`, `/api/csp-report` | A probe page that reports which of seven things a policy allowed, and a violation-report collector. |
| `/api/csrf` | A toy bank with a switchable defence (`none\|token\|origin`) and a ledger — the CSRF lab. |
| `/api/auth` | Signed access tokens, rotating refresh cookies, and **refresh-token reuse detection**. |
| `/api/thirdparty.js` | A "vendor" script that changes under you at the same URL, with its SRI hash in a header. |
| `/api/text`, `/api/edge` | Compression levels; a toy CDN with HIT/MISS and purge. |

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
| [react-sandbox](react-sandbox/) | `npm install && npm run dev` | one Vite app shared by every React lab: `#hooks`, `#state`, `#render`, `#patterns`, `#concurrent`, `#optimistic`, `#machine`, `#boundaries`. StrictMode is on deliberately |
| [typescript](typescript/) | `npm install` (typescript only) | the labs are **compile-time assertions that currently fail**; `npm run check` is the whole feedback loop |

`react/labs/07-mini-react` needs **nothing** — it implements React itself, and `node test.mjs` in that
folder runs its test suite.

Everything else is zero-dependency and runs on `./serve.sh` alone.

### Shared front-end bits

- `/shared/lab.css` — the chrome. Cheap to paint on purpose.
- `/shared/lab-ui.js` — `Log`, `renderTable`, `renderBars`, `busy(ms)`, `resourceInfo(url)`, `serverStats()`.
- `/shared/perf-hud.js` — live FPS / worst-frame / long-task overlay (`PerfHUD.start()`).
- `/shared/vitals.js` — a readable stand-in for the `web-vitals` library: LCP (with element), CLS
  (with source nodes), INP (with phase breakdown), TTFB, FCP, plus `vitalsHud()`.
- `/shared/lab.css` also ships the accessibility helpers the a11y course uses and you should steal:
  `.skip`, `.visually-hidden`, a `:focus-visible` ring, and a `prefers-reduced-motion` reset.

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
