# Lab 14 — Forced reflow detector ⭐⭐⭐⭐⭐

**Goal:** stop pattern-matching and start reasoning. By the end you should be able to look at any
sequence of DOM reads and writes and say, correctly, how many layouts it causes and why.

**Primary metric:** predicted layout count vs actual layout count. Your accuracy is the score.

---

## The concept

The browser keeps two dirty bits (conceptually): *style is dirty* and *layout is dirty*. A write
sets them. A read of a value that depends on them forces a synchronous flush of exactly what's
needed.

So the rules are:

1. A write **marks dirty** and returns immediately. Cheap.
2. A read of a layout-dependent value **flushes layout** if and only if layout is currently dirty.
3. A read of a computed-style value **flushes style**, and flushes layout too if the value it wants
   is layout-dependent (`width`, `height`, `top`, …).
4. Consecutive reads with **no write between them** are cheap — after the first one, the tree is
   clean, so the rest are lookups.
5. Reading the *inline* style object (`el.style.width`) doesn't flush anything — it's just a string
   on the element.
6. `requestAnimationFrame` callbacks run *before* the frame's style/layout pass — so if the tree is
   dirty when your rAF callback reads geometry, you still force a layout. rAF is not a magic shield;
   it's just a good place to *batch*.
7. Some flushes are subtree-scoped, not document-wide — `contain: layout` and out-of-flow elements
   limit the blast radius. Modern engines are smarter than the folklore, which is exactly why you
   should measure rather than recite.

Now consider the pattern from your notes:

```js
element.style.height = "300px";        // 1. write → layout dirty
element.getBoundingClientRect();       // 2. read  → FLUSH (layout was dirty)
element.style.width  = "200px";        // 3. write → layout dirty again
element.offsetWidth;                   // 4. read  → FLUSH again
```

Two forced layouts. But now think harder about these variants:

```js
// A
el.style.height = '300px';
el.offsetWidth; el.offsetHeight; el.getBoundingClientRect();   // how many layouts?

// B
el.offsetWidth;
el.style.height = '300px';                                      // how many?

// C
elA.style.height = '300px';
elB.offsetWidth;                                                // different element. how many?

// D
el.style.setProperty('--x', '3px');   // a custom property nothing geometric uses
el.offsetWidth;                                                 // how many?

// E
el.classList.add('red');              // color only
el.offsetWidth;                                                 // how many?

// F
el.style.height = '300px';
el.style.height;                       // reading the INLINE style back
el.offsetWidth;                                                 // how many?

// G
requestAnimationFrame(() => { el.style.height = '300px'; el.offsetWidth; });  // how many?

// H
el.style.height = '300px';
await new Promise(r => setTimeout(r, 0));
el.offsetWidth;                                                 // how many? and why?
```

Some of those answers will surprise you. **Write down your prediction for all eight before opening
the page.** Then measure.

## Break it

`index.html` runs each pattern in isolation, N times, and reports:

- wall-clock time for the block
- the number of geometry reads (counted by patching the getters)
- and — the interesting part — a **layout-count estimate** derived from timing, which you then verify
  against the Performance panel's actual `Layout` entries

## Measure it

1. For each pattern, write your prediction in the table below **first**.
2. Run the pattern in the page. Note the time.
3. Record a Performance trace over one run and count the actual `Layout` entries in the task.
   (Bottom-Up → group by activity → Layout → count.)
4. Fill in the actual column. Where you were wrong, work out why before moving on. That's the lab.

| Pattern | My prediction | Actual layouts | Why I was wrong (if I was) |
|---|---|---|---|
| A (write, 3 reads) | | | |
| B (read, then write) | | | |
| C (write A, read B) | | | |
| D (custom property) | | | |
| E (colour class) | | | |
| F (inline style read) | | | |
| G (inside rAF) | | | |
| H (across a task boundary) | | | |
| thrash ×1000 | | | |
| batched ×1000 | | | |

## Why does each read force layout?

Answer in your own words, per pattern. Specifically:

- **C** — why does writing to element A force a layout when you read element B? What would have to
  be true for the browser to avoid it? (Then test it with `contain: layout` on both.)
