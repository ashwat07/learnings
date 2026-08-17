// Lab 01 — Semantics.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

on('tabtest', () => {
  const focusable = [...document.querySelectorAll(
    'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable]')]
    .filter((el) => el.closest('.side'));
  renderTable('#results', focusable.map((el, i) => ({
    stop: i + 1,
    element: `<${el.tagName.toLowerCase()}>`,
    side: el.closest('.demo').querySelector('h2').textContent,
    name: el.getAttribute('aria-label') ?? el.textContent.trim().slice(0, 24) ?? '(no name)',
  })), { columns: ['stop', 'element', 'side', 'name'] });
  out.textContent =
    'Tab through the page yourself. The div "Save" and the div "Go to settings" are NOT tab stops —\n' +
    'a keyboard user cannot reach them at all, and neither can anyone using a switch, voice control\n' +
    'or a screen reader\'s element navigation.\n\n' +
    'That is not a styling problem or an ARIA problem. It is the element: <button> and <a href> are\n' +
    'in the tab order by definition; <div> is not, ever.\n\n' +
    'And notice the contenteditable span IS focusable — which is worse than being unreachable,\n' +
    'because it is announced as arbitrary editable content with no label, no role and no validation.';
});

on('tree', () => {
  renderTable('#results', [
    { element: '<div onclick>', role: 'generic', name: 'from contents, if reached', focusable: 'NO', keyboard: 'nothing' },
    { element: '<div role="button">', role: 'button', name: 'from contents', focusable: 'NO (needs tabindex="0")', keyboard: 'you write Enter AND Space' },
    { element: '<button>', role: 'button', name: 'from contents', focusable: 'yes', keyboard: 'Enter + Space, free' },
    { element: '<span> styled big', role: 'generic', name: '—', focusable: 'NO', keyboard: '—' },
    { element: '<h3>', role: 'heading, level 3', name: 'from contents', focusable: 'no (by design)', keyboard: 'reachable by the H key in a reader' },
    { element: '<div> list', role: 'generic ×3', name: '—', focusable: 'no', keyboard: '—' },
    { element: '<ul><li>', role: 'list, listitem', name: '—', focusable: 'no', keyboard: 'announced as "list, 3 items"' },
    { element: '<span onclick>', role: 'generic', name: '—', focusable: 'NO', keyboard: 'nothing' },
    { element: '<a href>', role: 'link', name: 'from contents', focusable: 'yes', keyboard: 'Enter, free' },
  ], { columns: ['element', 'role', 'name', 'focusable', 'keyboard'] });

  out.textContent =
    'Every row on the left costs you something specific. Look at the fourth column especially: the\n' +
    'difference between "role: button" and "actually a button" is FOCUSABILITY AND BEHAVIOUR, and\n' +
    'ARIA gives you neither. ARIA changes what an element is CALLED, never what it DOES.\n\n' +
    'That is the whole reason for the first rule of ARIA: no ARIA is better than bad ARIA. A\n' +
    'div with role="button" announces itself as a button and then does nothing when you press\n' +
    'Space — which is worse than a div that never claimed to be one.\n\n' +
    'Two more things the tree gives you for free, which people rebuild badly:\n' +
    '  · "list, 3 items" — the COUNT. A screen reader user knows how long the list is before\n' +
    '    reading it. Div soup cannot express that at any price.\n' +
    '  · headings as a navigable outline. Most screen reader users navigate by heading FIRST, not\n' +
    '    by reading top to bottom, which is why a page of styled spans is genuinely unusable even\n' +
    '    when every word is present.';
});

on('landmarks', () => {
  renderTable('#results', [
    { element: '<header>', role: 'banner', use: 'the page header (only one per page)' },
    { element: '<nav>', role: 'navigation', use: 'each nav; label them if there is more than one' },
    { element: '<main>', role: 'main', use: 'THE most valuable one — "skip to main" targets it' },
    { element: '<aside>', role: 'complementary', use: 'sidebars' },
    { element: '<footer>', role: 'contentinfo', use: 'the page footer' },
    { element: '<section aria-labelledby>', role: 'region', use: 'only when it has an accessible name' },
    { element: '<article>', role: 'article', use: 'a self-contained item — a post, a card' },
    { element: '<form aria-label>', role: 'form', use: 'a named form' },
  ], { columns: ['element', 'role', 'use'] });
  out.textContent =
    'Landmarks are how a screen reader user skips your header for the 400th time. NVDA has a "D"\n' +
    'key for them; VoiceOver has the rotor. A page with no landmarks forces a linear read of the\n' +
    'navigation on every single page load.\n\n' +
    'HEADINGS ARE AN OUTLINE, NOT A SIZE. h1 → h2 → h3, no skipped levels, one h1 per page that\n' +
    'names what the page is. If a heading is the wrong size, that is CSS. The single most common\n' +
    'real-world accessibility bug is a heading level chosen for its font size.\n\n' +
    'The five-minute audit that finds most structural problems:\n' +
    '  1. Turn off CSS entirely. Does the page still read in a sensible order?\n' +
    '  2. List the headings (DevTools: $$("h1,h2,h3,h4").map(h => h.tagName + " " + h.textContent)).\n' +
    '     Is it a coherent table of contents?\n' +
    '  3. Is there exactly one <main>, and does a "skip to content" link target it?\n' +
    '  4. Tab through. Can you reach everything, and can you SEE where you are?';
});

on('cost', () => {
  out.textContent =
    'THE COST OF <div role="button" tabindex="0" onclick={...}>, itemised:\n\n' +
    '  · keydown for Enter AND Space (Space also scrolls the page — you must preventDefault)\n' +
    '  · a visible :focus-visible style, because you lost the UA one\n' +
    '  · disabled state: aria-disabled, plus actually blocking the handler, plus removing it from\n' +
    '    the tab order (or not — aria-disabled keeps it focusable on purpose, which is often better)\n' +
    '  · form participation: none. It will never submit a form.\n' +
    '  · type="button" semantics: a real <button> inside a <form> defaults to SUBMIT, which is a\n' +
    '    bug you avoid by writing type="button" — a div cannot even have that bug, but it also\n' +
    '    cannot participate\n' +
    '  · Windows High Contrast Mode: native controls adapt, your div does not\n' +
    '  · voice control: "click Save" works on a real button because the accessible name matches the\n' +
    '    visible label. It fails on a div with no role.\n\n' +
    'That is roughly 20 lines of code and four bugs to reproduce something the platform gives you\n' +
    'for one word. And the reason people do it is almost always styling — for which the answer is\n' +
    '  button { all: unset; } /* then style it deliberately */\n' +
    'or simply appearance: none plus your own styles. A button can look like anything.\n\n' +
    'WHEN A DIV IS ACTUALLY RIGHT: when the thing is genuinely not a button, a link or a form\n' +
    'control — a layout wrapper, a decorative container. Semantics are about MEANING, and inventing\n' +
    'meaning that is not there is its own bug (see role="application", which turns off almost every\n' +
    'screen reader shortcut and is almost never what you want).';
});
