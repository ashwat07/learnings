# Lab 03 — Tree shaking ⭐⭐⭐⭐⭐

**Goal:** know exactly why dead code survives, and which of the five causes applies to your bundle.

**Primary metric:** bytes removed, and which unused modules are still present.

> ```sh
> node build.mjs --all
> node analyse.mjs no-treeshake --top 15
> node analyse.mjs single --top 15
> ```

---

## What it does, and what it needs

Tree shaking is dead-code elimination over the **module graph**: if nothing imports an export, and
removing the module has no observable effect, it goes.

It requires:

1. **ES modules.** `import`/`export` are statically analysable; CommonJS `require()` is a function
   call that could do anything. A dependency shipping only CJS cannot be shaken — this is still the
   most common cause in real projects.
2. **No side effects**, or a promise that there are none.
3. **Static analysability.** `import('./' + name)` defeats it.

| variant | initial | note |
|---|---|---|
| `no-treeshake` | 109.5 KB | everything the graph touches |
| `single` | 82.4 KB | ~27KB removed |

## The five reasons dead code survives

### 1. Side effects at import time

```js
// lib/analytics.js — this runs on import
window.addEventListener('load', () => queue.push(…));
export function track() { … }
```

The bundler **cannot** remove this module even if `track` is never called, because evaluating it
does something observable. Look at `src/lib/analytics.js` in the fixture and confirm it's in the
bundle.

The fix is a promise you make in `package.json`:

```json
{ "sideEffects": false }
{ "sideEffects": ["*.css", "./src/polyfills.js"] }
```

That tells the bundler "importing my modules does nothing observable, so drop the unused ones". It
is a **promise**, and if it's wrong you get a subtle production bug where a polyfill or a CSS import
silently disappears. Mark the files that *do* have side effects rather than blanket-declaring
`false`.

### 2. Barrel files

```js
// lib/index.js
export * from './format.js';
export * from './dates.js';
export * from './analytics.js';   // ← side effects, so importing ANYTHING from the barrel keeps it
```

`import { formatPrice } from '../lib/index.js'` pulls the whole barrel into the graph. A good
bundler shakes the pure modules back out — but **anything with side effects stays**, and so does
anything the bundler can't prove is pure.

Compare `barrel` with `single` in the build output. The gap is small in this fixture (the modules
are pure); in a real app where the barrel re-exports 40 modules including a couple with side
effects, it is not.

Barrels also cost build time and can create import cycles. Import from the specific module.

### 3. CommonJS in the graph

A dependency published as CJS, or an ESM build that a bundler falls back from, is opaque. Check your
dependencies' `package.json` `"module"`/`"exports"` fields. This is why "ESM-only" packages are worth
preferring, and why bundling a legacy dependency can add 100KB for one function.

### 4. Dynamic property access

```js
import * as icons from './icons.js';
const Icon = icons[name];     // the bundler must keep every icon
```

Anything reached by a computed key must all be kept. This is the icon-library problem: 900 icons in
your bundle because the component takes a `name` prop. Fix: a static map of the icons you use, or
per-icon imports generated at build time.

### 5. Class methods and prototypes

Tree shaking works at the **module export** level, not inside a class. An unused method on a class
you *do* use is kept. Prefer standalone functions if size matters — this is exactly why modern
libraries ship `import { debounce } from 'lodash-es'` rather than a `_` object.

## The check that matters

```sh
node analyse.mjs single --top 20
```

Look for modules you don't think you use. Then `--why` each one. In the fixture:

- `format.js` is present, but `formatEverything` (a large unused export) should be gone.
- `analytics.js` is present *and cannot be removed* — a side effect keeps it.
- `chart-data.js` should be in the lazy chunk only.

## Think about

- Your bundle contains a date library you only use in one component. Two fixes — which first?
- `"sideEffects": false` shrank the bundle by 60KB and broke the app. What happened?
- Why doesn't tree shaking remove an unused class method?

<details>
<summary>Answers</summary>

**Date library in one component.** First: dynamic-import that component (one line, immediate, no
risk). Then: check whether you need the library at all — `Intl.DateTimeFormat` and
`Intl.RelativeTimeFormat` cover most of what people import a date library for, at zero bytes.
Replacing the dependency is the bigger win and the bigger change; do them in that order.

**`sideEffects: false` broke it.** The promise was false: something in your code *did* rely on a
module being evaluated — a CSS import, a polyfill, a global registration, a `customElements.define`,
a store's module-level initialisation. The bundler removed it because nothing imported a *binding*
from it. Fix by listing the genuinely effectful files rather than reverting the whole flag.

**Class methods.** Tree shaking operates on module-level bindings; a class is one binding. Once the
class is kept, its whole body is kept — the bundler can't prove a method is unreachable, because it
could be called dynamically (`obj[name]()`) or by a subclass. This is why utility *modules* shake
better than utility *classes*.
</details>

---

## 🏗️ Build challenge: a shake audit

1. Add `"sideEffects"` to the fixture's `package.json` and measure the difference. Then deliberately
   break it (mark an effectful module as pure) and observe the bug.
2. Write a script that reports, for every module in the bundle, **which of its exports are actually
   used** anywhere in the graph. Modules with 1 used export out of 20 are your list.
3. Detect CJS dependencies in your real project's graph and estimate what they cost — a dependency
   that can't be shaken should be visible in the report as an unshakeable block.
4. Find dynamic property access into namespace imports (`import * as x` followed by `x[expr]`) with
   a small AST pass. This is the icon problem and it's mechanically detectable.
5. Report a "shake efficiency" per dependency: bytes on disk vs bytes in the bundle. Anything near
   100% is either fully used or not being shaken at all — and the second is much more common.

**Done when:** your report names one dependency in a real project that isn't being shaken, with the
reason, and you can state the fix.

---

## Interview questions

1. What does tree shaking need in order to work?
2. What does `"sideEffects": false` promise, and what breaks when it's a lie?
3. Why do barrel files hurt?
4. Why is an unused class method kept?
5. `import * as icons` then `icons[name]` — what does the bundler do?
6. A CJS-only dependency is 200KB and you use one function. What are your options?
