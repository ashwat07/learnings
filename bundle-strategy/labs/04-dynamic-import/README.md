# Lab 04 — Dynamic import ⭐⭐⭐⭐

**Goal:** defer code without making the interaction that needs it feel slow.

**Primary metric:** initial load bytes, and the latency of the first navigation to a lazy route.

> Build first: `cd bundle-strategy && node build.mjs --all`
> Then <http://localhost:8080/bundle-strategy/labs/04-dynamic-import/>

---

## The trade, measured

Load the `single` build, navigate to admin: instant — everyone already downloaded the 80KB chart
library, including the majority who never open admin.

Load the `split` build, navigate to admin with a 1000ms network delay: **the click hangs for a
second.** You moved the cost from everyone-at-load-time to this-user-right-now, and right-now is
when they're watching.

| | initial | first admin visit |
|---|---|---|
| single | | instant |
| split | | |
| split + prefetch | | |

That third row is the point of the lab.

## Prefetching on intent

```js
// on pointerover / focus / pointerdown of a link to the route
const link = document.createElement('link');
link.rel = 'modulepreload';
link.href = chunkUrlFromManifest('admin');
document.head.append(link);
```

**Use `modulepreload`, not a bare `import()`.** `modulepreload` fetches *and parses* the module and
its dependency graph **without executing it** — exactly the semantics speculation needs. A bare
`import()` executes the module, with whatever side effects that has (a store initialising, analytics
registering, a `customElements.define` that now can't be undone).

Triggers, in increasing order of how much you're guessing:

| Trigger | Buys | Wastes |
|---|---|---|
| `pointerover` / `focus` on the link | 100–300ms | rarely — hover strongly predicts click |
| `pointerdown` | ~80ms, works on touch | almost never |
| `requestIdleCallback` after load | everything, for the 1–2 most likely routes | bytes if the user leaves |
| Link enters the viewport | a lot on long pages | more — visible ≠ intended |

Same family as speculative `preconnect` ([resource-hints lab 02](../../../resource-hints/labs/02-preconnect/))
and interaction-triggered hydration ([hydration lab 03](../../../hydration-strategies/labs/03-lazy-and-progressive/)).
Three different resources, one idea: **start the work when intent appears, not when the action
happens.**

## What to defer

| Defer | Don't defer |
|---|---|
| Routes the user hasn't navigated to | the current route |
| Heavy components behind an interaction (editor, chart, map, video player) | anything above the fold |
| Rarely-used features (export, admin, settings) | the router itself |
| Polyfills, behind a feature check | anything needed to render the first screen |
| Locale data beyond the current locale | |

**Deferring something needed immediately just adds a round trip.** The test: would the user notice
the delay? If the code runs during initial render, they will.

## The three failure modes

**1. A waterfall of dynamic imports.** `import()` inside a module that was itself dynamically
imported is a second round trip *after* the first. Three levels deep is 3 RTT before anything runs.
Flatten with `modulepreload`, or merge the chunks.

**2. No loading state.** A dynamic import is a network request that can be slow or fail. Every
`import()` in a UI path needs a pending state and an error path — including a retry, because a
chunk 404 after a deploy is a real and common failure ([http-caching lab
04](../../../http-caching/labs/04-immutable-and-fingerprinting/): keep old chunks around).

**3. Unanalysable specifiers.** `import('./routes/' + name + '.js')` — a bundler cannot know what to
emit. Some (vite, webpack) handle limited patterns by emitting *every* match, which is worse than
you think. Use a static map:

```js
const routes = {
  home: () => import('./routes/home.js'),
  admin: () => import('./routes/admin.js'),
};
```

Every specifier is a literal, so the bundler emits exactly these chunks and nothing else.

## Think about

- You lazily load a modal's code. The user clicks and waits 800ms. What do you change?
- Why `modulepreload` rather than calling `import()` early?
- Which is worse: a 100KB bigger bundle, or a 400ms delay on one click?

<details>
<summary>Answers</summary>

**800ms modal.** Prefetch on intent (hover/pointerdown of the button that opens it) — usually
enough on its own. Then check the chunk's size: 800ms suggests it's dragging in something it
shouldn't (`--why`). And show an immediate pending state so the click is acknowledged even when the
network is slow.

**`modulepreload` vs early `import()`.** `import()` *executes* the module. If it registers globals,
starts a subscription, or defines a custom element, you've done that speculatively — for a route the
user may never visit. `modulepreload` warms the cache and stops.

**100KB vs 400ms.** Depends on who pays. The 100KB is paid by *everyone*, on the critical path,
including users who never use the feature. The 400ms is paid *only* by users who use it, and it can
be hidden entirely with intent-based prefetching. So: defer, and prefetch. The answer changes if the
feature is used by 90% of sessions — then it isn't really a lazy feature.
</details>

---

## 🏗️ Build challenge: an intent-driven chunk loader

```js
prefetchOnIntent({
  selector: 'a[data-route]',
  resolve: (el) => manifest[el.dataset.route],
  budgetKB: 500,
});
```

Requirements:

1. Read the chunk URL from your **build manifest** (esbuild's metafile, webpack's stats, vite's
   manifest.json) rather than hardcoding — chunk names are hashed and change every build.
2. Trigger on `pointerover`/`focusin`/`pointerdown`, once per chunk, with a concurrency cap.
3. Respect `navigator.connection.saveData` and `effectiveType` — never speculate on 2G.
4. **Measure the hit rate**: prefetched-and-used vs prefetched-and-wasted. Report it. A speculation
   layer with a 5% hit rate is a bandwidth tax, and you cannot know which you have without the
   number.
5. Handle **chunk load failure**: retry once, then reload the page (a hashed chunk that 404s means
   the deploy moved underneath the user).
6. Compare, at 4G: cold click latency with and without prefetching, and bytes wasted per session.

**Done when:** the first click on a lazy route is under 100ms on a throttled connection, and you can
state your prefetch hit rate.

---

## Interview questions

1. What does `import()` create, and what does it cost the first user?
2. `modulepreload` vs calling `import()` early — what's the difference?
3. When should you not defer something?
4. What's wrong with `import('./routes/' + name + '.js')`?
5. A lazily-loaded chunk 404s in production. How did that happen and what's the fix?
6. Where would you trigger prefetching, and how would you know it was worth it?
