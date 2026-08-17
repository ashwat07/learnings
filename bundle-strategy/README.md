# Bundle strategy: splitting, tree-shaking, dynamic import ⭐⭐⭐⭐

Bundling is four decisions — **what to combine, what to split, what to remove, and what to defer** —
and each one is measurable. This course measures them, on a real app, with a real bundler, and the
numbers are produced on your machine rather than quoted.

```sh
cd bundle-strategy
npm install          # esbuild only: one binary, ~10MB
node make-fixture.mjs        # generates the bulky data modules (gitignored)
node build.mjs --all         # build every variant and compare
node analyse.mjs split       # per-module report
```

The one dependency is **esbuild** — no config file, and fast enough that you can change something
and re-read the numbers immediately. Everything here (splitting, tree shaking, side effects,
metafiles) exists in webpack, rollup and vite too; the flags differ, the concepts don't.

---

## The fixture

A small app with the shapes that matter:

```
src/main.js              the entry; loads routes statically or dynamically
src/routes/home.js       imports through the barrel
src/routes/product.js    imports directly
src/routes/admin.js      the only user of the chart library — and almost nobody visits it
src/lib/index.js         a BARREL that re-exports everything
src/lib/format.js        pure, tree-shakeable, with two never-used exports
src/lib/dates.js         pure, but pulls in ~30KB of locale data
src/lib/analytics.js     has a SIDE EFFECT at import time — the tree-shaking villain
src/vendor/chart.js      ~90KB, used by one route
```

## The numbers this produces

From `node build.mjs --all` on the default fixture:

| variant | initial | total | files |
|---|---|---|---|
| `single` (one bundle) | 82.4 KB | 82.4 KB | 1 |
| `split` (route chunks) | **1.5 KB** | 82.3 KB | 3 |
| `no-split` (all static) | 82.1 KB | 82.1 KB | 1 |
| `no-treeshake` | 109.5 KB | 109.5 KB | 1 |
| `no-bundle` (native ESM) | — | 125.5 KB | 12 |

**Initial vs total is the distinction the whole course rests on.** `split` ships the same bytes
overall and 55× less on first load, because the 80KB chart chunk is only fetched by people who
visit the admin route.

## Curriculum

| # | Lab | Question it answers | ⭐ |
|---|---|---|---|
| 01 | [Anatomy](labs/01-anatomy/) | What's actually in my bundle, and why is *that* in there? | ⭐⭐⭐⭐⭐ |
| 02 | [Splitting](labs/02-splitting/) | Where do the chunk boundaries go, and what does splitting cost? | ⭐⭐⭐⭐⭐ |
| 03 | [Tree shaking](labs/03-tree-shaking/) | Why is dead code still in my bundle? | ⭐⭐⭐⭐⭐ |
| 04 | [Dynamic import](labs/04-dynamic-import/) | Defer without making the click slow | ⭐⭐⭐⭐ |
| 05 | [Analyse & budget](labs/05-analyse-and-budget/) | Keep it from growing back | ⭐⭐⭐⭐⭐ |

Related: [asset-optimization lab 06](../asset-optimization/labs/06-budgets/) for byte budgets,
[hydration-strategies](../hydration-strategies/) for what happens *after* the JS arrives — bundle
size and hydration cost are different problems and splitting only fixes one of them.

## The two questions to ask of any bundle

1. **What is in the initial download that the first screen doesn't need?**
2. **For each large module: what import chain put it there?**

`node analyse.mjs <variant> --why <module>` answers the second one directly:

```
why is src/vendor/chart-data.js in the bundle?
  src/main.js
    └─ src/routes/admin.js
      └─ src/vendor/chart.js
        └─ src/vendor/chart-data.js
```

That chain is the fix. Everything else in this course is detail.
