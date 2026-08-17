# Lab 05 — GPU & WebGL ⭐⭐⭐⭐⭐⭐

**Goal:** understand what the GPU is actually good at, and what it costs to use it.

**Primary metric:** draw ms/frame at 10k, 100k and 500k points.

> <http://localhost:8080/graphics-and-animation/labs/05-gpu-and-webgl/>

---

## The model

You are not drawing. You are **describing a computation** and handing it to a processor with
thousands of cores.

| Concept | Is |
|---|---|
| vertex buffer | an array of numbers uploaded to GPU memory |
| vertex shader | a tiny program run once **per vertex**, in parallel |
| fragment shader | a tiny program run once **per covered pixel**, in parallel |
| draw call | the CPU telling the GPU "run this program over this buffer" |
| uniform | a value constant across a draw call |
| instancing | draw the same geometry N times with per-instance data — one call |

The whole WebGL frame in this lab is: upload the buffer, clear, **one** `drawArrays`. Canvas 2D
issues **one CPU-side call per point**.

| | 10k | 100k | 500k |
|---|---|---|---|
| canvas 2D draw ms | | | |
| WebGL draw ms | | | |

**Note what the numbers tell you:** with WebGL the *drawing* becomes free and the bottleneck moves to
the JavaScript loop updating the positions. That's the honest picture of GPU work — you don't remove
the cost, you move it, and then you have a new bottleneck to think about.

## What's actually expensive

| Thing | Cost | Fix |
|---|---|---|
| **draw calls** | high (CPU-side) | batch, instance, atlas textures |
| state changes | high | sort by shader/material |
| per-frame uploads | medium | upload only what changed |
| vertices | low | you can afford far more than you think |
| **fragments** (pixels × overdraw) | medium — the usual **mobile** bottleneck | reduce overdraw, cap resolution, simplify the fragment shader |
| `readPixels` | **very high** | don't — keep state CPU-side |

### Two things absent from every tutorial

**1. Context loss is normal.** The OS can take the GPU away — driver reset, backgrounded tab, memory
pressure, a laptop switching GPUs.

```js
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); stop(); });
canvas.addEventListener('webglcontextrestored', () => rebuildEverything());
```

Without `preventDefault()` the context is **never** restored and your app is a black rectangle until
reload.

**2. Mobile GPUs are fill-rate bound.** On a tile-based mobile GPU the limit is usually *fragments*,
not vertices — so overdraw and a high device pixel ratio cost more than geometry. **Capping render
resolution is often the single most effective mobile optimisation**, and it's one line.

## WebGL vs WebGPU

| | WebGL | WebGPU |
|---|---|---|
| lineage | OpenGL ES 2.0/3.0, ~2011 | maps to Vulkan/Metal/D3D12 |
| support | universal | Chrome/Edge, Safari 26+, Firefox rolling out |
| **compute shaders** | no | **yes** |
| draw-call overhead | high; global state machine | much lower; explicit pipelines |
| ergonomics | global state, easy to corrupt | verbose up front, predictable after |

**The practical answer for almost everyone: use a library and let it choose.** Three.js, PixiJS and
deck.gl all have WebGPU backends with WebGL fallbacks.

The reason to care about WebGPU specifically is **compute shaders** — general-purpose parallel
computation with no rendering involved. Particle simulation, physics, image processing, on-device ML.
In this lab, drawing became free and the JS position loop became the bottleneck; a compute shader is
how you move *that* to the GPU too.

## When not to

- Under a few thousand objects, canvas 2D is simpler and fast enough.
- **If the content is information**, SVG or the DOM give you accessibility, text selection, search,
  styling and hit-testing free. Don't trade all of that for frames you didn't need.
- WebGL brings a shader language, context-loss handling, a much harder debugging story, driver
  differences across devices, and code very few people on your team can review.

**Escalate in order, justifying each step:**

```
DOM + CSS → Web Animations → SVG → canvas 2D → WebGL/WebGPU
```

## Think about

- Why is one draw call with 500k points faster than 500 calls with 1k each?
- Your WebGL app works on your laptop and shows a black screen on a colleague's. First checks?
- When does the GPU *not* help?

<details>
<summary>Answers</summary>

**One call vs 500.** Each draw call has fixed CPU-side overhead — validating state, building a
command, submitting it — and that overhead dwarfs the per-vertex work for small batches. The GPU is
idle waiting for work while the CPU assembles commands. Batching converts CPU-bound into GPU-bound,
which is where you want to be.

**Black screen elsewhere.** In order: (1) is the context lost, and did you handle
`webglcontextlost` with `preventDefault`? (2) shader compile/link errors — check
`getShaderInfoLog`/`getProgramInfoLog`, since precision qualifiers and extension support differ
between drivers; (3) a hardware/driver blocklist causing software rendering or refusal; (4) a
different `devicePixelRatio` or canvas size producing a zero-sized viewport; (5) a texture that isn't
power-of-two on hardware that requires it. Always log the shader info logs — the failure is silent
otherwise.

**When the GPU doesn't help.** When you're CPU-bound (as in this lab, once drawing is free), when
you're bound on data transfer (uploading a big buffer each frame), when object counts are low enough
that per-draw overhead dominates, or when you need to read results back — the round trip erases the
gain. GPUs reward large amounts of uniform, parallel work with little communication.
</details>

---

## 🏗️ Build challenge

1. Take a canvas 2D visualisation that struggles and port the hot path to WebGL — or to a library
   with a WebGPU backend.
2. Handle context loss and restoration. Test with `WEBGL_lose_context`.
3. Cap the render resolution on mobile and measure the difference.
4. Count your draw calls per frame. Batch until it's a handful.
5. Profile on a real mid-range Android, not a laptop.
6. Provide a non-GPU path: a static image, an aggregate view, or a data table.

**Done when:** you can state your draw-call count and your mobile fill cost, and the app survives a
context loss.

---

## Interview questions

1. Describe the GPU pipeline: buffer, vertex shader, fragment shader, draw call.
2. Why are draw calls the expensive part?
3. What is context loss and how do you handle it?
4. Why are mobile GPUs usually fill-rate bound?
5. What do compute shaders enable that WebGL couldn't?
6. When is WebGL the wrong choice?
