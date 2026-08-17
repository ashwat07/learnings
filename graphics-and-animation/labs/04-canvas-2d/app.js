// Lab 04 — Canvas 2D.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
const cv = $('#cv');
const ctx = cv.getContext('2d', { alpha: false });   // opaque: the compositor can skip blending
const domfield = $('#domfield');

let n = 2000, mode = null, raf = null;
let particles = [];
let domNodes = [];

function seed(count) {
  particles = Array.from({ length: count }, () => ({
    x: Math.random() * 760, y: Math.random() * 300,
    vx: (Math.random() - 0.5) * 90, vy: (Math.random() - 0.5) * 90,
    h: Math.floor(Math.random() * 360),
  }));
  $('count').textContent = count;
}
seed(n);

function buildDom() {
  domfield.textContent = '';
  domNodes = particles.map((p) => {
    const el = document.createElement('i');
    el.style.background = `hsl(${p.h} 60% 55%)`;
    domfield.append(el);
    return el;
  });
}

// FPS + per-frame draw cost.
let frames = 0, last = performance.now(), drawTotal = 0;
function tickMeter(dt) {
  drawTotal += dt; frames++;
  const now = performance.now();
  if (now - last >= 1000) {
    $('fps').textContent = frames;
    $('draw').textContent = `${(drawTotal / Math.max(frames, 1)).toFixed(2)}ms`;
    frames = 0; drawTotal = 0; last = now;
  }
}

function step(prev) {
  const now = performance.now();
  const dt = Math.min((now - prev) / 1000, 0.05);
  for (const p of particles) {
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.x < 0 || p.x > 760) p.vx *= -1;
    if (p.y < 0 || p.y > 300) p.vy *= -1;
  }

  const t0 = performance.now();
  if (mode === 'canvas') {
    ctx.fillStyle = '#0a0a10';
    ctx.fillRect(0, 0, cv.width, cv.height);
    // Batching by colour: every fillStyle change is a state change, and state changes are the
    // expensive part of a 2D context — not the shapes.
    let lastHue = -1;
    for (const p of particles) {
      const bucket = p.h - (p.h % 30);
      if (bucket !== lastHue) { ctx.fillStyle = `hsl(${bucket} 60% 55%)`; lastHue = bucket; }
      ctx.fillRect(p.x, p.y, 4, 4);           // fillRect beats arc() by a wide margin
    }
  } else {
    for (let i = 0; i < particles.length; i++) {
      // One style write per node per frame. Each is a style invalidation the browser must
      // recompute, lay out and composite.
      domNodes[i].style.transform = `translate(${particles[i].x}px, ${particles[i].y}px)`;
    }
  }
  tickMeter(performance.now() - t0);
  raf = requestAnimationFrame(() => step(now));
}

function start(kind) {
  cancelAnimationFrame(raf);
  mode = kind;
  $('mode').textContent = kind;
  cv.style.display = kind === 'canvas' ? 'block' : 'none';
  domfield.style.display = kind === 'dom' ? 'block' : 'none';
  if (kind === 'dom') buildDom();
  log.head(`renderer: ${kind}, ${particles.length} particles`);
  step(performance.now());
}

on('r-dom', () => {
  start('dom');
  out.textContent =
    'Even using transform — the cheap property from lab 01 — the DOM has a per-node cost that\n' +
    'canvas does not: a style recalculation, a layout entry, a compositing decision, and an\n' +
    'accessibility tree node, for every particle, every frame.\n\n' +
    'Try 10,000. The browser is not slow at drawing 10,000 dots; it is slow at MAINTAINING 10,000\n' +
    'elements. That distinction is the whole reason canvas exists.';
});

on('r-canvas', () => {
  start('canvas');
  out.textContent =
    'Same motion, same maths, one element. The per-frame work is a clear and 10,000 fillRects, and\n' +
    'nothing else — no style, no layout, no accessibility tree, no compositing decisions.\n\n' +
    'Note the "draw ms/frame" number: that is your real budget. At 60fps you have 16.7ms TOTAL, of\n' +
    'which your draw is only part — the browser still has to composite, and your app still has to\n' +
    'do everything else. Aim to keep drawing under about 8ms.';
});

on('stop', () => { cancelAnimationFrame(raf); log.muted('stopped'); });
for (const [id, count] of [['n-500', 500], ['n-2000', 2000], ['n-10000', 10000]]) {
  on(id, () => { n = count; seed(count); if (mode) start(mode); });
}

on('dpr', () => {
  const dpr = devicePixelRatio;
  const css = cv.getBoundingClientRect();
  renderTable('#results', [
    { fact: 'devicePixelRatio', value: dpr },
    { fact: 'CSS size', value: `${Math.round(css.width)} × ${Math.round(css.height)}` },
    { fact: 'backing store (canvas.width/height)', value: `${cv.width} × ${cv.height}` },
    { fact: 'correct backing store for this screen', value: `${Math.round(css.width * dpr)} × ${Math.round(css.height * dpr)}` },
    { fact: 'pixels to fill at DPR 1 vs 3', value: `${Math.round(css.width * css.height / 1000)}k vs ${Math.round(css.width * css.height * 9 / 1000)}k` },
  ], { columns: ['fact', 'value'] });
  out.textContent =
    'A canvas has TWO sizes and confusing them is the most common canvas bug:\n\n' +
    '  canvas.width / height   the BACKING STORE — how many pixels you actually draw into\n' +
    '  CSS width / height      how big it appears, stretched or squashed to fit\n\n' +
    'The correct setup on a high-DPI screen:\n\n' +
    '  canvas.width  = cssWidth  * devicePixelRatio;\n' +
    '  canvas.height = cssHeight * devicePixelRatio;\n' +
    '  canvas.style.width  = cssWidth + "px";\n' +
    '  canvas.style.height = cssHeight + "px";\n' +
    '  ctx.scale(devicePixelRatio, devicePixelRatio);   // now draw in CSS pixels\n\n' +
    'Get it wrong one way and everything is blurry; get it wrong the other and you fill NINE TIMES\n' +
    'as many pixels as you need on a 3× phone — which is exactly the device that can least afford\n' +
    'it.\n\n' +
    'The pragmatic compromise for expensive scenes: cap the ratio at 2\n' +
    '(Math.min(devicePixelRatio, 2)). The visual difference above 2× is small and the fill cost is\n' +
    'quadratic.\n\n' +
    'Also: re-run this setup on resize AND when the window moves between monitors — devicePixelRatio\n' +
    'changes, and matchMedia(`(resolution: ${dpr}dppx)`) is how you hear about it.';
});

