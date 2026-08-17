# Architecture & state ⭐⭐⭐⭐⭐

The decisions in this course are the ones you cannot refactor your way out of cheaply: where a
component's boundaries are, where a piece of state lives, and who owns the data. Everything else in
the repo is about making a page fast; this is about making a codebase survivable.

```sh
./serve.sh                 # the lab server (data source), from the repo root
cd react-sandbox && npm install && npm run dev      # http://localhost:5173
```

The React sandbox is shared with [react-render-perf](../web-vitals-and-react-perf/labs/05-react-render-perf/) and
[quality-and-delivery](../quality-and-delivery/) — one install, three courses. It ships a live
**render tally** so "did that click re-render the list?" is a number on the screen rather than an
impression.

---

## The one idea

> **State has a shape, and the shape tells you where it lives.**

| Kind of state | Example | Where it belongs | Wrong home costs you |
|---|---|---|---|
| **Local UI** | an input's value, a dropdown's open flag | `useState` in the component | a global store full of `isModalOpen` |
| **URL** | filters, tab, page number, sort | the URL | unshareable links, a broken back button |
| **Server cache** | products, the current user, anything from an API | a query cache (TanStack Query, RTK Query, or the 60 lines in the sandbox) | manual loading flags, stale data, N duplicate requests |
| **Global UI** | theme, sidebar, feature flags | a small store with selectors | Context re-rendering the world |
| **Form** | draft values, validation, dirty | a form library or local state | a store that resets on navigation |
| **Machine** | checkout, upload, wizard | an explicit state machine | five booleans and 32 impossible states |

Nearly every state-management argument is really an argument about **which row someone is in**.
"Redux vs Zustand" matters far less than "this is server cache and you put it in a global store".

## Curriculum

| # | Lab | Question it answers | ⭐ |
|---|---|---|---|
| 01 | [Component architecture](labs/01-component-architecture/) | Where do the boundaries go, and how do folders scale? | ⭐⭐⭐⭐⭐ |
| 02 | [State strategy](labs/02-state-strategy/) | Which of the six kinds is this, and where does it live? | ⭐⭐⭐⭐⭐ |
| 03 | [Data fetching & BFF](labs/03-data-fetching-and-bff/) | Killing the client-side N+1 and the waterfall | ⭐⭐⭐⭐⭐ |
| 04 | [Consistency & sync](labs/04-consistency-and-sync/) | Optimistic UI, rollback, conflicts | ⭐⭐⭐⭐⭐ |
| 05 | [State machines](labs/05-state-machines/) | Making illegal states unrepresentable | ⭐⭐⭐⭐ |
| 06 | [Design system](labs/06-design-system/) | Tokens, theming, and component APIs that survive | ⭐⭐⭐⭐ |
| 07 | [Micro-frontends](labs/07-micro-frontends/) | When to argue *against* it | ⭐⭐⭐⭐ |

## Related, already built

- Server-side data waterfalls and request memoisation: [rendering-strategies lab 02](../rendering-strategies/labs/02-server-waterfalls/)
- The offline write queue this course's lab 04 references: [browser-storage lab 06](../browser-storage/labs/06-offline-data-layer/)
- The framework caches behind server state: [nextjs-caching](../nextjs-caching/)
- Bundle consequences of a shared design system: [bundle-strategy lab 03](../bundle-strategy/labs/03-tree-shaking/)
