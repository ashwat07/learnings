// Lab 01 — The pipeline: the same motion, four costs.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
const field = $('#field');

let boxes = [];
let mode = null;
let raf = null;
let count = 300;

function build(n) {
  field.textContent = '';
  boxes = Array.from({ length: n }, (_, i) => {
    const el = document.createElement('div');
    el.className = 'box';
    el.style.top = `${(i * 37) % 270}px`;
    el.style.left = '0px';
    el.style.background = `hsl(${(i * 7) % 360} 45% 40%)`;
    field.append(el);
    return el;
  });
  $('count').textContent = n;
}
build(count);

// FPS + worst frame, so the difference is a number rather than a feeling.
let frames = 0, last = performance.now(), worst = 0, prev = performance.now();
function meter() {
  const now = performance.now();
  worst = Math.max(worst, now - prev);
  prev = now;
  frames++;
  if (now - last >= 1000) {
    $('fps').textContent = frames;
    $('worst').textContent = `${worst.toFixed(1)}ms`;
    frames = 0; worst = 0; last = now;
  }
  requestAnimationFrame(meter);
}
requestAnimationFrame(meter);

function animate(kind) {
  cancelAnimationFrame(raf);
  mode = kind;
  $('mode').textContent = kind;
  for (const el of boxes) { el.style.left = '0px'; el.style.marginLeft = '0px'; el.style.transform = 'none'; el.style.boxShadow = 'none'; }
  const t0 = performance.now();
  const step = () => {
    const t = (performance.now() - t0) / 1000;
    const x = (Math.sin(t) * 0.5 + 0.5) * (field.clientWidth - 30);
    for (const el of boxes) {
      // Each branch produces IDENTICAL motion and a completely different amount of browser work.
      if (kind === 'left') el.style.left = `${x}px`;                    // layout → paint → composite
      else if (kind === 'margin') el.style.marginLeft = `${x}px`;       // layout → paint → composite
      else if (kind === 'shadow') el.style.boxShadow = `${x / 20}px 0 ${x / 8}px #000`;  // paint → composite
      else el.style.transform = `translateX(${x}px)`;                   // composite only
    }
    raf = requestAnimationFrame(step);
  };
  step();
  log.head(`animating via ${kind}`);
}

on('a-left', () => { animate('left'); out.textContent = NOTES.left; });
on('a-margin', () => { animate('margin'); out.textContent = NOTES.margin; });
on('a-shadow', () => { animate('shadow'); out.textContent = NOTES.shadow; });
on('a-transform', () => { animate('transform'); out.textContent = NOTES.transform; });
on('stop', () => { cancelAnimationFrame(raf); log.muted('stopped'); });

for (const [id, n] of [['n-50', 50], ['n-300', 300], ['n-1000', 1000]]) {
  on(id, () => { count = n; build(n); if (mode) animate(mode); });
}

const NOTES = {
  left:
    'Animating `left` changes the element\'s POSITION IN LAYOUT. Every frame the browser recomputes\n' +
    'geometry, repaints, and composites — for every box.\n\n' +
    'Turn on Paint flashing in the Rendering panel: the whole area flashes green every frame. In\n' +
    'the Performance flame chart you will see purple (Layout) and green (Paint) bars on every\n' +
    'frame, which is exactly the work you are paying for.\n\n' +
    'Push the count to 1000 and watch the FPS fall. Layout cost scales with the number of elements\n' +
    'AND with how much of the tree each change invalidates — which is why one badly-placed\n' +
    'animation can make an entire page janky.',
  margin:
    'margin-left is the same story as left, and slightly worse: it can affect SIBLINGS, so the\n' +
    'layout invalidation is wider. Anything that changes the box model — width, height, padding,\n' +
    'margin, border, font-size, top/left/right/bottom on a non-absolute element — is in this class.',
  shadow:
    'box-shadow skips LAYOUT (nothing moved in the flow) but forces a PAINT every frame, and a\n' +
    'blurred shadow is one of the most expensive things a rasteriser can be asked to do — the cost\n' +
    'grows with the blur radius and the painted area.\n\n' +
    'Better in the FPS column than `left`, still bad. And note the general shape: skipping layout is\n' +
    'a big win; skipping paint as well is a much bigger one.\n\n' +
    'The trick for an animated shadow: paint the shadow ONCE on a pseudo-element and animate its\n' +
    'OPACITY. Same visual result, composite-only cost.',
  transform:
    'Identical motion, and the browser is doing almost nothing per frame. transform does not change\n' +
    'layout position (which is also why it contributes nothing to CLS — accessibility lab 05), and\n' +
    'it does not require repainting the element: the pixels already exist as a texture, and the\n' +
    'compositor just draws them somewhere else.\n\n' +
    'On a well-behaved page that work can happen on the COMPOSITOR THREAD, which means the\n' +
    'animation keeps running smoothly even while the main thread is busy. That is the real prize —\n' +
    'not "a bit faster", but "not affected by your JavaScript at all".\n\n' +
    'Push the count to 1000: the FPS barely moves.',
};

