// Lab 06 — Choosing a rendering technology.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

on('matrix', () => {
  renderTable('#results', [
    { tech: 'DOM + CSS', objects: '< ~1,000', a11y: 'free', text: 'selectable, searchable, translatable', hit: 'free', debug: 'Elements panel' },
    { tech: 'SVG', objects: '< ~5,000', a11y: 'good (roles, titles, focusable)', text: 'real text', hit: 'free, per shape', debug: 'Elements panel' },
    { tech: 'canvas 2D', objects: '~100,000', a11y: 'you build it (fallback content)', text: 'pixels', hit: 'you build it', debug: 'hard' },
    { tech: 'WebGL / WebGPU', objects: 'millions', a11y: 'you build it', text: 'pixels', hit: 'you build it', debug: 'very hard' },
  ], { columns: ['tech', 'objects', 'a11y', 'text', 'hit', 'debug'] });
  out.textContent =
    'READ THE MIDDLE COLUMNS FIRST. The object counts are what people choose on; the accessibility,\n' +
    'text and hit-testing columns are what they regret.\n\n' +
    'THE QUESTION THAT DECIDES IT: IS THIS CONTENT OR A RENDERING?\n\n' +
    '  CONTENT — a chart a person reads, a diagram, a table, a form, a document. It has meaning that\n' +
    '  someone might need to read with a screen reader, select, copy, search, translate or zoom to\n' +
    '  400%. Use the DOM or SVG. A bar chart with 40 bars in SVG is accessible, styleable, printable\n' +
    '  and hoverable for free.\n\n' +
    '  A RENDERING — a game, a map, a 50,000-point scatter plot, a photo editor, a particle field.\n' +
    '  The pixels are the product. Use canvas or WebGL, and provide the information another way.\n\n' +
    'The mistake in each direction:\n' +
    '  · a dashboard rebuilt in canvas "for performance" that now needs a custom tooltip system, a\n' +
    '    custom focus model, and a data table nobody built — to render 200 elements\n' +
    '  · a 100,000-point scatter plot in SVG that takes eight seconds to open';
});

on('counts', () => {
  renderTable('#results', [
    { count: '10–100', use: 'DOM. Anything else is premature.' },
    { count: '100–1,000', use: 'DOM, with care: transform/opacity only, virtualize long lists.' },
    { count: '1,000–5,000', use: 'SVG if it is content; canvas if it is a rendering. DOM will struggle.' },
    { count: '5,000–100,000', use: 'canvas 2D, with batching, culling and pre-rendered sprites.' },
    { count: '100,000+', use: 'WebGL/WebGPU, or aggregate the data before rendering it.' },
  ], { columns: ['count', 'use'] });
  out.textContent =
    'These are guides, not thresholds — the real limit depends on how much each object costs and how\n' +
    'often it changes. A thousand static DOM nodes are nothing; a thousand animating with box-shadow\n' +
    'is a slideshow.\n\n' +
    'AND THE OPTION MISSING FROM THE TABLE, WHICH IS OFTEN THE RIGHT ONE: RENDER FEWER THINGS.\n\n' +
    '  · VIRTUALIZE. A list of 100,000 rows renders 40 (web-vitals lab 05).\n' +
    '  · CULL. Do not draw what is outside the viewport.\n' +
    '  · AGGREGATE. 500,000 points on a chart is at most 1,920 columns of pixels; bin the data\n' +
    '    server-side or in a worker and draw the summary. Nobody can see 500,000 points, and\n' +
    '    downsampling with a shape-preserving algorithm (LTTB) looks identical.\n' +
    '  · SIMPLIFY GEOMETRY. Map polygons at zoom level 3 do not need 12 decimal places.\n\n' +
    'Every one of these is cheaper than changing rendering technology, and several of them are\n' +
    'necessary even if you do.';
});

on('hybrid', () => {
  renderTable('#results', [
    { pattern: 'canvas for the data, DOM for the chrome', example: 'a map: canvas tiles, DOM controls, DOM popups' },
    { pattern: 'canvas for the scene, DOM for the focused item', example: '10,000 points drawn; the hovered one gets a real tooltip element' },
    { pattern: 'SVG over canvas', example: 'a canvas heatmap with an SVG axis and labels — real, selectable text' },
    { pattern: 'two stacked canvases', example: 'a static background redrawn rarely, a dynamic layer every frame' },
    { pattern: 'OffscreenCanvas in a worker', example: 'the render loop is immune to main-thread jank (web-workers lab 05)' },
    { pattern: 'a DOM proxy layer', example: 'invisible focusable elements mirroring canvas hotspots, for keyboard and screen readers' },
  ], { columns: ['pattern', 'example'] });
  out.textContent =
    'HYBRIDS ARE USUALLY THE RIGHT ANSWER, and they are how every serious mapping and charting\n' +
    'library is built.\n\n' +
    'The general shape: DRAW THE MANY THINGS ON A CANVAS, AND KEEP THE FEW IMPORTANT THINGS IN THE\n' +
    'DOM. Ten thousand points are pixels; the one the user is pointing at is an element, with a\n' +
    'tooltip, a focus ring, real text, and an accessible name.\n\n' +
    'That pattern gets you the throughput of canvas and most of the accessibility of the DOM, and it\n' +
    'is far less work than either "make canvas accessible" or "make the DOM fast".\n\n' +
    'The other hybrid worth planning for early: SVG FOR AXES AND LABELS OVER A CANVAS PLOT. Text is\n' +
    'the part of a chart people most need to read, copy and translate, and it is the part canvas is\n' +
    'worst at.';
});

on('motion', () => {
  out.textContent =
    'WHATEVER YOU CHOOSE, THE MOTION QUESTIONS ARE THE SAME:\n\n' +
    '1. prefers-reduced-motion. Every technique in this course can make someone dizzy or ill.\n' +
    '   Check it in CSS AND in JavaScript:\n' +
    '     matchMedia("(prefers-reduced-motion: reduce)").matches\n' +
    '   and remember that "reduce" means remove MOVEMENT, not remove all feedback — a cross-fade or\n' +
    '   an instant change is usually better than a hard cut. Accessibility lab 05.\n\n' +
    '2. STOP WHEN HIDDEN. A rAF loop pauses automatically in a background tab; a setInterval loop\n' +
    '   does not, and a canvas animating in a hidden tab is pure battery cost. Also listen for\n' +
    '   visibilitychange and stop worker-driven and WebGL loops explicitly, since OffscreenCanvas in\n' +
    '   a worker keeps running.\n\n' +
    '3. DEGRADE ON WEAK DEVICES. navigator.hardwareConcurrency and navigator.deviceMemory are crude\n' +
    '   but real signals; measuring your own frame rate for a second and dropping the particle count\n' +
    '   or the pixel ratio is better. Design a scene that can be rendered at three fidelities.\n\n' +
    '4. DOES THE MOTION MEAN SOMETHING? Motion that shows causality (this panel came from that\n' +
    '   button), continuity (this item moved here), or state (this is loading) earns its cost.\n' +
    '   Motion that is decoration is a cost you pay on every device, including the cheap one on a\n' +
    '   train.\n\n' +
    'The last one is not a performance point, but it is the one that most often produces the\n' +
    'biggest performance win — because the fastest animation is the one you decided not to build.';
});
