// Lab 05 — GPU & WebGL.
//
// A deliberately minimal WebGL program: one buffer, one vertex shader, one fragment shader, one
// draw call. Everything about "why the GPU is fast" is visible in that sentence.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
const cv2d = $('#cv2d');
const cvgl = $('#cvgl');
const ctx2d = cv2d.getContext('2d', { alpha: false });

let n = 10000, mode = null, raf = null;
let positions = new Float32Array(0);
let velocities = new Float32Array(0);

function seed(count) {
  positions = new Float32Array(count * 2);
  velocities = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    positions[i * 2] = Math.random() * 2 - 1;
    positions[i * 2 + 1] = Math.random() * 2 - 1;
    velocities[i * 2] = (Math.random() - 0.5) * 0.4;
    velocities[i * 2 + 1] = (Math.random() - 0.5) * 0.4;
  }
  $('count').textContent = count;
}
seed(n);

function integrate(dt) {
  for (let i = 0; i < positions.length; i += 2) {
    positions[i] += velocities[i] * dt;
    positions[i + 1] += velocities[i + 1] * dt;
    if (positions[i] < -1 || positions[i] > 1) velocities[i] *= -1;
    if (positions[i + 1] < -1 || positions[i + 1] > 1) velocities[i + 1] *= -1;
  }
}

// ---------------------------------------------------------------------------
// WebGL setup. ~40 lines, and worth reading once even if you never write another.
// ---------------------------------------------------------------------------
const VERT = `
  attribute vec2 a_position;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    gl_PointSize = 2.0;
  }`;
const FRAG = `
  precision mediump float;
  void main() { gl_FragColor = vec4(0.49, 0.90, 0.53, 1.0); }`;

let gl = null, glBuffer = null, glLoc = null;
function initGl() {
  gl = cvgl.getContext('webgl', { alpha: false, antialias: false });
  if (!gl) { log.bad('WebGL not available'); return false; }
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) log.bad(gl.getShaderInfoLog(s));
    return s;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(program);
  gl.useProgram(program);
  glBuffer = gl.createBuffer();
  glLoc = gl.getAttribLocation(program, 'a_position');
  gl.bindBuffer(gl.ARRAY_BUFFER, glBuffer);
  gl.enableVertexAttribArray(glLoc);
  gl.vertexAttribPointer(glLoc, 2, gl.FLOAT, false, 0, 0);
  gl.clearColor(0.04, 0.04, 0.06, 1);
  log.ok('WebGL initialised: 1 program, 1 buffer, 1 draw call per frame');
  return true;
}

let frames = 0, lastSecond = performance.now(), drawTotal = 0;
function step(prev) {
  const now = performance.now();
  const dt = Math.min((now - prev) / 1000, 0.05);
  integrate(dt);

  const t0 = performance.now();
  if (mode === 'gl' && gl) {
    // The whole frame: upload the buffer, one clear, one draw call for every point.
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.POINTS, 0, positions.length / 2);
  } else if (mode === '2d') {
    ctx2d.fillStyle = '#0a0a10';
    ctx2d.fillRect(0, 0, cv2d.width, cv2d.height);
    ctx2d.fillStyle = '#7ee787';
    for (let i = 0; i < positions.length; i += 2) {
      // One CPU-side call per point. This is the difference.
      ctx2d.fillRect((positions[i] + 1) * 0.5 * cv2d.width, (positions[i + 1] + 1) * 0.5 * cv2d.height, 2, 2);
    }
  }
  drawTotal += performance.now() - t0;
  frames++;
  if (now - lastSecond >= 1000) {
    $('fps').textContent = frames;
    $('draw').textContent = `${(drawTotal / Math.max(frames, 1)).toFixed(2)}ms`;
    frames = 0; drawTotal = 0; lastSecond = now;
  }
  raf = requestAnimationFrame(() => step(now));
}

on('r-2d', () => { restart('2d'); out.textContent =
  'Canvas 2D issues ONE CPU-SIDE CALL PER POINT. At 10,000 that is fine; at 100,000 the loop alone\n' +
  'costs more than a frame, before the rasteriser does any work.\n\n' +
  'The cost is not the pixels — it is the per-object overhead, on the CPU, single-threaded.'; });