on('layers', () => {
  renderTable('#results', [
    { fact: 'what creates a layer', detail: 'transform/opacity animations, will-change, 3D transforms, video, canvas, position:fixed (sometimes)' },
    { fact: 'what a layer costs', detail: 'GPU memory: width × height × 4 bytes, per layer, at device pixel ratio' },
    { fact: 'will-change: transform', detail: 'promotes ahead of time so the first frame is not janky' },
    { fact: 'the will-change mistake', detail: 'leaving it on permanently, or applying it to many elements — memory, and slower compositing' },
    { fact: 'the old hack', detail: 'translateZ(0) / translate3d(0,0,0) — same effect, less honest; use will-change' },
    { fact: 'layer explosion', detail: 'hundreds of layers is slower than none: more memory, more compositing work' },
  ], { columns: ['fact', 'detail'] });
  out.textContent =
    'A COMPOSITOR LAYER is a texture the GPU can move without re-rasterising. That is what makes\n' +
    'transform animation cheap, and it is not free.\n\n' +
    'Each layer costs width × height × 4 bytes of GPU memory AT DEVICE PIXEL RATIO — so a\n' +
    'full-screen layer on a 3× phone is roughly 1080 × 2340 × 9 × 4 bytes, about 90MB. A handful of\n' +
    'those is a crash on a low-end device.\n\n' +
    'The rules:\n' +
    '  · will-change: transform ONLY on the element you are about to animate, and REMOVE IT when\n' +
    '    the animation ends. It is a hint about the near future, not a decoration.\n' +
    '  · never put it on a rule that matches many elements (.card { will-change: transform } is a\n' +
    '    classic memory bug)\n' +
    '  · check Layers in DevTools (⋮ → More tools → Layers) and read the memory estimate\n' +
    '  · if you find yourself promoting dozens of elements to make the DOM keep up, that is the\n' +
    '    signal to switch to canvas — lab 04';
});

on('table', () => {
  renderTable('#results', [
    { property: 'transform', stages: 'composite', verdict: 'animate freely' },
    { property: 'opacity', stages: 'composite', verdict: 'animate freely' },
    { property: 'filter', stages: 'composite (usually)', verdict: 'usually fine; blur can be expensive' },
    { property: 'color / background-color', stages: 'paint, composite', verdict: 'acceptable for small areas' },
    { property: 'box-shadow / border-radius', stages: 'paint, composite', verdict: 'expensive to paint; fade a pre-painted copy instead' },
    { property: 'width / height', stages: 'LAYOUT, paint, composite', verdict: 'use transform: scale()' },
    { property: 'top / left / right / bottom', stages: 'LAYOUT, paint, composite', verdict: 'use transform: translate()' },
    { property: 'margin / padding', stages: 'LAYOUT, paint, composite', verdict: 'never animate' },
    { property: 'font-size / line-height', stages: 'LAYOUT (text!), paint, composite', verdict: 'never; scale a container instead' },
    { property: 'display / position', stages: 'LAYOUT, and not interpolatable anyway', verdict: 'no' },
  ], { columns: ['property', 'stages', 'verdict'] });
  out.textContent =
    'Two translations you will use constantly:\n\n' +
    '  animating width/height   →  transform: scale()   (with transform-origin, and remember it\n' +
    '                               scales the CONTENT and the border too — if that matters, scale\n' +
    '                               a wrapper and counter-scale the child)\n' +
    '  animating top/left       →  transform: translate()\n\n' +
    'And the general technique for "I have to animate an expensive property": FLIP.\n' +
    '  First   measure the start geometry (getBoundingClientRect)\n' +
    '  Last    apply the final state and measure again\n' +
    '  Invert  apply a transform that makes it LOOK like it is still at the start\n' +
    '  Play    animate that transform to none\n' +
    'You get the visual result of animating layout with the cost of animating transform. This is\n' +
    'what every "shared element transition" library does, and what the View Transitions API now\n' +
    'does for you (lab 02).\n\n' +
    'Check your work with the Performance panel: a healthy transform animation shows almost nothing\n' +
    'per frame on the main thread. If you see purple Layout bars in an animation, you have the\n' +
    'wrong property.';
});
