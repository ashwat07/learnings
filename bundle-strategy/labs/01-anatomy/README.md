# Lab 01 — Anatomy ⭐⭐⭐⭐⭐

**Goal:** open a bundle and know what's in it, how big each part is, and — the actionable part —
*which import chain put it there*.

**Primary metric:** initial download bytes, and the largest module in it.

> ```sh
> cd bundle-strategy && npm install && node make-fixture.mjs
> node build.mjs --all
> node analyse.mjs single
> ```

---

## The three numbers

| Number | Means | Where people go wrong |
|---|---|---|
| **Total shipped** | every byte the build produced | the number people quote |
| **Initial download** | the entry plus everything it *statically* imports | the number that matters |
| **Per-module contribution** | how much each source file adds after tree shaking + minification | the number that tells you what to do |

Run `node build.mjs --all` and compare `single` (82.4 KB initial) with `split` (1.5 KB initial,
82.3 KB total). Same bytes shipped; 55× difference in what a first visit costs.

## Read your own build

```sh
node analyse.mjs single          # what's in the one-bundle build
node analyse.mjs split           # what's initial vs lazy
node analyse.mjs single --top 20
```

Fill in:

| | single | split |
|---|---|---|
| initial | | |
| total | | |
| largest module | | |
| is the chart library initial? | | |

## "Why is this here?"

The single most useful question about a bundle, and the one most visualisers answer badly:

```sh
node analyse.mjs single --why chart-data
```

```
why is src/vendor/chart-data.js in the bundle?
  src/main.js
    └─ src/routes/admin.js
      └─ src/vendor/chart.js
        └─ src/vendor/chart-data.js
```

**That chain is the fix.** Every bundle-size investigation ends here: find the big thing, find the
edge that pulled it in, and cut that edge (dynamic import, a narrower import, or deleting the
dependency).

## What a metafile is, and why you should turn it on

Every bundler can emit one:

| Bundler | How |
|---|---|
| esbuild | `metafile: true` |
| webpack | `--json > stats.json` |
| rollup | the `generateBundle` hook |
| vite | `rollup-plugin-visualizer`, or the rollup output directly |

It contains: every input, its size, its imports, and — per output file — how many bytes each input
contributed *after* tree shaking. That last part is what makes the report honest: a 200KB
dependency that tree-shakes to 4KB shouldn't be top of your list.

Commit the analysis step, not the pretty picture. A treemap is nice for a first look and useless in
CI; a script that prints "initial download grew by 18KB, because `routes/admin.js` is now
statically imported by `main.js`" is what actually prevents regressions (lab 05).

## Minified vs compressed vs parsed

Three different numbers, routinely confused:

| | What it is | What it costs the user |
|---|---|---|
| **Raw** | the built file | disk, and nothing else |
| **Minified** | after mangling/dead-code removal | this is what's parsed |
| **Compressed (br/gzip)** | what crosses the network | download time |
| **Parsed/compiled** | what the engine does with it | **main-thread CPU** — the expensive one |

A budget on compressed bytes alone hides the CPU cost: 200KB of compressed JS is maybe 700KB of
JavaScript to parse and compile, on a phone, on the main thread. That's the connection to the
hydration course — *bytes are a proxy for the thing that actually hurts.*

## Think about

- Your bundle is 400KB and 300KB of it is one dependency. What do you do first?
- Why report per-module bytes *after* tree shaking rather than the module's own size?
- When is "no bundling" (native ESM) the right answer?

<details>
<summary>Answers</summary>

**300KB dependency.** Ask `--why` first: if it's only used by one route, dynamic import solves it
in one line. If it's used everywhere, ask whether you need all of it (a narrower import path, a
lighter alternative, or the platform: `Intl` instead of a date library, `structuredClone` instead of
a deep-clone package). Replacing a dependency is a bigger change than deferring it — do the cheap
one first and measure.

**After tree shaking.** Because the on-disk size of a dependency has almost no relationship to what
it contributes. A 300KB library from which you import one pure function may add 2KB. Reporting the
package's size makes you optimise the wrong thing — and it's what most "bundle size" badges show.

**No bundling.** When you have HTTP/2+, a small module graph, and long-lived caching — then each
module is separately cacheable and a one-line change invalidates one file instead of a whole
bundle. It falls over on **depth**: `no-bundle` in this lab is 12 files, and a real app is thousands,
each one a request the browser can only discover after parsing the one before it. That waterfall is
why bundling still exists in a world with HTTP/2.
</details>

---

## 🏗️ Build challenge: your own bundle report

Point the analysis at a real project.

1. Emit a metafile/stats file from your actual build.
2. Report: initial vs total, per-module contribution after tree shaking, and duplication across
   chunks (the same module in two outputs — lab 02's cost).
3. Implement `--why <module>` over *your* graph. This is ~30 lines of BFS and it will immediately
   tell you something you didn't know.
4. Add `--diff <baseline.json>`: what grew, what shrank, what's newly initial. The last one is the
   regression that matters — a module moving from lazy to initial is invisible in a total-size
   check.
5. Classify by source: your code, direct dependencies, transitive dependencies. Most teams are
   surprised by the transitive column.

**Done when:** running it on your own app names a module you didn't know was in the initial
download, and `--why` tells you the one import to change.

---

## Interview questions

1. What's the difference between total shipped and initial download, and which do you budget?
2. How do you find out why a specific module is in your bundle?
3. Why report post-tree-shaking contribution rather than package size?
4. Name the four sizes of a bundle and which one costs main-thread CPU.
5. When is not bundling the right choice, and what breaks?
