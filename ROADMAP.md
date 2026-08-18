# The mastery roadmap

Everything, in order, with an honest status for each item.

**Mastery here means one thing:** you can *cause* the behaviour, *measure* it, *name the mechanism*,
and *fix it* — on demand, without notes. Not "I've read about hydration". "I can make hydration cost
400ms, show you where in the profile, and cut it to 40."

---

## How this repo grades itself

Three shapes, and which one a topic gets is a judgement about whether the target is checkable:

| Shape | You do | Used for |
|---|---|---|
| **lab** | run it, read the numbers, do the build challenge | mechanisms you must *see* — jank, plans, stampedes |
| **drill** | edit `solution.*` until a machine-checked target passes | anything with a verifiable target — SQL plans, cache semantics, security |
| **test suite** | make failing tests pass | design decisions — API contracts, error envelopes |

**Status column:** ✅ built · 🟡 partial · ⬜ not built.

---

# Tier 0 — The language

*Nothing else makes sense underneath a shaky model of the runtime.*

| Topic | Status | Where |
|---|---|---|
| Execution context, scope, hoisting, TDZ | ✅ | [javascript 01](javascript/labs/01-scope-and-closures/) |
| Closures — and what they **retain** | ✅ | [javascript 01](javascript/labs/01-scope-and-closures/) |
| `this` binding, prototypes, property descriptors | ✅ | [javascript 02](javascript/labs/02-this-and-prototypes/) |
| Coercion & equality (the spec algorithms) | ✅ | [javascript 03](javascript/labs/03-coercion-and-equality/) |
| References, cloning, immutability, array traps | ✅ | [javascript 04](javascript/labs/04-references-and-cloning/) |
| Promises **from scratch** + async/await desugaring | ✅ | [javascript 05](javascript/labs/05-promises-from-scratch/) |
| Iterators, generators, async iteration, backpressure | ✅ | [javascript 06](javascript/labs/06-iterators-and-generators/) |
| Proxy & Reflect — reactivity, Immer, the tax | ✅ | [javascript 07](javascript/labs/07-proxy-and-reflect/) |
| Engine intuition — hidden classes, ICs, deopts | ✅ | [javascript 08](javascript/labs/08-engine-intuition/) |
| Memory & GC, the reference graph | ✅ | [spa-memory-leaks](spa-memory-leaks/) |
| Modules & bundling (ESM, tree shaking, side effects) | ✅ | [bundle-strategy](bundle-strategy/) |
| Tagged templates & DSLs | ⬜ | — |

**TypeScript**

| Topic | Status | Where |
|---|---|---|
| Structural typing, assignability, variance | ✅ | [typescript 01](typescript/labs/01-structural-typing/) |
| Generics & inference, `const` type params | ✅ | [typescript 02](typescript/labs/02-generics-and-inference/) |
| Narrowing, predicates, assertion signatures, exhaustiveness | ✅ | [typescript 03](typescript/labs/03-narrowing-and-exhaustiveness/) |
| Mapped & conditional types, template literals | ✅ | [typescript 04](typescript/labs/04-mapped-and-conditional/) |
| **Type-level programming** — typed router, dotted paths, arithmetic | ✅ | [typescript 05](typescript/labs/05-type-level-programming/) |
| Branded/nominal types, parse-don't-validate | ✅ | [typescript 06](typescript/labs/06-branded-types-and-boundaries/) |
| Declaration files, config, type performance | ✅ | [typescript 07](typescript/labs/07-declarations-and-config/) |

> **Proof of tier 0:** you can explain what a closure retains by pointing at a retainer chain, write
> a Promises/A+ implementation that passes the suite, and make a 10× slowdown appear by changing only
> the *shape* of an object.

---

# Tier 1 — The browser

| Topic | Status | Where |
|---|---|---|
| Event loop, tasks vs microtasks, starvation | ✅ | [event-loop](event-loop/) |
| Yielding, `scheduler.yield`, timer clamping | ✅ | [event-loop](event-loop/) |
| Parse → DOM/CSSOM → layout → paint → composite | ✅ | [critical-rendering-path](critical-rendering-path/) (18 labs) |
| Layout thrash, forced reflow, style recalculation | ✅ | [critical-rendering-path](critical-rendering-path/) |
| Compositor layers, paint storms | ✅ | [critical-rendering-path](critical-rendering-path/) |