on('r-gl', () => { restart('gl'); out.textContent =
  'WebGL uploads one buffer and issues ONE DRAW CALL for all the points. The GPU runs the vertex\n' +
  'shader for every vertex in parallel across hundreds or thousands of cores, then the fragment\n' +
  'shader for every covered pixel.\n\n' +
  'Push it to 500k. The draw time barely moves — because the draw is not the work; the JavaScript\n' +
  'loop that updates the positions is. That is the honest picture of GPU work: the drawing becomes\n' +
  'free and your bottleneck moves somewhere else, usually to data preparation or upload.'; });

on('stop', () => { cancelAnimationFrame(raf); log.muted('stopped'); });
for (const [id, count] of [['n-10k', 10000], ['n-100k', 100000], ['n-500k', 500000]]) {
  on(id, () => { n = count; seed(count); if (mode) restart(mode); });
}

on('model', () => {
  renderTable('#results', [
    { concept: 'vertex buffer', is: 'an array of numbers uploaded to GPU memory' },
    { concept: 'vertex shader', is: 'a tiny program run once PER VERTEX, in parallel' },
    { concept: 'fragment shader', is: 'a tiny program run once PER COVERED PIXEL, in parallel' },
    { concept: 'draw call', is: 'the CPU telling the GPU "run this program over this buffer"' },
    { concept: 'uniform', is: 'a value constant across a draw call (a matrix, a colour, a time)' },
    { concept: 'texture', is: 'an image the shader can sample' },
    { concept: 'instancing', is: 'draw the same geometry N times with per-instance data — one call' },
  ], { columns: ['concept', 'is'] });
  out.textContent =
    'THE MENTAL MODEL: you are not drawing. You are DESCRIBING A COMPUTATION and handing it to a\n' +
    'processor with thousands of cores, then getting out of the way.\n\n' +
    'Which explains every performance rule that follows:\n' +
    '  · FEWER, BIGGER DRAW CALLS. 1 call with 500,000 points beats 500 calls with 1,000 each, by a\n' +
    '    huge margin. Batching and instancing exist for this.\n' +
    '  · MINIMISE STATE CHANGES between calls (shader, texture, blend mode). Sort your scene by\n' +
    '    material.\n' +
    '  · UPLOAD AS LITTLE AS POSSIBLE PER FRAME. Static geometry goes up once; per-frame values go\n' +
    '    in uniforms.\n' +
    '  · NEVER READ BACK (readPixels, getImageData). It stalls the pipeline: the CPU waits for the\n' +
    '    GPU to finish everything queued.';
});

on('cost', () => {
  renderTable('#results', [
    { thing: 'draw calls', cost: 'HIGH (CPU-side)', fix: 'batch, instance, atlas your textures' },
    { thing: 'state changes', cost: 'high', fix: 'sort by shader/material' },
    { thing: 'per-frame buffer uploads', cost: 'medium', fix: 'upload only what changed; use a static buffer for the rest' },
    { thing: 'vertices', cost: 'low', fix: 'you can afford a lot more than you think' },
    { thing: 'fragments (pixels × overdraw)', cost: 'medium — the usual mobile bottleneck', fix: 'reduce overdraw, cap resolution, simplify the fragment shader' },
    { thing: 'shader complexity', cost: 'depends — it runs per pixel', fix: 'move maths to the vertex shader where you can' },
    { thing: 'readPixels / getImageData', cost: 'VERY HIGH', fix: 'do not; keep state on the CPU side' },
    { thing: 'context loss', cost: 'catastrophic if unhandled', fix: 'listen for webglcontextlost and rebuild' },
  ], { columns: ['thing', 'cost', 'fix'] });
  out.textContent =
    'Two things that will bite you in production and are absent from every tutorial:\n\n' +
    '1. CONTEXT LOSS IS NORMAL. The OS can take the GPU away — a driver reset, the tab being\n' +
    '   backgrounded, another app demanding memory, a laptop switching GPUs. Every WebGL app must\n' +
    '   handle it:\n\n' +
    "     canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); stop(); });\n" +
    "     canvas.addEventListener('webglcontextrestored', () => { rebuildEverything(); });\n\n" +
    '   Without preventDefault() the context is never restored, and your app is a black rectangle\n' +
    '   until reload.\n\n' +
    '2. MOBILE GPUs ARE FILL-RATE BOUND. On a tile-based mobile GPU the usual limit is FRAGMENTS,\n' +
    '   not vertices — so overdraw (many transparent layers stacked) and a high device pixel ratio\n' +
    '   cost more than geometry. Capping the render resolution is often the single most effective\n' +
    '   mobile optimisation, and it is one line.';
});

