# Lab 07 — JavaScript blocking rendering ⭐⭐⭐⭐

**Goal:** know exactly when the HTML parser stops, when rendering stops, and what `defer`, `async`,
`type="module"`, and script position each actually change.

**Primary metric:** First Contentful Paint, and the gap between `domContentLoaded` and FCP.

> **Needs a server.** Run `./serve.sh` from the course root, then open
> <http://localhost:8080/labs/07-render-blocking-js/>.

---

## The concept

A classic `<script src>` in `<head>` does three blocking things:

1. **Blocks the parser** at that point. No further DOM is built until the script has been
   downloaded *and* executed. Why? Because the script could call `document.write()`, so the parser
   can't safely continue.
2. **Delays rendering** of everything after it, because there's no DOM to render yet.
3. **Waits for pending stylesheets** before executing, in case it reads computed styles. So a slow
   CSS file can delay a script, which delays the parser. Chains.

The preload scanner mitigates #1 for *downloads* — it races ahead in the raw HTML and starts
fetching resources it can see. But it can't execute anything out of order, so **parsing still
pauses for execution**. A script that's fast to download and slow to *run* gets no help from the
preload scanner at all. That's the case most people misunderstand.

| Attribute | Downloads | Blocks parser during download | Executes | Order guaranteed |
|---|---|---|---|---|
| (none), in `<head>` | immediately | **yes** | immediately when fetched | yes |
| (none), before `</body>` | immediately | yes, but DOM is already built | immediately | yes |
| `defer` | in parallel | no | after parsing, before `DOMContentLoaded` | yes, in document order |
| `async` | in parallel | no | **as soon as it arrives** — can interrupt parsing | **no** |
| `type="module"` | in parallel | no | like `defer` | yes |
| `type="module" async` | in parallel | no | like `async` | no |

`async` is the subtle one. It doesn't block the parser *waiting*, but when the file lands, it
executes immediately — potentially mid-parse, potentially before the DOM it needs exists, and in
whatever order the network happens to deliver. Use it only for genuinely independent scripts.

## Break it

Five pages, same content, same total script work:

| Page | What it does |
|---|---|
| [01-sync-head.html](01-sync-head.html) | 800ms of synchronous work in `<head>`. Page is blank the whole time. |
| [02-sync-body-end.html](02-sync-body-end.html) | Same script, before `</body>`. |
| [03-defer.html](03-defer.html) | `defer`. |
| [04-async.html](04-async.html) | `async` — plus a second script that depends on the first, so you can watch the race break. |
| [05-your-fix.html](05-your-fix.html) | **Yours to build.** |

Open 01. Count the seconds of white screen. Then open 02 and notice the content appears *before*
the freeze.

## Measure it

For each page, in a fresh incognito tab with **Network: Fast 3G** and **CPU 4×**:

1. Performance panel → reload-and-record (⌘E while the panel is focused, or the reload icon).
2. Read off the Timings track: **FP**, **FCP**, **LCP**, **DCL**, **L**.
3. In the Main track, find the `Parse HTML` entry. Where does it stop? What's between the two
   halves of it?
4. Network panel: note the order in which scripts finish, and the order in which they execute
   (the pages log it).
5. Each page prints its own metrics via `PerformanceObserver` — the numbers appear on the page and
   in the console.

| Page | FCP | LCP | DCL | Parser paused for | Execution order |
|---|---|---|---|---|---|
| 01 sync head | | | | | |
| 02 sync body end | | | | | |
| 03 defer | | | | | |
| 04 async | | | | | |
| 05 your fix | | | | | |

Also do this experiment, which is the one that teaches the most:

- In 01, the script is slow to **execute** (a busy loop). `scripts/slow-download.js` is the
  slow-to-**download** variant — comment out one script tag, uncomment the other, and throttle the
  network. The preload scanner helps one case and not the other. Predict which, then verify.
- Also in 01, uncomment the `slow.css` link that sits above the script, and watch script execution
  wait for a stylesheet it never asked for.

## Why is it slow?

Answer these:

1. In page 01, what exactly is the browser doing during the white screen — and what is it *not*
   doing? Be specific about which stages of the pipeline never ran.
2. Page 02 shows content first, then freezes. Is that better? For which metric, and for which
   user? (Careful: FCP improved, but what about the user who tries to *click* during the freeze?
   Name the metric that captures that.)