**Network & caching**

| Topic | Status | Where |
|---|---|---|
| `Cache-Control`, validators, `stale-while-revalidate`, `Vary` | ✅ | [http-caching](http-caching/) |
| Same-origin policy, preflight, credentials, opaque responses | ✅ | [cors](cors/) |
| Preload scanner, `preconnect`, `fetchpriority`, speculation rules | ✅ | [resource-hints](resource-hints/) |
| Service worker lifecycle & cache strategies | ✅ | [service-workers](service-workers/) |

**Compute & storage**

| Topic | Status | Where |
|---|---|---|
| Workers, transferables, pools, RPC, OffscreenCanvas | ✅ | [web-workers](web-workers/) |
| IndexedDB, Cache API, quotas, eviction | ✅ | [browser-storage](browser-storage/) |
| Detached nodes, listener leaks, the snapshot workflow | ✅ | [spa-memory-leaks](spa-memory-leaks/) |

> **Proof of tier 1:** given a janky page you can name the stage, show it in the Performance panel,
> and cut the worst frame in half.

---

# Tier 2 — React

| Topic | Status | Where |
|---|---|---|
| JSX, elements vs components vs instances | ✅ | [react 01](react/labs/01-core-model/) |
| Hooks in depth — batching, effect timing, stale closures, deps | ✅ | [react 02](react/labs/02-hooks-in-depth/) |
| Render vs commit, reconciliation, keys, memo | ✅ | [react 03](react/labs/03-rendering-and-reconciliation/) |
| State strategy, server state, typing React | ✅ | [react 04](react/labs/04-state-data-and-types/) |
| Patterns — compound, controllable, headless, prop getters | ✅ | [react 05](react/labs/05-patterns/) |
| Concurrent — transitions, Suspense, **tearing** | ✅ | [react 06](react/labs/06-concurrent/) |
| **Write a mini React** (260 lines, 10 tests) | ✅ | [react 07](react/labs/07-mini-react/) |
| Render performance, virtualization, profiling | ✅ | [web-vitals 05](web-vitals-and-react-perf/labs/05-react-render-perf/) |
| Custom renderers (`react-reconciler`) | ⬜ | build challenge in react 07 |
| Scheduler internals, lanes | 🟡 | explained in react 06/07; not built |

> **Proof of tier 2:** you can answer "why did this re-render" by pointing at a line in a renderer
> you wrote.

---

# Tier 3 — Delivery

| Topic | Status | Where |
|---|---|---|
| CSR / SSR / SSG / ISR / streaming / RSC | ✅ | [rendering-strategies](rendering-strategies/) |
| Hydration cost, islands, lazy triggers, resumability, mismatches | ✅ | [hydration-strategies](hydration-strategies/) |
| What crawlers see, metadata, structured data, canonicals | ✅ | [seo-for-rendering](seo-for-rendering/) |
| Images, fonts, compression, CDN & edge | ✅ | [asset-optimization](asset-optimization/) |
| Splitting, tree shaking, dynamic import, size gates | ✅ | [bundle-strategy](bundle-strategy/) |
| Next.js four cache layers | ✅ | [nextjs-caching](nextjs-caching/) |

---

# Tier 4 — Architecture & the hard parts

