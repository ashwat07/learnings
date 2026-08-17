# Service workers ⭐⭐⭐⭐⭐

A service worker is a proxy you ship to the browser. Every request from every page in its scope
goes through your JavaScript first — which makes it the most powerful and the most dangerous thing
in the platform. A bad deploy of a service worker doesn't degrade your site; it can *replace* it,
persistently, for users you cannot reach.

```sh
./serve.sh    # then http://localhost:8080/service-workers/labs/01-lifecycle/
```

---

## The mental model

```
     page ──fetch──► [ service worker fetch handler ] ──► Cache Storage
                                │                    └──► network
                                └──► or: make something up entirely
```

Three properties that follow, and that explain every quirk:

1. **It outlives the page.** It's a worker with no DOM, started and stopped by the browser at
   will. Never keep state in a module-level variable and expect it to survive.
2. **It is versioned by its own bytes.** The browser re-fetches the SW script (at most every 24
   hours, and on every navigation in practice), compares it byte-for-byte, and if it differs,
   installs a new one — which then **waits** until every page controlled by the old one is gone.
3. **A page is either controlled or it isn't.** The page that registers a service worker is *not*
   controlled by it until a navigation (or `clients.claim()`). Half the "my service worker isn't
   working" reports are this.

### The lifecycle

```
register → installing ──(install event ok)──► installed / WAITING
                                                    │
                            (all old clients gone,  │  or skipWaiting())
                                                    ▼
                                                 activating ──► ACTIVATED ──► idle/terminated
```

**Waiting is a feature, not a bug.** It guarantees that a page never has half its assets from
build A and half from build B. `skipWaiting()` throws that guarantee away — which is sometimes
right and always a decision.

### Caching strategies, and when each is correct

| Strategy | Serve from | Use for |
|---|---|---|
| **Cache first** | cache, network only on miss | fingerprinted assets, fonts, the app shell |
| **Network first** | network, cache on failure | API data where freshness matters, HTML |
| **Stale-while-revalidate** | cache immediately, refresh behind | avatars, config, non-critical data |
| **Network only** | never cache | writes, analytics, anything with a side effect |
| **Cache only** | precached, never network | offline fallback page, an app shell you fully control |

If that table looks like the HTTP caching course, that's the point: a service worker lets you
implement those policies *in JavaScript*, per request, with logic the HTTP cache can't express
("if offline, serve the last known good; if it's a navigation, fall back to the shell").

---

## Curriculum

| # | Lab | Question it answers | ⭐ |
|---|---|---|---|
| 01 | [Lifecycle](labs/01-lifecycle/) | Why is my new service worker not running? | ⭐⭐⭐⭐⭐ |
| 02 | [Cache first & precaching](labs/02-cache-first/) | How do I make the app shell instant and still ship updates? | ⭐⭐⭐⭐⭐ |
| 03 | [Network first & offline](labs/03-network-first/) | How do I stay useful when the network doesn't answer? | ⭐⭐⭐⭐⭐ |
| 04 | [SWR & navigation preload](labs/04-swr-and-preload/) | How do I avoid making every request slower? | ⭐⭐⭐⭐ |
| 05 | [The traps](labs/05-traps/) | The five ways service workers ruin a production site | ⭐⭐⭐⭐⭐⭐ |
| 06 | [Build a mini-Workbox](labs/06-mini-workbox/) | Put it together as a routing layer you'd ship | ⭐⭐⭐⭐⭐ |

## DevTools setup for this course

Application → Service Workers:

- **Update on reload** — forces install+activate on every reload. Turn it **on** while building,
  **off** while studying the lifecycle (Lab 01), or you'll never see the waiting state.
- **Bypass for network** — pages ignore the SW entirely. Your escape hatch.
- **Offline** — in the Network panel; simulate a dead network without unplugging anything.
- **Unregister** — and remember it doesn't clear Cache Storage. Application → Storage → *Clear
  site data* is the real reset.

Each lab registers a service worker scoped to **its own directory**, so labs don't interfere. Every
lab page has an *unregister + clear caches* button. Use it when you leave.

## The rule that prevents the worst outcome

**Never cache your service worker file, and never cache your HTML with a long `max-age`.** The
service worker is the mechanism by which you fix everything else; if a broken one is cached, you
have no way to reach that user. Browsers now cap the SW script's `max-age` at 24 hours for exactly
this reason — a cap that exists because sites bricked themselves.

Ship a kill switch (Lab 05) before you ship a service worker.
