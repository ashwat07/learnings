// Lab 02 — Animation APIs.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
const ball = $('#ball');

let raf = null, current = null;

function reset() {
  cancelAnimationFrame(raf);
  current?.cancel?.();
  current = null;
  ball.className = 'ball';
  ball.style.transform = 'none';
  ball.style.transition = '';
}
on('stop', () => { reset(); log.muted('stopped'); });

on('a-css', () => {
  reset();
  ball.classList.add('css-anim');
  log.ok('CSS @keyframes animation');
  out.textContent =
    'DECLARATIVE, and the browser owns the timeline. Because it animates transform, it can run\n' +
    'entirely on the COMPOSITOR THREAD — which means it keeps going smoothly even while the main\n' +
    'thread is blocked. Try it: run this, then trigger a long task from lab 03 in another tab.\n\n' +
    'Use CSS animations when the animation is a property of a STATE (loading, open, hovered) rather\n' +
    'than of a moment. They are the cheapest thing you can write, they compose with media queries\n' +
    '(including prefers-reduced-motion), and they need no JavaScript at all.\n\n' +
    'What you give up: precise control. Pausing, seeking, reversing and reading progress from CSS\n' +
    'animations is awkward — which is exactly what the Web Animations API fixes.';
});

on('a-waapi', () => {
  reset();
  current = ball.animate(
    [{ transform: 'translateX(0)' }, { transform: 'translateX(620px)' }],
    { duration: 1600, easing: 'ease-in-out', direction: 'alternate', iterations: Infinity },
  );
  log.ok('element.animate() — a real Animation object you can control');
  out.textContent =
    'THE SAME COMPOSITOR-THREAD PERFORMANCE AS CSS, plus an object:\n\n' +
    '  anim.pause() / play() / reverse()\n' +
    '  anim.currentTime = 800        // seek\n' +
    '  anim.playbackRate = 2\n' +
    '  await anim.finished            // a promise\n' +
    '  anim.commitStyles()            // bake the final state into inline styles\n\n' +
    'This is the right default for JavaScript-driven animation. You get declarative performance and\n' +
    'imperative control, and you can build keyframes dynamically — which CSS cannot do.\n\n' +
    'It also composes: document.getAnimations() returns every running animation on the page, which\n' +
    'is how you implement "pause everything" for prefers-reduced-motion, or wait for all animations\n' +
    'before a screenshot test.';
});

on('a-raf', () => {
  reset();
  const t0 = performance.now();
  const step = () => {
    const t = ((performance.now() - t0) / 1600) % 2;
    const p = t < 1 ? t : 2 - t;
    ball.style.transform = `translateX(${p * 620}px)`;
    raf = requestAnimationFrame(step);
  };
  step();
  log.bad('requestAnimationFrame — you own the timeline, and the main thread');
  out.textContent =
    'Visually identical, and structurally different: this animation is DRIVEN BY THE MAIN THREAD.\n' +
    'Every frame requires your JavaScript to run. Block the main thread and it stops dead, where\n' +
    'the CSS and WAAPI versions keep going.\n\n' +
    'So use rAF when you genuinely need per-frame JavaScript:\n' +
    '  · the value depends on something you compute each frame (physics, a simulation)\n' +
    '  · you are drawing to a canvas\n' +
    '  · you are following a pointer\n\n' +
    'And never use it for "move this from A to B" — that is what the other two are for.\n\n' +
    'If you do use it: animate from the TIMESTAMP, not by a fixed increment per frame, or your\n' +
    'animation runs at double speed on a 120Hz display (lab 03).';
});

on('a-transition', () => {
  reset();
  ball.style.transition = 'transform 1.2s cubic-bezier(.2,.8,.2,1)';
  requestAnimationFrame(() => { ball.style.transform = 'translateX(620px)'; });
  log.ok('CSS transition — from one state to another');
  out.textContent =
    'A transition animates BETWEEN TWO STATES when a property changes. It is the simplest tool and\n' +
    'the right one for most UI: hover, focus, open/closed, selected.\n\n' +
    'The two things that trip people up:\n' +
    '  · A TRANSITION NEEDS A CHANGE THE BROWSER CAN SEE AS TWO STATES. Setting the property in the\n' +
    '    same frame as adding the transition does nothing — hence the requestAnimationFrame above.\n' +
    '    (The classic alternative is forcing a reflow by reading offsetWidth, which works and is\n' +
    '    a forced layout you should not need.)\n' +
    '  · TRANSITIONING FROM display:none DOES NOT WORK, historically. The modern fix is\n' +
    '    transition-behavior: allow-discrete plus @starting-style, which finally makes\n' +
    '    enter/exit animation possible in pure CSS.';
});