| Topic | Status | Where |
|---|---|---|
| Component architecture, deletion & change tests | ✅ | [architecture-and-state 01](architecture-and-state/labs/01-component-architecture/) |
| State strategy: local / context / store / server / URL | ✅ | [architecture-and-state 02](architecture-and-state/labs/02-state-strategy/) |
| Data fetching & the BFF | ✅ | [architecture-and-state 03](architecture-and-state/labs/03-data-fetching-and-bff/) |
| Client consistency, optimistic updates, conflicts | ✅ | [architecture-and-state 04](architecture-and-state/labs/04-consistency-and-sync/) |
| UI state machines | ✅ | [architecture-and-state 05](architecture-and-state/labs/05-state-machines/) |
| Design systems & tokens | ✅ | [architecture-and-state 06](architecture-and-state/labs/06-design-system/) |
| Micro-frontends (and the honest ledger) | ✅ | [architecture-and-state 07](architecture-and-state/labs/07-micro-frontends/) |
| SSE vs WebSocket vs polling, reconnection, reconciliation | ✅ | [realtime-ui](realtime-ui/) |
| **CRDTs & real-time collaboration** | ✅ | [realtime-ui 04](realtime-ui/labs/04-collaboration/) |
| Backpressure & conflation | ✅ | [realtime-ui 05](realtime-ui/labs/05-scale-and-backpressure/) |
| Error boundaries, retries & idempotency, degradation, circuit breaking, chaos | ✅ | [resilience](resilience/) |
| Installability, offline UX, the durable outbox, conflicts, updates | ✅ | [offline-and-pwa](offline-and-pwa/) |

---

# Tier 5 — The user

| Topic | Status | Where |
|---|---|---|
| Core Web Vitals measured properly (LCP / CLS / INP) | ✅ | [web-vitals-and-react-perf](web-vitals-and-react-perf/) |
| Frame budget, animation APIs, the pipeline | ✅ | [graphics-and-animation](graphics-and-animation/) |
| **Canvas 2D, WebGL/GPU, choosing a renderer** | ✅ | [graphics-and-animation 04–06](graphics-and-animation/) |
| Semantics, focus, ARIA & live regions, forms, contrast, testing | ✅ | [accessibility](accessibility/) (6 labs) |
| Input modalities, container queries, **TV & the 10-foot UI**, adaptive delivery | ✅ | [multi-device](multi-device/) |
| `Intl`, plurals & ICU, bidi & typography, delivery | ✅ | [i18n](i18n/) |
| XSS, CSP, CSRF, client tokens, supply chain | ✅ | [security-and-auth](security-and-auth/) |
| Testing strategy, observability, build speed, release safety | ✅ | [quality-and-delivery](quality-and-delivery/) |

---

# Tier 6 — Applied component design

*Implementable, and the mastery is entirely in the details. **Not built — highest-value gap on the
frontend side.***

| Component | Mastery is | Status |
|---|---|---|
| Typeahead / autocomplete | debounce, **request cancellation**, caching, ranking, keyboard a11y | ⬜ |
| Infinite scroll / virtualized feed | windowing, prefetch, **scroll restoration**, stable keys | ⬜ |
| Collaborative rich-text editor | local model, conflict handling, CRDT/OT intuition | ⬜ |
| Media player | buffering states, ABR hooks, captions, TV-remote input | ⬜ |
| Dashboard with live widgets | layout, **independent data lifecycles**, partial failure | ⬜ |
| Image gallery / carousel | lazy load, LQIP, preloading neighbours, gestures | ⬜ |

Every one is a composite of things tiers 1–5 already teach. They belong as **labs with a test
suite** — a working component, a failing spec.

---

# Tier 7 — Product-scale frontend system design

*Deliberately **not** labs — you can't build Netflix in a lab, and the skill is a 45-minute
conversation. These want a **framework + worked reference designs + a rubric**.*

| Design | Core tension | Status |
|---|---|---|
| Video streaming (Netflix/YouTube) | catalog, player, ABR, continue-watching, multi-device, prefetch | ⬜ |
| Social feed (Twitter/Instagram) | feed rendering, pagination, real-time, optimistic actions, media | ⬜ |
| Chat (WhatsApp/Slack) | virtualized messages, presence, delivery states, offline queue, ordering | ⬜ |
| E-commerce + cart (Amazon) | listing/search, cart state, checkout, perf at catalog scale | ⬜ |
| Email client (Gmail) | massive lists, threading, search, offline, optimistic archive | ⬜ |
| Design tool (Figma-lite) | canvas/WebGL, real-time collab, viewport perf | ⬜ |
| Maps UI | tile loading, gestures, marker clustering | ⬜ |

