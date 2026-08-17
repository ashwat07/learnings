// Lab 02 — Keyboard & focus.

import { $, on, $$, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

// A live focus log: the single most useful debugging aid for this whole topic.
addEventListener('focusin', (e) => {
  const el = e.target;
  $('#focuslog').textContent =
    `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} — name: "${(el.getAttribute('aria-label') || el.textContent || el.value || '').trim().slice(0, 30)}"`;
});

// ---------------------------------------------------------------------------
// The bad modal: no focus move, no trap, no Escape, no return.
// ---------------------------------------------------------------------------
on('open-bad', () => {
  $('#bad-modal').hidden = false;
  log.bad('opened a modal and did nothing about focus');
  out.textContent =
    'The dialog is on screen. Now press Tab, without touching the mouse.\n\n' +
    'Focus is still behind the dialog, moving through the page underneath — content the user cannot\n' +
    'see and, visually, is not supposed to be able to reach. A screen reader user has no idea a\n' +
    'dialog opened at all: nothing was announced, because nothing about their point of attention\n' +
    'changed.\n\n' +
    'This is the single most common serious accessibility bug in single-page apps, and every part\n' +
    'of the fix is mechanical:\n' +
    '  1. move focus INTO the dialog when it opens\n' +
    '  2. keep it there while it is open (a trap)\n' +
    '  3. Escape closes\n' +
    '  4. RETURN focus to the element that opened it\n' +
    '  5. make the rest of the page inert\n\n' +
    'You do not have to write any of that: <dialog>.showModal() does all five.';
});
on('bad-close', () => { $('#bad-modal').hidden = true; });

// ---------------------------------------------------------------------------
// The good modal: the platform does the work.
// ---------------------------------------------------------------------------
on('open-good', () => {
  const dlg = $('#good-modal');
  dlg.showModal();
  log.ok('showModal(): focus moved, trapped, inert background, Escape wired, focus returns on close');
  out.textContent =
    'Tab around: you cannot leave the dialog. Press Escape: it closes and focus RETURNS to the\n' +
    'button you opened it with. None of that is code in this lab.\n\n' +
    '<dialog>.showModal() gives you:\n' +
    '  · focus moved into the dialog (to the first focusable element, or [autofocus])\n' +
    '  · a focus trap, enforced by the browser rather than by your keydown handler\n' +
    '  · the rest of the document made INERT — not just unfocusable, but invisible to assistive\n' +
    '    tech and unclickable, which is what aria-hidden alone does not achieve\n' +
    '  · Escape to close (the "cancel" event, which you can preventDefault if you must)\n' +
    '  · focus returned to the previously focused element on close\n' +
    '  · ::backdrop for styling\n\n' +
    'Compare with the hand-rolled version: a Tab keydown handler enumerating focusable elements\n' +
    '(a selector that is famously wrong in edge cases — disabled, hidden, details, iframes,\n' +
    'shadow DOM, tabindex ordering), plus aria-modal, plus manual focus restoration, plus an\n' +
    'inert polyfill. That is the code every "focus trap" npm package exists to hold, and it is\n' +
    'now a browser feature.';
});
on('good-close', () => $('#good-modal').close());

// ---------------------------------------------------------------------------
// outline: none — the most damaging one-line stylesheet in the world.
// ---------------------------------------------------------------------------
on('hide-focus', () => {
  document.body.classList.toggle('nofocus');
  const off = document.body.classList.contains('nofocus');
  log[off ? 'bad' : 'ok'](`outline: none is ${off ? 'ON' : 'off'}`);
  out.textContent = off
    ? 'Now tab around. You are still moving focus; you simply cannot see where it is.\n\n' +
      'For a sighted keyboard user this is the difference between a usable app and an unusable one,\n' +
      'and it is a WCAG 2.4.7 failure. It is also, by a wide margin, the most common accessibility\n' +
      'regression introduced by a designer asking to "remove that blue ring".\n\n' +
      'The answer is never outline: none on its own. It is:\n\n' +
      '  :focus-visible { outline: 2px solid #6cf; outline-offset: 2px; }\n\n' +
      ':focus-visible is the browser\'s own heuristic for "this user is navigating by keyboard" —\n' +
      'so mouse clicks do not show a ring and keyboard navigation does. It is exactly the behaviour\n' +
      'people were trying to get when they reached for outline: none.\n\n' +
      'Two more details: give the ring an offset so it is visible against the component, and make\n' +
      'sure it has 3:1 contrast against BOTH the component and the background (WCAG 2.4.11).'
    : 'Focus is visible again. Leave it that way.';
});

// ---------------------------------------------------------------------------
// Roving tabindex.
// ---------------------------------------------------------------------------
const tabs = $$('#tabs [role="tab"]');
on($('#tabs'), 'keydown', (e) => {
  const i = tabs.indexOf(document.activeElement);
  if (i < 0) return;
  let next = null;
  if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
  if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
  if (e.key === 'Home') next = 0;
  if (e.key === 'End') next = tabs.length - 1;
  if (next == null) return;
  e.preventDefault();
  // Roving tabindex: exactly one element in the group is tabbable at a time.
  tabs.forEach((t, j) => {
    t.tabIndex = j === next ? 0 : -1;
    t.setAttribute('aria-selected', String(j === next));
  });
  tabs[next].focus();
});

// ---------------------------------------------------------------------------
// SPA route change: the classic silent failure.
// ---------------------------------------------------------------------------
on('route', () => {
  log.head('— simulating a client-side navigation —');
  const heading = document.createElement('h2');
  heading.textContent = 'New page content (focus moved here)';
  heading.tabIndex = -1;              // programmatically focusable, NOT a tab stop
  $('#results').replaceChildren(heading);
  document.title = 'New page — Lab 02';
  heading.focus();
  out.textContent =
    'A client-side route change replaces the content but changes nothing about focus, the document\n' +
    'title, or the scroll position — unless you do it yourself. The browser does all three on a\n' +
    'real navigation; a router does none of them.\n\n' +
    'For a screen reader user, an SPA navigation with no focus management is SILENT: they activate\n' +
    'a link, and as far as their point of attention is concerned nothing happened. They are still\n' +
    'on the old element, in a page that no longer exists.\n\n' +
    'The recipe, on every route change:\n' +
    '  1. UPDATE document.title — this is what most readers announce on navigation\n' +
    '  2. MOVE FOCUS to the new page\'s <h1> (with tabindex="-1" so it is programmatically\n' +
    '     focusable but not a tab stop), or to a skip-link target\n' +
    '  3. RESET SCROLL to the top (routers often restore the old position)\n' +
    '  4. Optionally announce the route name in a live region as a belt-and-braces\n\n' +
    'Note tabindex="-1": it means "focusable by script, not by Tab". tabindex="0" means "in the\n' +
    'natural tab order". A POSITIVE tabindex means "jump the queue", breaks the DOM-order\n' +
    'relationship every user relies on, and is essentially never correct.';
});

on('rules', () => {
  renderTable('#results', [
    { rule: 'everything interactive is reachable by Tab', check: 'unplug the mouse and use the app' },
    { rule: 'focus is always VISIBLE', check: ':focus-visible with 3:1 contrast, never bare outline:none' },
    { rule: 'tab order follows visual order', check: 'no positive tabindex; be careful with CSS order/grid reordering' },
    { rule: 'dialogs trap focus and return it', check: 'use <dialog>.showModal()' },
    { rule: 'nothing steals focus unexpectedly', check: 'no autofocus on load in a long page; no focus() on a background update' },
    { rule: 'composite widgets are ONE tab stop', check: 'roving tabindex + arrow keys (tabs, menus, grids, toolbars)' },
    { rule: 'route changes move focus and title', check: 'the SPA recipe above' },
    { rule: 'Escape closes the topmost layer', check: 'and only the topmost' },
    { rule: 'no keyboard traps', check: 'you can always Tab back OUT of a widget (WCAG 2.1.2)' },
  ], { columns: ['rule', 'check'] });
  out.textContent =
    'The one that surprises people: COMPOSITE WIDGETS SHOULD BE ONE TAB STOP. A toolbar with 12\n' +
    'buttons, each tabbable, means 12 presses to get past it. The ARIA Authoring Practices pattern\n' +
    'is roving tabindex — Tab enters the group, arrow keys move within it, Tab leaves. Try the tabs\n' +
    'above.\n\n' +
    'And the one people get wrong in the other direction: a MENU is not a tablist is not a listbox\n' +
    'is not a toolbar. Each has a defined keyboard contract in the APG, and picking the wrong role\n' +
    'promises behaviour you have not implemented. If you are unsure, use links and buttons in a\n' +
    '<nav>: boring, and correct.\n\n' +
    'Read the ARIA Authoring Practices Guide patterns before building any of them. It is the\n' +
    'closest thing to a specification for widget keyboard behaviour, and the expected keys are not\n' +
    'guessable.';
});
