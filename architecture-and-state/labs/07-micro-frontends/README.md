# Lab 07 — Micro-frontends ⭐⭐⭐⭐

**Goal:** be able to argue *for* and *against* competently — and recognise that the honest answer is
usually "no".

**Primary metric:** the org problem you're solving, and whether a cheaper thing solves it.

---

## What it actually is

Independently built and deployed frontend pieces, composed at runtime into one page. Module
federation (webpack/rspack), import maps, or plain iframes.

**It is an organisational solution to an organisational problem.** If your problem is technical,
this is the wrong tool.

## The honest ledger

| Buys you | Costs you |
|---|---|
| Independent deploys per team | Shared dependency management becomes a permanent job |
| Independent tech choices | Two React copies, two routers, two design-system versions in one page |
| Team autonomy at scale (dozens of teams) | Integration bugs that no single team can reproduce |
| Incremental migration of a legacy app | Bundle size: shared deps duplicated, or a fragile singleton contract |
| Failure isolation, done well | Performance: more requests, more runtime, a deeper waterfall |
| | Debugging across boundaries; source maps across origins |
| | A whole new class of version-skew bug |

**The version-skew bug** is the one to internalise: team A deploys a remote that expects host
contract v2 while the host is still v1, and the failure appears in production, in one composition,
for some users. Contract testing between remotes and hosts is not optional — and most teams
discover this after the first outage.

## When it's genuinely right

- **Many teams (roughly 5+) with separate release cadences**, blocked on each other's releases.
- **Incremental migration**: strangling a legacy app route by route, with the old and new coexisting.
- **Genuinely independent products** sharing a shell (a console with unrelated tools).
- **Different organisations** contributing to one surface (a marketplace of plugins).

## When it isn't (which is most of the time)

- One team. (A monolith with good internal boundaries — lab 01 — gives you the same clarity, none of
  the runtime cost.)
- "Our build is slow." Fix the build. Turborepo/nx with remote caching solves this at a fraction of
  the cost.
- "Teams step on each other." Try feature folders, ownership boundaries (CODEOWNERS), and trunk-based
  development first.
- "We want to try Vue in part of the app." That's a much larger bill than it looks: two frameworks in
  one page means two runtimes, two state models, and a bridge between them.
- **The performance-sensitive path.** Micro-frontends add runtime cost exactly where you can least
  afford it.

## The cheaper alternatives, in order

1. **A monorepo with clear boundaries** and enforced import rules (lab 01). Independent *packages*,
   one deploy.
2. **Build-time composition** — the same independence, resolved at build. You lose independent
   deploys and keep almost everything else.
3. **Server-side composition** (ESI, edge includes, RSC islands) — the shell composes; the client
   gets one document.
4. **Iframes**, honestly. Perfect isolation, terrible UX for anything that needs to be part of the
   page — but for a genuinely separate tool it can be right, and it's a hundredth of the complexity.
5. **Module federation.** The full version, with the full bill.

## If you do it, the non-negotiables

- **A written contract** between host and remote: the props, the events, the shared singletons, and
  the versioning policy. Contract-tested in CI, on both sides.
- **A shared-dependency policy**: which packages are singletons (React, the router, the design
  system), what version range, and what happens on mismatch. Decide whether a mismatch is a hard
  error or a fallback to a second copy — and know what each costs.
- **Error isolation**: a remote failing to load must degrade one region, not the page
  ([the boundaries route](../../../react-sandbox/src/routes/boundaries.jsx) in the sandbox).
- **A performance budget per remote**, enforced in that remote's CI. Otherwise every team ships
  their own copy of a chart library into your page.
- **One observability story**: correlated errors and traces across remotes, or nobody can debug
  anything.
- **A rollback story that doesn't require coordinating deploys** — which is the thing you bought.

## Think about

- Your build takes 20 minutes and teams are blocked. Micro-frontends?
- Two remotes ship different React versions. What happens?
- How do you test a composition that only exists in production?

<details>
<summary>Answers</summary>

**20-minute build.** No. Fix the build: caching, incremental compilation, a monorepo task runner with
remote caching, and splitting CI by affected package. Micro-frontends would fix the *symptom* by
adding a runtime integration problem, a contract-testing burden and a performance cost — an
enormous price for a build-time issue that has cheap build-time solutions.

**Two React versions.** Best case, your federation config declares React a singleton and one version
wins — and the remote built against the other one hits subtle bugs (hooks in two copies of React,
context not crossing, `instanceof` failing). Worst case, both load: double the bytes, two reconcilers,
and portals/context/event delegation breaking in ways that look like haunted code. This is the
single most common micro-frontend failure and the reason the shared-dependency policy has to be
written down before the first remote ships.

**Testing the composition.** You need an integration environment that assembles the *current
production* versions of every remote plus the change under test, with smoke tests over the critical
journeys — plus consumer-driven contract tests so a remote can't break the host unnoticed. If you
can't afford that environment, you can't afford micro-frontends; that cost is the price of
independent deploys.
</details>

---

## 🏗️ Build challenge: build one, then argue against it

1. Build a **host + two remotes** with module federation (or import maps): a shell, a "catalogue"
   remote, a "cart" remote. Share React as a singleton.
2. **Break it on purpose**: ship a remote with a mismatched React version; ship one that 500s; ship
   one that changes its prop contract. Record what the user sees in each case.
3. **Fix each**: singleton enforcement with a clear error, an error boundary per remote with a
   degraded region, and a contract test that fails the remote's CI.
4. **Measure the cost**: total bytes and TTI for the composed page vs the same app built as one
   bundle. Include the duplicated dependencies.
5. **Write the decision record**: the org problem, the alternatives you rejected and why, the
   measured cost, and the conditions under which you'd reverse the decision.

**Done when:** you have both the working composition and a written, numbers-backed argument for why
a monorepo would have been better — and you know which one you'd actually choose.

---

## Interview questions

1. What problem do micro-frontends solve, and what kind of problem is it?
2. Name four costs, and which one causes the worst bugs.
3. Two remotes need different versions of a shared library. What are your options?
4. What are the cheaper alternatives, and when does each stop working?
5. Your team of six wants micro-frontends. What do you ask them?