on('webgpu', () => {
  const hasGpu = 'gpu' in navigator;
  log[hasGpu ? 'ok' : 'muted'](`navigator.gpu: ${hasGpu ? 'available' : 'not available in this browser'}`);
  renderTable('#results', [
    { aspect: 'API age', webgl: 'OpenGL ES 2.0/3.0, ~2011', webgpu: 'modern, maps to Vulkan/Metal/D3D12' },
    { aspect: 'support', webgl: 'universal', webgpu: 'Chrome/Edge, Safari 26+, Firefox rolling out' },
    { aspect: 'compute shaders', webgl: 'no (fake it with textures)', webgpu: 'YES — general-purpose GPU compute' },
    { aspect: 'draw call overhead', webgl: 'high; global state machine', webgpu: 'much lower; explicit pipelines and bind groups' },
    { aspect: 'ergonomics', webgl: 'global state, easy to corrupt', webgpu: 'verbose up front, predictable after' },
    { aspect: 'in practice', webgl: 'Three.js / PixiJS / deck.gl', webgpu: 'the same libraries, with a WebGPU backend' },
  ], { columns: ['aspect', 'webgl', 'webgpu'] });
  out.textContent =
    'The practical answer for almost everyone: USE A LIBRARY AND LET IT CHOOSE. Three.js, PixiJS and\n' +
    'deck.gl all have WebGPU backends with a WebGL fallback, so you get the new API where it exists\n' +
    'without maintaining two renderers.\n\n' +
    'The reason to care about WebGPU specifically is COMPUTE SHADERS: general-purpose parallel\n' +
    'computation on the GPU, with no rendering involved. Particle simulation, physics, image\n' +
    'processing, and on-device ML inference all become available to a web app in a way WebGL could\n' +
    'only fake by encoding data into textures.\n\n' +
    'Note what happened in this lab: with WebGL the DRAWING was free and the JavaScript position\n' +
    'update became the bottleneck. A compute shader is how you move that loop to the GPU too — and\n' +
    'that is the actual step change.';
});

on('when', () => {
  out.textContent =
    'WHEN NOT TO REACH FOR THE GPU — which is most of the time:\n\n' +
    '  · Under a few thousand objects, canvas 2D is simpler, accessible-adjacent, and fast enough.\n' +
    '  · If the content is INFORMATION (a chart with 50 series, a diagram, a form), SVG or the DOM\n' +
    '    give you accessibility, text selection, search, styling and hit-testing for free. Do not\n' +
    '    trade all of that for frames you did not need.\n' +
    '  · WebGL brings real costs: a shader language, context loss handling, a much harder debugging\n' +
    '    story, driver differences between devices, and code very few people on your team can\n' +
    '    review.\n' +
    '  · It is also a fingerprinting surface and a battery cost, and some environments disable it.\n\n' +
    'THE ORDER TO ESCALATE, and you should be able to justify each step:\n' +
    '  DOM + CSS transitions  →  DOM + Web Animations  →  SVG  →  canvas 2D  →  WebGL/WebGPU\n\n' +
    'Each step buys throughput and costs accessibility, debuggability and team familiarity. Lab 06\n' +
    'is the decision table.';
});

function restart(kind) {
  cancelAnimationFrame(raf);
  mode = kind;
  $('mode').textContent = kind;
  cv2d.style.display = kind === '2d' ? 'block' : 'none';
  cvgl.style.display = kind === 'gl' ? 'block' : 'none';
  if (kind === 'gl' && !gl && !initGl()) return;
  step(performance.now());
}
