// Lab 01 — Input modalities.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

// A live read-out of what is actually driving the page right now — which is the only honest
// signal, because a device can have several inputs and switch between them mid-session.
for (const type of ['pointerdown', 'pointermove', 'keydown', 'wheel']) {
  addEventListener(type, (e) => {
    $('#probe').textContent =
      type === 'keydown' ? `keydown: ${e.key}` : `${type}: pointerType=${e.pointerType ?? 'n/a'}`;
    document.documentElement.dataset.lastInput = e.pointerType ?? (type === 'keydown' ? 'keyboard' : 'other');
  }, { passive: true });
}

on('detect', () => {
  const q = (s) => matchMedia(s).matches;
  renderTable('#results', [
    { query: '(hover: hover)', value: q('(hover: hover)'), means: 'the PRIMARY input can hover' },
    { query: '(any-hover: hover)', value: q('(any-hover: hover)'), means: 'SOME input can hover — a touch laptop with a mouse attached' },
    { query: '(pointer: fine)', value: q('(pointer: fine)'), means: 'a precise primary pointer (mouse, stylus)' },
    { query: '(pointer: coarse)', value: q('(pointer: coarse)'), means: 'an imprecise primary pointer (finger, remote)' },
    { query: '(any-pointer: coarse)', value: q('(any-pointer: coarse)'), means: 'touch is available at all' },
    { query: 'navigator.maxTouchPoints', value: navigator.maxTouchPoints, means: '0 means no touchscreen' },
    { query: '(prefers-reduced-motion)', value: q('(prefers-reduced-motion: reduce)'), means: 'see accessibility lab 05' },
    { query: 'hardwareConcurrency', value: navigator.hardwareConcurrency ?? '—', means: 'logical cores; a crude CPU signal' },
    { query: 'deviceMemory', value: navigator.deviceMemory ?? '—', means: 'GB, rounded down, capped at 8' },
  ], { columns: ['query', 'value', 'means'] });
  out.textContent =
    'THE DISTINCTION THAT MATTERS: hover vs any-hover, pointer vs any-pointer.\n\n' +
    '  (hover: hover)      the PRIMARY input can hover\n' +
    '  (any-hover: hover)  ANY available input can hover\n\n' +
    'A touchscreen laptop reports pointer: fine AND any-pointer: coarse. A tablet with a keyboard\n' +
    'case changes its answers when you attach it. A device is not one thing, and it is not one thing\n' +
    'for the whole session.\n\n' +
    'So the practical pattern is: use media queries for LAYOUT decisions (which need to be stable),\n' +
    'and use the LAST OBSERVED INPUT for behavioural ones. This page sets\n' +
    'document.documentElement.dataset.lastInput on every pointerdown and keydown — move the mouse,\n' +
    'then press Tab, and it changes.\n\n' +
    'And never, ever branch on the user agent. "Mobile" UAs run on tablets with keyboards; desktop\n' +
    'UAs run on touchscreens; a TV reports whatever its manufacturer felt like.';
});

on('events', () => {
  renderTable('#results', [
    { event: 'pointerdown / move / up', use: 'THE DEFAULT — one API for mouse, touch and pen, with pointerType' },
    { event: 'click', use: 'still the right event for activation: fires for keyboard Enter/Space too' },
    { event: 'touchstart / touchmove', use: 'only when you need multi-touch details pointer events do not give you' },
    { event: 'mouseenter / mouseleave', use: 'hover affordances, guarded by (hover: hover)' },
    { event: 'focusin / focusout', use: 'the keyboard equivalent of hover — pair them ALWAYS' },
    { event: 'keydown', use: 'Enter and Space activate; Escape dismisses; arrows navigate a widget' },
    { event: 'dblclick / contextmenu', use: 'no touch equivalent — always provide another route' },
    { event: 'passive: true listeners', use: 'on scroll/touchmove/wheel, or you block scrolling' },
  ], { columns: ['event', 'use'] });
  out.textContent =
    'POINTER EVENTS ARE THE DEFAULT. One API for mouse, touch and pen; e.pointerType tells you which;\n' +
    'setPointerCapture makes drag handling sane. Writing separate mouse and touch handlers in 2025 is\n' +
    'how you end up with double-firing bugs and a drag that breaks with a stylus.\n\n' +
    'But keep using CLICK for activation. It is not a mouse event any more — it fires for a keyboard\n' +
    'Enter or Space on a button, for a screen reader activation, and for a tap. Replacing click with\n' +
    'pointerdown to "make it feel faster" silently removes keyboard and assistive-tech support, and\n' +
    'it also fires before the user has committed (they can still drag away from a button and cancel).\n\n' +
    'THE 300ms TAP DELAY IS GONE, by the way, provided you have\n' +
    '  <meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    'That is the entire fix; the fastclick libraries are long obsolete.\n\n' +
    'And passive listeners: a non-passive touchmove or wheel listener forces the browser to wait for\n' +
    'your handler before scrolling, because you might call preventDefault. Add { passive: true } to\n' +
    'anything that does not, and scrolling stays on the compositor.';
});

