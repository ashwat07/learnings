# Lab 05 — The RSC model ⭐⭐⭐⭐

**Goal:** be able to say what Server Components actually change, where the client boundary is, and
why one `"use client"` in the wrong file is expensive.

**Primary metric:** round trips to first paint, and KB that never ship.

> Open <http://localhost:8080/rendering-strategies/labs/05-rsc-model/>

---

## The one distinction that matters

Server Components are not "SSR with extra steps". SSR runs your component on the server *and* ships
it to the client to hydrate. A Server Component's **code never reaches the browser at all**.

| | Server Component | Client Component (`"use client"`) |
|---|---|---|
| Runs | on the server, once | on the server (SSR) **and** in the browser |
| Can `await` a database | ✅ directly | ❌ |
| Its code ships to the client | **never** | yes, and it's hydrated |
| `useState` / `useEffect` / `onClick` | ❌ | ✅ |
| Client JS cost | **0 KB**, however big it is | bundle bytes + hydration time |
| Can render the other kind | ✅ (client children) | only as passed-in children |

## What crosses the wire

Run the first demo:

| strategy | document | client JS needed | extra data | round trips to paint |
|---|---|---|---|---|
| ssr | | | 0 | **1** |
| rsc | | | 0 | **2** |
| csr | | | | **3** |

**Round trips, not bytes, is the column that decides the argument.** On a 150ms-RTT link those
extra legs are dead time no byte-shaving removes:

- `ssr` — the HTML *is* the paint.
- `rsc` — document, then the renderer JS. **The payload is not paintable.**
- `csr` — document, then JS, then data.

So "our JSON is smaller than your HTML" isn't the win people think it is. (Real RSC *streams* its
payload, so it behaves closer to 1.5 round trips — the client renders what has arrived. This
sandbox sends one blob to keep the model readable.)

What RSC genuinely buys is on the *other* side of the wire, and no client-side measurement shows it:

1. **Server-only code stays server-only** — the DB client, the markdown renderer, the secrets.
2. **A server component costs zero client JS**, however large.
3. **The payload is diffable**, so a navigation can update part of the tree and keep client state.

## The boundary leaks one way

```
"use client"   ← everything this module imports, and everything THEY import,
                 is now in the client bundle
```

That's why `"use client"` at the top of a **shared utility** or a **barrel/index file** is often the
most expensive line in a Next.js app — and nothing in the type system warns you.

Habits that keep it tight:

- Push `"use client"` as far **down** the tree as possible: a client *leaf*, not a client *page*.
- Never put it in a barrel file.
- Pass server-rendered markup **into** client components as `children`, instead of importing server
  logic into them.
- Only **serialisable props** cross the boundary — no functions, no class instances. (This is the
  structured-clone constraint from the [web-workers course](../../../web-workers/labs/02-message-costs/),
  again. Same rule, different boundary.)
- **Measure it.** A bundle analyser is the only way to see what crossed — that's the
  [bundle-strategy](../../../bundle-strategy/) course.

## Navigation: the real payoff

| navigation | bytes | what the client does |
|---|---|---|
| full document | | discards everything, reparses; scroll and state gone |
| RSC payload | | diffs into the mounted tree; client state survives |

Layouts that didn't change aren't re-rendered or re-fetched. An open dropdown, a half-filled form,
playing video — all survive. This is hard to get any other way.

The cost: **you now own routing**, and the router has a cache with its own staleness rules that will
surprise you — a user hitting "back" and seeing 30-second-old data is the *router* cache, not your
data layer. That's [nextjs-caching lab 04](../../../nextjs-caching/labs/04-router-cache/).

And the honest comparison: a plain MPA with good caching and small pages gets most of the perceived
speed with none of the router, and cross-document view transitions plus speculation rules
([resource-hints lab 04](../../../resource-hints/labs/04-priority-and-prefetch/)) close much of the
rest. **Choose the router when you genuinely need client state to survive navigation** — not by
default.

## Think about

- Why is an RSC payload not paintable, and what would it take to make it so?
- You need a date-formatting library in a component that shows a formatted date. Server or client?
- Your bundle grew 200KB after a refactor that "only moved a file". What happened?

<details>
<summary>Answers</summary>

**Not paintable.** It's a description of a tree, not markup — the browser has no idea what to do
with it until your renderer runs. Making it paintable is exactly what SSR-of-RSC does: the server
runs the payload through the renderer *and* sends HTML, so the first paint needs no JS and the
payload is used for hydration and subsequent navigations. That's what Next.js actually ships, and
it's why the framework's output is HTML + payload rather than payload alone.

**Date library.** Server, if the formatted output never changes on the client — the library never
ships, and the user gets the string. Client only if the format depends on client state (the user's
timezone with no server hint, a live "3 minutes ago" ticker). The default should be server; the
question to ask is "does this need to *re-run* in the browser?"

**+200KB from moving a file.** Something crossed the client boundary: a `"use client"` module now
imports a module that pulls in a heavy dependency, or a barrel file re-exports it. Bisect with a
bundle analyser and look at the import chain to the heavy module — the answer is always a path, and
it's always shorter than you expect.
</details>

---

## 🏗️ Build challenge: a boundary auditor

The RSC model's failure mode is invisible without tooling. Build the tooling.

`boundary-audit.mjs` — given a Next.js (or any RSC) app's source:

1. Build the module graph and mark each module **server-only**, **client**, or **shared** by
   propagating `"use client"` down the import graph. Report the ratio.
2. For every client module, report its **total transitive weight** and the **import chain that
   pulled it in**. The chain is the actionable part: "this 180KB library is in your bundle because
   `components/index.ts` re-exports it".
3. Flag `"use client"` in any file that is (a) a barrel/index, (b) imported by more than N modules,
   or (c) imports a module over K KB. These three rules catch most real regressions.
4. Flag **non-serialisable props** crossing the boundary by inspecting call sites (functions, class
   instances, `Symbol`s) — a lint rule that fails the build beats a runtime error.
5. A **budget check** in CI: fail if client bundle bytes grow by more than X% or if the
   server-only ratio drops.
6. Emit a diff for a PR: "this PR moved 3 modules across the boundary, +48KB client JS".

**Done when:** deliberately adding `"use client"` to a shared util produces a CI failure that names
the file, the weight, and the import chain — in one message a reviewer can act on.

---

## Interview questions

1. What's the difference between a Server Component and SSR?
2. How many round trips before first paint for SSR, RSC and CSR? Why does that matter more than
   payload size?
3. Which direction does the client boundary leak, and what's the practical consequence?
4. Why can't you pass a function as a prop to a client component?
5. What does an RSC navigation send, and what does that buy?
6. When would you *not* choose an RSC framework?