3. In page 04, why does the dependent script sometimes work and sometimes throw?
4. Why can a slow *stylesheet* delay a script's execution?

## Fix it yourself

Build **05-your-fix.html**. Same features, same work, but:

- [ ] FCP under 1s on Fast 3G + 4× CPU.
- [ ] No long task over 50ms after FCP. The 800ms of work must be **chunked** — split it into
      slices that yield to the event loop between them (`await scheduler.yield()` where available,
      else `setTimeout(0)` / `MessageChannel`), or moved to a **Web Worker**. Do both variants and
      compare: which one actually keeps the page responsive, and which just spreads the pain?
- [ ] Correct dependency ordering with no `async` races. Prove it with the execution log.
- [ ] The page is interactive (a button that responds, a working input) *while* the heavy work is
      still running. Add a visible "click me" counter and try clicking it during load in each
      version — this is the difference between a metric and a user experience.
- [ ] Add `<link rel="preload">` for one resource and demonstrate, with a trace, that it changed
      something. Then remove it and explain when preload makes things *worse*.

<details>
<summary>Hint — chunking that actually yields</summary>

```js
async function chunked(work, sliceMs = 5) {
  let i = 0;
  while (i < work.length) {
    const start = performance.now();
    while (i < work.length && performance.now() - start < sliceMs) work[i++]();
    await yieldToMain();
  }
}
const yieldToMain = () =>
  globalThis.scheduler?.yield?.() ?? new Promise(r => setTimeout(r, 0));
```

`setTimeout(0)` has ~4ms clamping after nesting, and it puts your continuation *behind* other
tasks. `scheduler.yield()` puts it in front of other same-priority tasks while still letting input
through — better for a work loop you want to finish quickly. Measure both.
</details>

<details>
<summary>Hint — when a worker is the wrong answer</summary>

Workers can't touch the DOM, and structured-cloning a large result across the boundary has real
cost. If the heavy work *is* DOM work, a worker doesn't help — chunk instead. Workers win for pure
computation: parsing, sorting, diffing, crypto, image processing.
</details>

---

## 🏗️ Build challenge: a startup-cost budget harness

The lesson of this lab is easy to learn and impossible to keep. Six months later someone adds
a synchronous analytics snippet to `<head>` and nobody notices for a quarter. So build the thing
that notices.

**Build a small tool** (a script you can drop in any page, plus a CLI mode) that:

1. Loads a page and reports FP, FCP, LCP, DCL, TBT, and every long task with attribution.
2. Lists every script the page loads, with: transfer size, download time, **execute** time,
   whether it was parser-blocking, and which attribute it used. Get execute time from
   `PerformanceResourceTiming` plus `longtask` attribution, or from a trace.
3. Flags: any parser-blocking script in `<head>`; any script whose execute time exceeds a
   threshold; any `async` script that another script depends on (heuristic: an `async` script that
   defines a global another script reads — you'll have to be creative here, and it's fine to
   detect it dynamically by proxying `globalThis`).
4. Enforces a **budget file**:
   ```json
   { "fcp": 1000, "lcp": 2500, "tbt": 200, "scripts": { "count": 10, "totalKb": 250 } }
   ```
   Exit non-zero when a budget is exceeded. Print a diff against the previous run.
5. Runs headless (Puppeteer or Playwright) against all five lab pages and produces a comparison
   table — that gives you a self-verifying test suite for this entire lab.

**Then wire it up for real:** run it in a git pre-push hook or a CI job against your own portfolio
site or any project you own. Get it to fail on purpose by adding a sync script to `<head>`, and
watch it catch you.

**Done when:** the harness produces the measurement table from this lab automatically, and you've
seen it fail a build for a regression you introduced deliberately.

---

## Interview questions

1. Walk me through everything that happens when the parser hits `<script src="a.js">` in `<head>`.
2. What's the difference between `defer` and `async`, and when would you genuinely want `async`?
3. Does the preload scanner make a parser-blocking script harmless? Explain.
4. Why can a slow stylesheet delay script execution?
5. Your FCP is 400ms and users still complain the page is unresponsive on load. What metric are you
   missing, and what's the likely cause?
6. `type="module"` — what are its loading semantics, and does adding `defer` to it do anything?