---

# Tier 8 — Backend: service & data

**This is where the repo is thinnest.** Item-level honesty below.

## 8.1 Service architecture & API craft

| Item | Status | Where |
|---|---|---|
| REST design, status codes, cursor pagination, versioning | ✅ | [api-craft](backend/api-craft/) (25 tests) |
| Validation, error envelope, request ids | ✅ | [api-craft](backend/api-craft/) |
| Idempotency for POST | ✅ | [api-craft](backend/api-craft/) |
| Health, readiness & **graceful shutdown** | 🟡 | asserted in api-craft; the signal handling is a TODO |
| Project structure & clean architecture, DI, testable seams | ⬜ | — |
| OpenAPI / contract-first, generated types | ⬜ | — |
| Node Express/Fastify lifecycle, middleware order | 🟡 | used in api-craft; not taught |
| **Go: net/http + chi/gin**, context propagation | ⬜ | — |
| Config, secrets & 12-factor | ⬜ | — |

## 8.2 API styles & protocols

| Item | Status |
|---|---|
| GraphQL schema & resolvers, context, error masking | ⬜ |
| **GraphQL N+1 & DataLoader** | ⬜ |
| GraphQL at scale — Relay cursors, depth/complexity limits, persisted queries | ⬜ |
| Federation & subscriptions | ⬜ |
| Apollo/Yoga (Node) & gqlgen (Go) | ⬜ |
| gRPC & Protobuf — unary vs streaming, deadlines | ⬜ |
| tRPC — end-to-end typesafe | ⬜ |
| REST vs GraphQL vs gRPC vs tRPC — choose and defend | ⬜ |

## 8.3 Real-time, webhooks & streaming

| Item | Status |
|---|---|
| WebSocket server — lifecycle, auth on connect, rooms, Redis pub/sub scaling | ⬜ |
| SSE & long-polling, reconnection, last-event-id | 🟡 *(client side in [realtime-ui](realtime-ui/); server side ⬜)* |
| **Webhooks — HMAC signing/verification, retries, idempotent delivery, replay protection** | ⬜ |
| Pub/sub & presence, fan-out across instances | ⬜ |
| Streaming responses — chunked HTTP, LLM token streaming | ⬜ |

## 8.4 Data layer & Postgres depth

| Item | Status | Where |
|---|---|---|
| **EXPLAIN ANALYZE — reading a plan** | ✅ | [lab 02](backend/postgres/labs/02-explain-analyze/) |
| **Indexing** — composite order, partial, covering, unusable, write cost | ✅ | [lab 03](backend/postgres/labs/03-indexing/) + 7 drills |
| **Transactions, isolation & locking**, deadlocks, `SKIP LOCKED` | ✅ | [lab 06](backend/postgres/labs/06-transactions-and-locking/) + 2 drills |
| **N+1 & ORM traps**, keyset pagination | ✅ | [lab 08](backend/postgres/labs/08-n-plus-1-and-orms/) + 1 drill |
| Schema design & **zero-downtime migrations** | ⬜ | — |
| Advanced SQL — CTEs, window functions, lateral joins, upserts | 🟡 | used in lab 08; not taught |
| JSONB & full-text search, GIN/trigram | ⬜ | — |
| Partitioning, matviews, LISTEN/NOTIFY | ⬜ | — |
| ORMs & query builders — tradeoffs and escape hatches | 🟡 | covered as traps in lab 08 |
| Connection pooling, PgBouncer, read replicas & lag | ⬜ | — |

## 8.5 Messaging, jobs & data flow

