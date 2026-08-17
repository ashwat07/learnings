# Hydration strategies ⭐⭐⭐⭐⭐

Server rendering gets pixels on screen. **Hydration** is what happens next: the client framework
downloads, re-creates the component tree in memory, walks the DOM your server already produced, and
attaches behaviour to it. That walk is the single largest source of Total Blocking Time in most
server-rendered apps, and it buys you nothing visible — the page already looked finished.

```sh
./serve.sh    # then http://localhost:8080/hydration-strategies/labs/01-hydration-cost/
```

---

## The problem, stated precisely

```
       FCP                              TTI / "interactive"
        │                                        │
────────●────────────────────────────────────────●──────────►
        │◄──────── the uncanny valley ──────────►│
        │                                        │
   looks ready                            actually ready
   (server HTML)                    (framework has hydrated)
```

In that gap the page is a photograph. Buttons look pressable and aren't. Taps are either dropped or
queued to fire all at once when hydration finishes. Users describe this as "it froze" or "it
double-submitted", and neither FCP nor LCP shows it — **TBT and INP do**.

Hydration cost scales with **how many components you hydrate**, not with how much of the page
changed. That's the insight every modern approach attacks from a different angle:

| Approach | Idea | What it costs |
|---|---|---|
| **Full hydration** | hydrate the whole tree on load | TBT proportional to component count |
| **Partial / islands** | only interactive bits hydrate; the rest ship no JS | you must identify the islands |
| **Progressive / lazy** | hydrate on idle, on visible, or on interaction | first interaction may pay the cost |
| **Server components** | non-interactive components never exist on the client | a framework that supports it |
| **Resumability** | serialise the state; never re-execute the tree | serialised state in the HTML; a different mental model |
| **No JS** | forms and links do the work | you write actual HTML |

The sandbox has a 60-line islands implementation
([`shared/app/islands.js`](../shared/app/islands.js)) with per-island strategies, plus a
`?hydrationCost=N` knob that adds N ms of synthetic work per island. That lets you measure what a
real framework's per-component cost does to a page without needing a real framework — and the
numbers transfer, because the shape is the same.

Knobs, on any sandbox page:

```
/render/ssr-par/?repeat=10                  120 islands
&hydrationCost=3                            3ms of work per island
&hydrate=load|idle|visible|interaction      strategy for every island at once
```

## Curriculum

| # | Lab | Question it answers | ⭐ |
|---|---|---|---|
| 01 | [The cost of hydration](labs/01-hydration-cost/) | What does hydration actually cost, and where does it show up? | ⭐⭐⭐⭐⭐ |
| 02 | [Islands](labs/02-islands/) | How do I ship JS only for the interactive parts? | ⭐⭐⭐⭐⭐ |
| 03 | [Lazy & progressive](labs/03-lazy-and-progressive/) | Hydrate on idle, on visible, or on touch? | ⭐⭐⭐⭐ |
| 04 | [Resumability](labs/04-resumability/) | Can we skip re-execution entirely? | ⭐⭐⭐⭐ |
| 05 | [Hydration mismatches](labs/05-mismatches/) | Why does my server HTML disagree with my client render? | ⭐⭐⭐⭐⭐ |

Prerequisite: [rendering-strategies](../rendering-strategies/) lab 01 — hydration only exists
because something server-rendered the HTML first.

## Measure it honestly

- **CPU throttle 4×, always.** Hydration is pure main-thread CPU; on an unthrottled laptop every
  strategy looks identical, which is exactly why the wrong one ships.
- **The metrics that show hydration**: TBT, long tasks, INP, and the FCP→TTI gap. Not FCP, not LCP.
- **Try to click during the gap.** The most convincing measurement in this whole course is tapping a
  button that does nothing.
