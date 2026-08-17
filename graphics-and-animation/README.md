# Animation, canvas & the GPU ⭐⭐⭐⭐⭐

A frame is 16.7ms at 60Hz — 8.3ms at 120Hz, which more and more devices are. Everything in this
course is about what fits in that budget and what doesn't, and about knowing when to stop asking the
DOM to do a job the GPU should be doing.

```sh
./serve.sh    # then http://localhost:8080/graphics-and-animation/labs/01-the-pipeline/
```

**Turn on 4× CPU throttling.** Every one of these labs is fine on a developer laptop.

---

## The pipeline, and where you can get off it

```
JS  →  Style  →  Layout  →  Paint  →  Composite
                    ↑        ↑          ↑
              width/top   color      transform
              margin      shadow     opacity
                                     filter
```

| You animate | Costs |
|---|---|
| `width`, `top`, `margin`, `font-size` | style + **layout** + paint + composite — the whole pipeline, for every affected element |
| `color`, `background`, `box-shadow` | style + paint + composite |
| **`transform`, `opacity`** | **composite only** — often on a different thread entirely |

That table is most of animation performance. The rest is knowing when the DOM is the wrong tool.

## Curriculum

| # | Lab | Question it answers | ⭐ |
|---|---|---|---|
| 01 | [The pipeline](labs/01-the-pipeline/) | Which properties are cheap, and why? | ⭐⭐⭐⭐⭐ |
| 02 | [Animation APIs](labs/02-animation-apis/) | CSS, WAAPI, rAF, view transitions, scroll-driven — which? | ⭐⭐⭐⭐ |
| 03 | [Frame budget](labs/03-frame-budget/) | Where did my 16.7ms go? | ⭐⭐⭐⭐⭐ |
| 04 | [Canvas 2D](labs/04-canvas-2d/) | 10,000 things on screen, at 60fps | ⭐⭐⭐⭐⭐ |
| 05 | [GPU & WebGL](labs/05-gpu-and-webgl/) | When do you leave the 2D context? | ⭐⭐⭐⭐⭐⭐ |
| 06 | [Choosing](labs/06-choosing/) | DOM, canvas, SVG, WebGL — decide it once | ⭐⭐⭐⭐ |

Prerequisites: [critical-rendering-path](../critical-rendering-path/) labs 03–05 (layout thrash and
the compositor) and [event-loop](../event-loop/) labs 04–05 (frames, rAF, yielding).

## The three rules

1. **Animate `transform` and `opacity`, or explain why not.**
2. **Never read layout in a loop that also writes it.** Batch reads, then writes
   ([critical-rendering-path lab 03](../critical-rendering-path/labs/14-forced-reflow-detector/)).
3. **Respect `prefers-reduced-motion`.** Every technique here can make someone ill; see
   [accessibility lab 05](../accessibility/labs/05-visual-and-motion/).