on('targets', () => {
  const btns = [...document.querySelectorAll('button')];
  const small = btns.filter((b) => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height) < 24; });
  renderTable('#results', [
    { guideline: 'WCAG 2.5.8 (AA)', size: '24 × 24 CSS px', note: 'unless there is 24px of spacing around it' },
    { guideline: 'WCAG 2.5.5 (AAA)', size: '44 × 44', note: 'also Apple\'s guidance' },
    { guideline: 'Material', size: '48 × 48', note: 'roughly a fingertip with margin' },
    { guideline: 'TV / remote', size: 'much larger, plus a strong focus style', note: 'you are 3m away' },
    { guideline: 'this page', size: `${btns.length} buttons, ${small.length} under 24px`, note: small.length ? 'fix them' : 'fine' },
  ], { columns: ['guideline', 'size', 'note'] });
  out.textContent =
    'SPACING MATTERS AS MUCH AS SIZE. WCAG 2.5.8 exempts a small target that has 24px of clear space\n' +
    'around it, which tells you what the real failure is: a row of tiny icon buttons packed\n' +
    'together, where the cost of a mis-tap is hitting the wrong action rather than nothing.\n\n' +
    'Cheap fixes that do not change the design:\n' +
    '  · PADDING on the interactive element (padding is part of the target; margin on a wrapper is\n' +
    '    not)\n' +
    '  · a ::before with negative insets to extend the hit area invisibly\n' +
    '  · make the whole row or card the target instead of the icon inside it\n\n' +
    'And design for the THUMB, not the cursor: on a phone held one-handed, the top corners are the\n' +
    'hardest place to reach and the bottom third is the easiest. Primary actions belong low; a\n' +
    'destructive action belongs away from where the thumb rests.';
});

on('rules', () => {
  renderTable('#results', [
    { rule: 'never put functionality behind hover alone', why: 'no hover on touch; guard with (hover: hover) and pair with :focus-within' },
    { rule: 'pair every :hover with :focus-visible', why: 'the keyboard equivalent, and it is free' },
    { rule: 'use pointer events, keep click for activation', why: 'one code path; click is input-agnostic' },
    { rule: 'no dblclick or right-click as the only route', why: 'no touch equivalent' },
    { rule: 'targets ≥ 24px, with spacing', why: 'WCAG 2.5.8' },
    { rule: 'passive listeners on scroll/touch/wheel', why: 'or you block the compositor' },
    { rule: 'design for the last-used input, not the device', why: 'devices change input mid-session' },
    { rule: 'test with the mouse unplugged', why: 'it finds most of these in five minutes' },
    { rule: 'never branch on the user agent', why: 'it has been wrong for twenty years' },
  ], { columns: ['rule', 'why'] });
  out.textContent =
    'THE HOVER RULE IS THE ONE THAT COSTS REAL MONEY. "Actions appear on hover" is a beautiful\n' +
    'desktop pattern and a dead end on a phone — the actions are simply unreachable, and the user\n' +
    'concludes the feature does not exist.\n\n' +
    'The fix is three lines:\n\n' +
    '  .card .actions { opacity: 1; }                       /* default: visible */\n' +
    '  @media (hover: hover) and (pointer: fine) {\n' +
    '    .card .actions { opacity: 0; }                     /* hide ONLY where hover exists */\n' +
    '    .card:hover .actions, .card:focus-within .actions { opacity: 1; }\n' +
    '  }\n\n' +
    'Note the direction: VISIBLE IS THE DEFAULT, and hiding is the enhancement for devices that can\n' +
    'reveal it again. Writing it the other way round is how the touch case gets forgotten.\n\n' +
    'And the five-minute test that finds nearly all of this: UNPLUG YOUR MOUSE and use your app. Then\n' +
    'open it on a phone. Then try it with only the Tab key. Three passes, fifteen minutes, and you\n' +
    'will have a real list.';
});