| Item | Status | Where |
|---|---|---|
| **Delivery guarantees** — at-least-once + idempotent consumer | ✅ | [drill 03](backend/caching-and-queues/drills/03-idempotent-consumer/) |
| **Outbox pattern** | ✅ | [drill 04](backend/caching-and-queues/drills/04-the-outbox/) |
| **Caching with Redis** — cache-aside, TTLs, invalidation, **stampede protection** | ✅ | [lab 02](backend/caching-and-queues/labs/02-stampede/) + [drill 01](backend/caching-and-queues/drills/01-stop-the-stampede/) |
| **Background jobs & queues** — retries, backoff, **DLQ** | ✅ | [jobs drill 01](backend/jobs-and-messaging/drills/01-retries-and-dlq/) |
| **Consumer groups, acks & claim-after-timeout** | ✅ | [jobs drill 02](backend/jobs-and-messaging/drills/02-consumer-groups/) |
| **Node async & backpressure** — cursors, bounded pools, event-loop lag | ✅ | [jobs drill 03](backend/jobs-and-messaging/drills/03-node-backpressure/) |
| **Sagas & compensation** | ✅ | [jobs drill 04](backend/jobs-and-messaging/drills/04-saga-compensation/) |
| **Go concurrency** — races, worker pools, context cancellation, `-race` | ✅ | [go-concurrency](backend/go-concurrency/) (3 drills) |
| Kafka/RabbitMQ/NATS specifics — partitions, rebalancing, protocol | ⬜ | broker *semantics* covered by jobs drill 02 |
| CDC / Debezium | ⬜ | — |
| Scheduling & long-running workflows (Temporal) | 🟡 | compensation ✅; durable workflow state ⬜ |

## 8.6 Auth, security & compliance

| Item | Status | Where |
|---|---|---|
| **Password hashing** (salt, slow KDF, timing-safe) | ✅ | [drill 01](backend/auth-and-security/drills/01-password-storage/) |
| **Timing oracles** | ✅ | [drill 02](backend/auth-and-security/drills/02-timing-safe-compare/) |
| **AuthZ enforcement / IDOR** | ✅ | [drill 03](backend/auth-and-security/drills/03-broken-authorization/) |
| **SSRF defence** | ✅ | [drill 04](backend/auth-and-security/drills/04-ssrf/) |
| **Refresh-token rotation & reuse detection** | ✅ | [drill 05](backend/auth-and-security/drills/05-token-rotation/) |
| **Rate limiting** | ✅ | [caching drill 02](backend/caching-and-queues/drills/02-the-rate-limiter/) |
| **Idempotency & safe retries** | ✅ | [api-craft](backend/api-craft/) + [drill 03](backend/caching-and-queues/drills/03-idempotent-consumer/) |
| Sessions vs JWT, HttpOnly cookies | 🟡 | browser side in [security-and-auth 04](security-and-auth/labs/04-auth-and-sessions/) |
| OAuth2 / OIDC / SSO, **PKCE**, token introspection | ⬜ | — |
| RBAC/ABAC modelling, least privilege, **mTLS** | ⬜ | — |
| Injection & input hardening, upload validation | 🟡 | XSS/CSP client-side ✅; server-side ⬜ |
| Secrets, encryption at rest/transit, **PII, GDPR delete/export, audit logs** | ⬜ | — |

## 8.7 Common subsystems & integrations — *all ⬜*

File & media (multipart, presigned URLs, virus scan, processing pipeline) · Search (Postgres FTS vs
Elasticsearch, indexing pipeline, relevance) · **Payments** (Stripe/Razorpay flows, webhook
idempotency, ledger reconciliation, PCI basics) · Notifications (email/SMS/push, provider
abstraction, dedup) · **Geospatial** (PostGIS/Redis GEO, proximity, live location) · Third-party
hygiene (timeouts, jitter, circuit breakers, sandbox vs prod)

## 8.8 Reliability, testing, observability & deploy

| Item | Status | Where |
|---|---|---|
| **Timeouts on every I/O call** (with abort) | ✅ | [reliability](backend/reliability/) |
| **Retries with jitter and a budget** | ✅ | [reliability](backend/reliability/) |
| **Circuit breaker** (rate-based, half-open probe) | ✅ | [reliability](backend/reliability/) |
| **Structured logs** with redaction and error serialisation | ✅ | [reliability](backend/reliability/) |
| **RED metrics** — percentiles, not averages | ✅ | [reliability](backend/reliability/) |
| **Trace-context propagation** (W3C traceparent) | ✅ | [reliability](backend/reliability/) |
| Table-driven Go tests, `-race` in CI | ✅ | [go-concurrency](backend/go-concurrency/) |
| OpenTelemetry SDK wiring & exporters | ⬜ | primitives ✅, real SDK ⬜ |
| Testcontainers & contract testing | ⬜ | — |
| Containers & orchestration | ⬜ | — |
| CI/CD & **expand/contract migrations** | ⬜ | — |
| Performance, load & cost (k6, pprof) | ⬜ | — |
| Bulkheads | ⬜ | — |

