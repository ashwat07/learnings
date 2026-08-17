# Lab 02 — The offline experience ⭐⭐⭐⭐

**Goal:** design the four states, not two.

**This lab is mostly reading plus two existing labs.** Run
[service-workers lab 03](../../../service-workers/labs/03-network-first/) and
[browser-storage lab 06](../../../browser-storage/labs/06-offline-data-layer/) with the Network panel
set to **Offline**, and read this against what you see.

---

## Four states, not two

| State | What's true | The UI |
|---|---|---|
| online, fresh | current data | normal |
| **online, stale** | cached data, revalidating | show it with a subtle indicator |
| **offline, usable** | cache + working outbox | show it **labelled**, accept writes |
| offline, unusable | no cache for this route | say so, and offer what *is* available |

Most apps model the first and last. The middle two are where all the value and all the difficulty
are.

## The rules

**1. Never show a blank screen because the network is down.** If you have data, show it. If you don't
have *this* data but have *other* data, show that and explain. A blank screen with a spinner is the
worst possible answer because it's indistinguishable from slow.

**2. Label staleness, don't hide it.** "Updated 3 minutes ago" costs one line and converts "this app
is wrong" into "this app is honest". Users tolerate old data they can see is old; they don't tolerate
current-looking data that isn't.

**3. Never lie about a write.** The single most damaging offline bug is a UI that says "Saved" for
something that isn't. See [lab 03](../03-the-outbox/).

**4. `navigator.onLine` is a hint.** `false` is reliable (no interface). `true` means only "an
interface exists" — a captive portal, a VPN routing nowhere, or a dead server all report `true`. Use
it to *stop* trying, never as proof a request will succeed. The only proof is a successful request.

**5. Design the offline page as a page, not an error.** Chrome's dinosaur is famous because it gives
you something to do. Yours should list what *is* available offline, and link to it.

## What to cache, and what that decides

| Content | Strategy | Why |
|---|---|---|
| the app shell (HTML/CSS/JS) | **cache-first**, versioned | it changes on deploy, not per request |
| user data | **network-first with a cache fallback** | freshness matters; staleness is survivable |
| immutable assets (hashed) | cache-first, `immutable` | the URL changes when the content does |
| avatars, thumbnails | stale-while-revalidate | wrong-but-instant is fine |
| analytics, tracking | **never cache; queue or drop** | it must never block or occupy the cache |
| anything authenticated | **be careful** — see below |

All four strategies are built from scratch in [service-workers labs 02–04](../../../service-workers/).

### The authentication trap

A cached page rendered for user A must never be served to user B on a shared device. Two rules:
**key caches by user or session**, and **clear every cache on logout** — Cache Storage, IndexedDB,
and anything your service worker holds. A logout that only clears a cookie leaves the previous user's
data on disk and one cache hit away.

## Telling the user

- a persistent, quiet indicator when offline — a bar, not a modal
- per-item state for anything queued (pending / sending / failed)
- **an action they can take**: retry, view what's queued, discard
- never an interruptive dialog for an offline state; they know their train is in a tunnel

## Think about

- Should a "Refresh" button appear when offline?
- Your app caches a page rendered for a logged-in user. What could go wrong?
- What's the offline behaviour of a route the user has never visited?

<details>
<summary>Answers</summary>

**Refresh when offline.** Yes — visible and enabled. Disabling it removes the user's ability to test
whether connectivity came back, and `navigator.onLine` isn't reliable enough for you to make that
call for them. Let them press it, attempt the request, and report the result honestly.

**Cached authenticated page.** On a shared device, user B gets user A's data — a real and serious
leak. Also: the cached page may contain a token or personalised content in the HTML, which survives
logout. Key caches by user id, clear everything on logout, and never cache authenticated *documents*
cache-first (network-first with a fallback is the right shape, so a fresh response always wins when
one is available).

**Never-visited route.** Nothing is cached, so it fails. The design decision is what fails *to*: a
generic offline page (weak), a shell that explains this specific route needs a connection and links
to what's cached (better), or a precached shell that renders whatever local data exists for that
route (best, and the reason app-shell architecture exists).
</details>

---

## 🏗️ Build challenge

1. Write down the four states for your app's three most important screens, and what each shows.
2. Implement a staleness indicator driven by a real timestamp stored with the data.
3. Build a real offline page listing what's available.
4. Audit your caching for authenticated content; add a logout that clears everything.
5. Use the app with the Network panel offline for ten minutes and fix everything that lies.

**Done when:** every screen has a defined appearance in all four states, and none of them is blank.

---

## Interview questions

1. Name the four connectivity states and what each should show.
2. Why isn't `navigator.onLine === true` proof of connectivity?
3. What's the risk of caching an authenticated page?
4. Which cache strategy for app shell vs user data, and why?