- **D** — the custom property is unused by any geometric property. Does the browser know that?
  Test the same thing with a custom property that *is* used in a `width: var(--x)`.
- **E** — does a colour change dirty *layout*, or only style and paint? What does the read cost then?
- **H** — the write and the read are in different tasks. What happened in between?
- **G** — the classic misconception is "rAF makes reads safe". Demonstrate that it doesn't.

## Fix it yourself

- [ ] Get 8/8 on the prediction table. Re-run any you got wrong after you understand them.
- [ ] Add two patterns of your own that you think are ambiguous, predict, and measure.
- [ ] Test the containment hypothesis: put `contain: layout` (and separately `contain: strict`) on
      the test elements and re-run patterns A and C. Document what changed. This is the modern nuance
      that most "layout thrashing" articles predate.
- [ ] Test scope: does writing to a `position: absolute` element inside a containing block force a
      *document* layout, or a subtree layout? Design an experiment that can tell the difference
      (hint: make the rest of the document enormous, and compare timings).
- [ ] Write the reasoning down as a decision procedure — five or six rules that let you answer any
      new pattern without measuring. Then test your procedure on a real file from a real project.

---

## 🏗️ Build challenge: `reflow-sentinel` — a forced-layout detector you'd ship

The tool that would have prevented Labs 01, 02, and 05. Build it properly.

**Core:**

1. Patch every layout-forcing getter and method (the list is in
   [concepts/02-what-triggers-what.md](../../concepts/02-what-triggers-what.md)) — the full set, not
   just `offsetWidth`.
2. Track a **dirty flag**: patch style mutation paths (`CSSStyleDeclaration.setProperty`, the
   `style` property setters, `classList`, `setAttribute`, `appendChild`/`insertBefore`/`remove`,
   `innerHTML`) so you know whether a read is actually *forcing* a flush or just reading a clean
   tree. **This is what makes the tool useful rather than noisy** — a read counter alone cries wolf
   on every clean read.
3. When a forcing read happens, record: the property, the element, a stack trace, and a frame id.
4. Clear the dirty flag at the right moments — after a forced flush, and at the start of each frame
   after the browser's own layout pass. Getting this right is the hard part and worth thinking
   through carefully.
5. Report per frame: number of forced layouts, and the top offending stacks aggregated by call site.

**Ergonomics that make it adoptable:**

6. `reflowSentinel.start({ threshold: 2, onViolation })` — only fire when a single frame forces more
   than N layouts.
7. Aggregate identical stacks so a 1,000-iteration loop is one report line with a count, not 1,000
   console lines.
8. Source-map the stacks in dev so the report points at your TypeScript, not the bundle.
9. A `measure`/`mutate` mode that integrates with the FastDOM scheduler from Lab 01: warn when a
   read happens during a mutate phase.
10. Near-zero cost when disabled, and a hard guarantee it never ships to production — build-time flag,
    plus a runtime assertion.
11. **Ground-truth validation**: run it against all ten patterns from this lab and assert its counts
    match the Performance panel's. A detector you haven't validated is a source of false confidence.

**Then use it in anger:** run it on a real app — yours or an open-source one — during a scroll, a
resize, and a route transition. Report the top three violations you found and fix one of them.

**Done when:** its counts match a real trace for all ten patterns, it reports one aggregated line for
a 1,000-iteration thrash loop, and it found a genuine forced reflow in code you didn't write.

---

## Interview questions

1. Walk me through, line by line, how many layouts this causes and why:
   ```js
   for (const el of els) { el.style.width = el.parentNode.offsetWidth / 2 + 'px'; }
   ```
2. Why are consecutive geometry reads cheap but alternating read/write expensive?
3. Does `requestAnimationFrame` prevent forced layout? Explain carefully.
4. Reading `el.style.width` versus `getComputedStyle(el).width` — what's the difference in cost?
5. How does `contain: layout` change the answer to any of the above?
6. How would you detect forced reflows automatically in a large codebase?
7. Your fix is "wrap it in `setTimeout`". Critique that.