> The *frontend* equivalents are built: [quality-and-delivery](quality-and-delivery/) and
> [resilience](resilience/). The backend versions share the ideas and none of the tooling.

## 8.9 Distributed systems, hard mode — *all ⬜*

**Sagas & compensations** ✅ ([jobs drill 04](backend/jobs-and-messaging/drills/04-saga-compensation/))
· **Exactly-once, proven** ✅ ([caching drill 03](backend/caching-and-queues/drills/03-idempotent-consumer/)
+ [drill 04](backend/caching-and-queues/drills/04-the-outbox/))

Still ⬜: Consensus in practice (Raft) · Event sourcing & CQRS end to end · Zero-downtime migrations
(expand/contract, backfills, dual writes) · Chaos & correctness testing (fault injection,
Jepsen-style checks, property-based tests)

---

# Tier 9 — Build & ship (portfolio-grade) — *all ⬜*

The point of these is that they're **not** exercises. Each is a repo you'd show someone.

| Project | Must demonstrate |
|---|---|
| Production-grade REST + GraphQL service | one service, both interfaces, validation, auth, DataLoader, tests, observability, Docker |
| **Payment / ledger service** | double-entry ledger, idempotency keys, transactional integrity, reconciliation |
| Rate-limited, cached, geo API | Redis rate limit + cache-aside + PostGIS proximity, under load |
| Event-driven pipeline | producer + broker + idempotent consumer + outbox + DLQ + metrics |
| Real-time service | WebSocket/SSE with presence, Redis pub/sub, reconnection, horizontal scaling |

---

## Where things actually stand

| | Built | Notes |
|---|---|---|
| **Frontend** | 29 courses, 144 runnable labs | tiers 0–5 essentially complete |
| **Backend** | 5 labs, **26 drills**, 51 tests | tier 8 is ~55% by item count |
| **Applied / system design / portfolio** | nothing | tiers 6, 7, 9 |

**Overall: roughly 68% of this roadmap exists.** The frontend is close to done; the backend, applied
design, and portfolio tiers are where the remaining work is.

## The order I'd actually do it in

1. **Tiers 0–2** in order. They compound, and skipping them is why people plateau.
2. **Tier 8.4 + 8.5 + 8.6** (Postgres, messaging, security) — the built backend drills, in parallel
   with tier 3. They need Docker rather than a browser, so they interleave well.
3. **Tiers 3–5** — delivery, architecture, the user.
4. **Tier 6** — applied components, once you have the pieces.
5. **Tier 7** — system design, as conversation practice, continuously.
6. **Tier 9** — one portfolio project, built properly, at the end.

Detailed sequencing for the built material is in the [README](README.md#the-order-to-do-them-in),
including three shorter routes if you don't have five months.

## What "done" looks like per tier

Not a checkbox — something you can do:

| Tier | You can |
|---|---|
| 0 | write a spec-compliant Promise; make a function 10× slower by changing object shape |
| 1 | take a janky page, name the stage, halve the worst frame |
| 2 | explain any React behaviour by pointing at a line in a renderer you wrote |
| 3 | choose a rendering strategy per route and defend it with TTFB numbers |
| 4 | design an offline-capable, conflict-resolving sync layer and say what it loses |
| 5 | complete your app's primary flow with a screen reader, and hit CWV at p75 |
| 6 | build a production typeahead with cancellation and keyboard a11y, from scratch |
| 7 | whiteboard a feed or a chat app in 45 minutes, with the trade-offs named |
| 8 | find a slow query from a plan, fix a lost update, stop a stampede, defeat an SSRF |
| 9 | hand someone a repo and have them say "this is production code" |