on('vt', async () => {
  if (!document.startViewTransition) {
    log.bad('View Transitions not supported in this browser');
  } else {
    // The API takes a snapshot, runs your DOM update, snapshots again, and cross-fades between
    // them — with named elements morphing rather than fading.
    document.startViewTransition(() => {
      const stage = $('#stage');
      stage.style.background = stage.style.background === 'rgb(31, 58, 82)' ? '' : 'rgb(31, 58, 82)';
      ball.style.transform = ball.style.transform === 'translateX(300px)' ? 'none' : 'translateX(300px)';
    });
    log.ok('document.startViewTransition() ran');
  }
  out.textContent =
    'VIEW TRANSITIONS turn "animate between two states of the DOM" into a browser feature:\n\n' +
    '  document.startViewTransition(() => { updateTheDom(); });\n\n' +
    'The browser screenshots the old state, runs your callback, screenshots the new state, and\n' +
    'cross-fades — and any element with a matching view-transition-name MORPHS from its old\n' +
    'position and size to its new one.\n\n' +
    'That is the FLIP technique from lab 01, built in and done correctly, including for elements\n' +
    'that were removed and re-created. Style the result with ::view-transition-old(name) and\n' +
    '::view-transition-new(name), which are ordinary pseudo-elements you can animate with CSS.\n\n' +
    'Cross-document view transitions (@view-transition { navigation: auto }) do the same across a\n' +
    'real page navigation, which gives a multi-page app the transition quality people historically\n' +
    'built SPAs to get.\n\n' +
    'Caveats worth knowing: the DOM update callback should be synchronous and fast (the page is\n' +
    'frozen during it), view-transition-names must be UNIQUE at any moment, and support is not\n' +
    'universal — treat it as progressive enhancement, since the fallback is simply an instant\n' +
    'update.';
});

on('scroll', () => {
  const supported = CSS.supports('animation-timeline', 'scroll()');
  log[supported ? 'ok' : 'bad'](`scroll-driven animations: ${supported ? 'supported' : 'not supported'}`);
  out.textContent =
    `Your browser ${supported ? 'supports' : 'does not support'} scroll-driven animations. Scroll the box\n` +
    'and watch the progress bar.\n\n' +
    'The point is not the effect — it is WHERE IT RUNS. A scroll-linked animation written with a\n' +
    'scroll event handler runs on the main thread, always lags the scroll (scrolling happens on the\n' +
    'compositor), and is one of the classic causes of janky pages.\n\n' +
    '  #progress {\n' +
    '    animation: grow linear;\n' +
    '    animation-timeline: scroll(nearest);   /* or view() for element-in-viewport progress */\n' +
    '  }\n\n' +
    'This runs on the COMPOSITOR, perfectly synchronised with the scroll, with no JavaScript. It\n' +
    'replaces the entire category of scroll-handler animation libraries.\n\n' +
    'view() is the other half: it drives an animation from an element\'s progress through the\n' +
    'viewport, which is the "reveal on scroll" pattern — and it makes IntersectionObserver\n' +
    'unnecessary for that particular job.';
});

on('compare', () => {
  renderTable('#results', [
    { api: 'CSS transition', control: 'none', thread: 'compositor (transform/opacity)', use: 'state changes: hover, open, selected' },
    { api: 'CSS @keyframes', control: 'little', thread: 'compositor', use: 'looping, state-driven animation; spinners' },
    { api: 'Web Animations API', control: 'full (pause/seek/reverse/promise)', thread: 'compositor', use: 'the default for JS-driven animation' },
    { api: 'requestAnimationFrame', control: 'total', thread: 'MAIN', use: 'per-frame computation; canvas; pointer-following' },
    { api: 'View Transitions', control: 'declarative + CSS', thread: 'compositor', use: 'animating between two DOM states' },
    { api: 'scroll-driven (animation-timeline)', control: 'declarative', thread: 'compositor', use: 'anything tied to scroll position' },
    { api: 'a spring/physics library', control: 'full', thread: 'usually MAIN', use: 'interruptible, velocity-aware motion' },
  ], { columns: ['api', 'control', 'thread', 'use'] });
  out.textContent =
    'THE DECISION, in one line each:\n\n' +
    '  Does it follow a state change?          → CSS transition\n' +
    '  Does it loop or have keyframes?         → CSS animation\n' +
    '  Do you need to pause/seek/reverse it?   → Web Animations API\n' +
    '  Is it tied to scroll?                   → animation-timeline\n' +
    '  Are you swapping DOM states?            → View Transitions\n' +
    '  Do you need a value computed per frame? → requestAnimationFrame\n' +
    '  Are you drawing pixels?                 → canvas (labs 04–05)\n\n' +
    'And the one that is often the right answer for gesture-driven UI: A SPRING. Duration-based\n' +
    'easing looks wrong when an animation is INTERRUPTED — the new animation starts from a standstill\n' +
    'even though the element was moving. A spring carries velocity across the interruption, which is\n' +
    'why drag-and-release UI built with springs feels physical and the same UI built with a 300ms\n' +
    'ease-out does not. That is what Motion/Framer Motion and React Spring are actually for; the\n' +
    'cost is that they usually run on the main thread.';
});
