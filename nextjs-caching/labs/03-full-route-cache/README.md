# Lab 03 — Full route cache ⭐⭐⭐⭐⭐

**Goal:** know why a route is static or dynamic, and be able to find the one line that changed it.

**Primary metric:** the build output's ○ / ƒ markers, and whether a timestamp is frozen.

> <http://localhost:3000/static> and <http://localhost:3000/dynamic>, **after a production build**.

---

## What it is

The rendered output of a route — HTML **and** the RSC payload — cached on the server. If a route can
be rendered without knowing anything about the request, Next renders it **once** and serves everyone
the same bytes.

The build tells you which is which:

```
Route (app)          Revalidate  Expire
┌ ƒ /                                     ƒ = dynamic, rendered per request
├ ○ /isr                    15s      1y   ○ = static, prerendered
├ ƒ /data-cache
├ ƒ /dynamic
└ ○ /static
```

**Read that table on every build.** A route silently moving from ○ to ƒ is the single most common
Next.js performance regression, and it's right there in the output that scrolls past in CI.

## Measure it

After `npm run build && npm start`:

```sh
curl -s localhost:3000/static  | grep -oE '20[0-9-]+T[0-9:.]+Z' | head -1   # twice
curl -s localhost:3000/dynamic | grep -oE '20[0-9-]+T[0-9:.]+Z' | head -1   # twice
```

| | timestamp changes? | means |
|---|---|---|
| `/static` | | rendered once, at build time |
| `/dynamic` | | rendered per request |

## What makes a route dynamic

Any one of these, **anywhere in the tree** — including three components down, or inside a library:

| Cause | Note |
|---|---|
| `headers()` / `cookies()` | the usual culprit |
| `searchParams` in a page | |
| `connection()` / `noStore()` | explicit opt-out |
| `export const dynamic = 'force-dynamic'` | explicit |
| An uncached fetch | version-dependent — measure (lab 02) |
| Reading a request-scoped API in a shared layout | **poisons every route under it** |

That last row is worth pausing on. A `cookies()` call in a shared layout (a theme, a feature flag, an
auth check) makes **every page in that segment** dynamic, and nothing in the code you're looking at
suggests it. When a route you expect to be static shows ƒ, search *upwards* through the layouts as
well as down through the components.

## The interaction with the data cache

They're separate layers and they compose:

```
static route (full route cache)  +  revalidate: 60 (data cache)
    → the HTML is regenerated when the data revalidates
dynamic route  +  revalidate: 60
    → HTML per request, but the data is reused across requests
```

So "my page is dynamic" doesn't mean "my database is being hammered" — check the data cache before
panicking. And "my page is static" doesn't mean the data is frozen — check the revalidate window.

## ISR: time-based route revalidation

`/isr` has `export const revalidate = 15`. In a production build, both its timestamps freeze for 15
seconds, then refresh.

Measure what happens at the boundary — request at t=16s, then again at t=17s — and describe the
behaviour you actually observe. Compare it with the classic stale-while-revalidate model from
[rendering-strategies lab 04](../../../rendering-strategies/labs/04-ssg-and-isr/): does the first
request after expiry get the old page or the new one? The answer has changed between Next versions,
which is exactly why you measure rather than recite.

## Development lies

`next dev` re-renders on every request and largely bypasses this cache. **Every caching bug in this
lab is invisible in development.** Test with `npm run build && npm start`, and put a build-output
check in CI.

## Think about

- A route was static and is now dynamic. How do you find the cause?
- Is a dynamic route bad?
- You need per-user content on an otherwise static page. What are your options?

<details>
<summary>Answers</summary>

**Finding the cause.** Diff the build output's ○/ƒ table against the previous build — that's the
alarm. Then bisect: comment out subtrees, or grep for the dynamic APIs in the route's components
**and its layouts**. Next also reports the reason for some opt-outs in build logs; read them.

**Is dynamic bad?** No. A per-user dashboard *should* be dynamic; making it static would be a
correctness bug. It's bad when it's *accidental* — a marketing page that went dynamic because
someone added an analytics cookie read to the root layout. The question is never "static or
dynamic", it's "did I choose this?"

**Per-user on a static page.** (1) Render the shared page statically and fetch the personal fragment
client-side; (2) stream the personal part with `Suspense` while the shell is static; (3) move the
personalisation to the edge (middleware rewriting a placeholder). All three keep the expensive,
shared part cacheable — the same "cache the page, not the person" split as
[rendering-strategies lab 06](../../../rendering-strategies/labs/06-choose-per-route/).
</details>

---

## 🏗️ Build challenge

1. **A CI check on the build output**: parse `next build`'s route table and fail if a route moves
   from ○ to ƒ without an explicit allowlist entry. This is 40 lines and prevents the most common
   regression in the framework.
2. **An "accidentally dynamic" detector**: for each dynamic route, report which API caused it and
   where — by instrumenting `headers`/`cookies` in a dev build, or via an AST pass over the route's
   module graph including layouts.
3. **A staleness report** per static route: revalidate window, last regeneration, and the worst-case
   age a user could see.
4. **A production probe**: hit each route twice and assert the cache behaviour the build promised —
   ○ routes should return identical bytes.

**Done when:** deliberately adding `cookies()` to a leaf component fails CI with a message naming the
file.

---

## Interview questions

1. What does the full route cache store?
2. Name five things that make a route dynamic.
3. A route in a shared layout calls `cookies()`. What happens to the routes below it?
4. Is a dynamic route a problem?
5. Why can't you observe any of this in `next dev`?
6. How do the data cache and full route cache interact?
