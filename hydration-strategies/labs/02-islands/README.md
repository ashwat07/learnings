# Lab 02 — Islands ⭐⭐⭐⭐⭐

**Goal:** ship JavaScript per interactive component instead of per page, and understand the
architectural cost you're accepting in exchange.

**Primary metric:** JS bytes on the critical path, and which islands downloaded at all.

> Open <http://localhost:8080/hydration-strategies/labs/02-islands/>

---

## The concept

**Static by default, interactive by exception.** The page is server-rendered HTML; small,
independent regions ("islands") get JavaScript. Everything else gets none.

```
┌─ server-rendered HTML (no JS) ─────────────────────┐
│  heading, article, spec table, footer               │
│  ┌─ island: counter ─┐  ┌─ island: cart ─┐          │
│  │ 0.4KB, eager      │  │ 12KB, on idle  │          │
│  └───────────────────┘  └────────────────┘          │
│  … 700px of static content …                        │
│  ┌─ island: chart (90KB, only if scrolled to) ─┐    │
└─────────────────────────────────────────────────────┘
```

Each island's module is a **separate dynamic import**, so an island that never hydrates never
downloads. That turns "JS shipped" from one bundle number into a sum of per-component decisions.

## Measure it

| strategy | islands hydrated | JS bytes | chart downloaded? |
|---|---|---|---|
| all three, eagerly | 3 | | yes |
| selective (eager / idle / visible) | 1 then 2 | | not until you scroll |

Watch the Network panel: each island's module appears individually, when its trigger fires.

## The mistake worth naming

Splitting into islands and then hydrating all of them on load is **code organisation, not a loading
strategy**. You've done the work and kept the cost. The split only pays when it's paired with a
decision about *when* — which is Lab 03.

## The real cost: islands are separate roots

This is architectural, not performance, and it's what people underestimate.

Each island is its own root. Islands **cannot** share:

- a React context / Vue `provide` / Svelte context from a common parent
- a store instance created in a parent component
- hooks, or any in-memory state established above them

Anything shared must cross a boundary. Options, ascending in power and coupling:

| Approach | Notes |
|---|---|
| **DOM `CustomEvent`** | Zero dependencies. Works between islands written in *different frameworks*. Survives one island failing to load. Verbose. |
| **A shared store module** (nanostores, signals, a tiny emitter) | Ergonomic. Now they share code — **check your bundler emits one shared chunk, not one copy per island**, because it will happily do the latter. |
| **URL / server state as the source of truth** | Most robust, least fashionable. Islands read independently; no coordination needed. |

Run the **cross-island communication** demo to see option 1 working.

**If your islands need to share a lot of state, the boundary is in the wrong place.** Either merge
them into one island, or move the state to the server. A page with fifteen islands all reading one
store is a single-page app with extra steps.

## Choosing island boundaries

| Make it an island | Leave it static |
|---|---|
| It responds to input | It only displays |
| It has its own state over time | It renders once |
| It needs a browser API (media, canvas, geolocation) | — |
| It updates without a navigation | It changes only when the page does |

And two heuristics:

- **Big and rarely used → island, loaded on demand.** The chart in this lab.
- **Tiny and everywhere → consider not making it a component at all.** A `<details>` element beats
  a hydrated accordion; a `<form>` with a real `action` beats a hydrated form; a CSS-only tab set
  beats a tab island. The cheapest island is the one the platform already implements.

## How frameworks express this

| Framework | Syntax |
|---|---|
| Astro | `<Chart client:visible />`, `client:load`, `client:idle`, `client:media`, `client:only` |
| React / Next | `"use client"` + `next/dynamic({ ssr: false })` for the loading part |
| Vue | `defineAsyncComponent` + `hydrateOnVisible` (Vue 3.5+) |
| Svelte / SvelteKit | `<svelte:boundary>`, dynamic `import()` |
| Qwik | resumability instead — Lab 04 |

Astro's directives are worth studying even if you don't use Astro: they're the clearest naming of
the *when* decision anyone has shipped.

## Think about

- You have 40 islands on a page. Is that islands architecture, or an SPA with worse ergonomics?
- Which of your components are islands only because they were written in a framework?
- Where does the shared-store approach put a chunk, and how would you check?

<details>
<summary>Answers</summary>

**40 islands.** An SPA with worse ergonomics. At that density you have all the coordination problems
of a client app plus a boundary crossing at every component, and you're probably shipping the
framework runtime anyway. Either the page genuinely is an application (use one root) or most of
those islands aren't interactive and should be static.

**Islands by accident.** A very common set: an accordion (`<details>`), a form (`<form action>`), a
tab set (CSS `:target` or radio inputs), a "read more" toggle (`<details>` again), a dropdown menu
(`<select>`, or CSS), a carousel (CSS scroll-snap). Each of these is a hydrated component in
thousands of codebases and a platform feature in the spec.

**Shared store chunking.** Ideally one shared chunk imported by both island modules. Verify with a
bundle analyser or by reading the output: if `store.js`'s code appears inside *both* island bundles,
you've duplicated it — and worse, you now have two independent store instances and a state bug that
looks like a race. That's the [bundle-strategy](../../../bundle-strategy/) course, lab 02.
</details>

---

## 🏗️ Build challenge: an islands runtime worth using

Extend the 40-line runtime in `app.js` into something you'd ship:

1. **Declarative triggers** parsed from the DOM: `data-hydrate="load|idle|visible|media(min-width:
   768px)|interaction"`. One attribute, no imperative wiring — that's what makes it adoptable.
2. **Event replay** for `interaction`: capture the triggering event, hydrate, then re-dispatch it so
   the user's first click isn't lost. Handle the ordering trap: `pointerdown` → hydrate → the
   original `click` still needs to land on the now-live handler.
3. **Props from the server** via `data-props`, with a size warning: if serialised props exceed N
   bytes, you're shipping data twice (once as HTML, once as JSON). This is a real and common waste.
4. **Nested islands**: a static server-rendered region *inside* an island (slot/children), which must
   not be re-rendered when the island hydrates. Getting this right is what lets you keep big static
   subtrees inside interactive containers.
5. **Error isolation**: one island failing to load or throwing must not break the others or the
   static page. Report it, leave the static HTML intact.
6. **A budget report**: per island — module bytes, hydration ms, trigger, and whether it ever
   hydrated in a real session. Ship it as a dev overlay. **The islands that never hydrate are the
   most valuable finding**, because they're pure deletion.

**Done when:** a page with ten islands ships only the two above-the-fold ones on load, a click on an
`interaction` island works first time, and your report names an island nobody ever triggered.

---

## Interview questions

1. What is an islands architecture, and what does "static by default" mean in practice?
2. Why doesn't splitting your bundle into islands help if you hydrate them all on load?
3. Two islands need to share state. What are your options, and what does each cost?
4. How do you decide whether a component should be an island?
5. Name four "components" that should be platform features instead.
6. When is islands the wrong architecture?