on('tips', () => {
  renderTable('#results', [
    { rule: 'batch by state', why: 'fillStyle/strokeStyle/font changes are the expensive part, not the shapes' },
    { rule: 'fillRect beats arc()', why: 'no path construction; for small particles nobody can tell' },
    { rule: 'avoid save()/restore() per object', why: 'the state stack costs more than the draw for simple shapes' },
    { rule: 'round coordinates for crisp output', why: 'a 0.5 offset makes the rasteriser antialias every edge' },
    { rule: 'pre-render sprites to an offscreen canvas', why: 'draw complex art once, then drawImage — the single biggest win' },
    { rule: 'layer static and dynamic content', why: 'a stacked canvas for the background you redraw rarely' },
    { rule: 'clear only what changed (dirty rects)', why: 'clearing the whole canvas is a full-surface fill' },
    { rule: '{ alpha: false }', why: 'an opaque context skips per-pixel blending' },
    { rule: 'cull off-screen objects', why: 'the cheapest draw is the one you skip' },
    { rule: 'never read pixels in a loop', why: 'getImageData forces a GPU→CPU sync and destroys the frame' },
  ], { columns: ['rule', 'why'] });
  out.textContent =
    'PRE-RENDERING is the technique that changes the numbers most. If you draw the same complex\n' +
    'shape a thousand times, draw it ONCE into an OffscreenCanvas (or a detached <canvas>) and then\n' +
    'drawImage it a thousand times. You convert path construction and rasterisation into a blit.\n\n' +
    'LAYERING is the second: stack two canvases with CSS, put the static background on the lower\n' +
    'one and redraw only the upper one each frame. A map with a static tile layer and moving\n' +
    'markers is the canonical case.\n\n' +
    'And the one that surprises people: getImageData IS A PIPELINE STALL. Reading pixels forces the\n' +
    'GPU to finish and hand data back to the CPU, which can cost several milliseconds. If you are\n' +
    'doing hit-testing by reading a pixel, keep your own spatial index instead — or use\n' +
    'ctx.isPointInPath, or a separate 1×1 read at most once per interaction.';
});

on('offscreen', () => {
  const supported = typeof OffscreenCanvas !== 'undefined';
  log[supported ? 'ok' : 'bad'](`OffscreenCanvas: ${supported ? 'supported' : 'not supported'}`);
  out.textContent =
    'OffscreenCanvas does two different jobs, and they are worth separating:\n\n' +
    '1. AN OFF-DOM DRAWING SURFACE, on the main thread. This is the pre-rendering target above, and\n' +
    '   it is useful on its own.\n' +
    '2. A CANVAS A WORKER CAN DRAW INTO:\n\n' +
    '     const off = canvas.transferControlToOffscreen();\n' +
    "     worker.postMessage({ canvas: off }, [off]);\n\n" +
    '   After transferControlToOffscreen the MAIN THREAD CAN NO LONGER DRAW to that canvas — control\n' +
    '   has moved. The worker owns it, and its rendering loop is completely unaffected by main-thread\n' +
    '   jank: your animation keeps running at 60fps while React re-renders, while a long task runs,\n' +
    '   while the user drags a list.\n\n' +
    'That is the real prize, and it is the same prize as compositor-thread animation in lab 01 —\n' +
    'independence from the main thread. See web-workers lab 05, which covers its constraints.\n\n' +
    'The costs: input handling still happens on the main thread (so you post events to the worker),\n' +
    'the worker cannot touch the DOM, and you now have two places where your state lives — which is\n' +
    'a real architectural commitment, not a flag you flip.';
});

on('a11y', () => {
  out.textContent =
    'THE THING CANVAS TAKES AWAY: canvas content is invisible to assistive technology, to text\n' +
    'search, to translation, to text selection, and to a user zooming to 400%. It is a picture.\n\n' +
    'What to do about it, in order of honesty:\n\n' +
    '  · PUT REAL CONTENT INSIDE THE <canvas> ELEMENT. Its children are the fallback content and\n' +
    '    ARE exposed to assistive tech — a table of the data behind a chart, or focusable buttons\n' +
    '    mirroring your interactive hotspots. This is the specified mechanism and it is underused.\n' +
    '  · Provide the same information another way: a data table below the chart, a text summary, a\n' +
    '    CSV download.\n' +
    '  · For interactive canvases, maintain a parallel DOM of focusable proxies and keep them in\n' +
    '    sync — this is what accessible charting libraries do.\n' +
    '  · Do not animate without checking prefers-reduced-motion.\n\n' +
    'And a decision rule that saves a lot of retrofitting: IF THE CONTENT IS INFORMATION, PREFER SVG\n' +
    'OR THE DOM. If it is a rendering — a game, a visualisation of 50,000 points, a photo editor —\n' +
    'canvas is right, and you owe the user an alternative path to the information. Lab 06.';
});
