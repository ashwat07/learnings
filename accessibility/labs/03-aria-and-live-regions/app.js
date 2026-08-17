// Lab 03 — ARIA & live regions.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
let count = 0;

const announce = (region, text) => {
  const el = $(`#live-${region}`);
  // Clearing first forces a change even when the text is identical — otherwise a repeated
  // "Added to cart" is announced once and then never again.
  el.textContent = '';
  setTimeout(() => { el.textContent = text; }, 50);
};

on('add', () => { count++; $('count').textContent = count; log.line(`cart = ${count}`); });

on('silent', () => {
  count++; $('count').textContent = count;
  log.bad('DOM updated, nothing announced');
  out.textContent =
    'The number changed. A screen reader said nothing, because nothing about the user\'s point of\n' +
    'attention changed — they are somewhere else in the document, and the browser does not narrate\n' +
    'arbitrary DOM mutations.\n\n' +
    'This is the default for every asynchronous update in your app: a toast, a validation message,\n' +
    'a "saved" indicator, a filtered result count, an item added to a cart. All silent unless you\n' +
    'do something.';
});

on('polite', () => {
  count++; $('count').textContent = count;
  announce('polite', `${count} items in cart`);
  log.ok('announced politely');
  out.textContent =
    'aria-live="polite" queues the announcement until the reader finishes what it is saying. That\n' +
    'is what you want for ~95% of updates.\n\n' +
    'The mechanics that make live regions actually work, each of which is a bug when missed:\n\n' +
    '  · THE REGION MUST EXIST IN THE DOM BEFORE THE CHANGE, and be empty. Inserting a div that\n' +
    '    already contains the text is usually NOT announced — the reader is watching an existing\n' +
    '    node for mutations.\n' +
    '  · aria-atomic="true" reads the whole region. Without it, only the changed node is read,\n' +
    '    which for "3 items" can announce a bare "3".\n' +
    '  · Announcing the SAME text twice needs a clear-then-set (see announce() in this file), or\n' +
    '    the second one is silently dropped as "no change".\n' +
    '  · Keep it visually hidden with the .visually-hidden pattern, NOT display:none or\n' +
    '    visibility:hidden — both remove it from the accessibility tree entirely.';
});

on('assertive', () => {
  announce('assertive', 'Session expiring in one minute');
  log.bad('announced assertively — it interrupted');
  out.textContent =
    'aria-live="assertive" INTERRUPTS whatever the reader was saying, mid-word.\n\n' +
    'Reserve it for things the user must know immediately: a session about to expire, a payment\n' +
    'that failed, data loss. Everything else is polite.\n\n' +
    'Using assertive for routine updates is the accessibility equivalent of an all-caps email. It\n' +
    'is also actively harmful: it can cut off the announcement of the thing the user was actually\n' +
    'reading, so they lose information rather than gaining it.\n\n' +
    '(role="alert" is assertive by definition, which is why it should be rare too.)';
});

on('status', () => {
  $('#live-status').textContent = `Saved at ${new Date().toLocaleTimeString()}`;
  log.ok('role="status" — polite, and visible');
  out.textContent =
    'role="status" is an implicit aria-live="polite" region, and it is usually the right choice for\n' +
    'a toast or a "saved" indicator because it is BOTH visible and announced.\n\n' +
    'The related roles:\n' +
    '  role="status"   polite. Saved, copied, 12 results.\n' +
    '  role="alert"    assertive. Errors, session expiry. Interrupts.\n' +
    '  role="log"      polite, appends — chat messages, a console.\n' +
    '  role="timer"    a live counter. Almost always aria-live="off" in practice, because a clock\n' +
    '                  announcing every second is unusable.\n\n' +
    'A toast that disappears after 4 seconds has a second problem beyond announcement: a screen\n' +
    'reader user may still be listening, and someone with a cognitive or motor disability may not\n' +
    'have finished reading. WCAG 2.2.1 wants it dismissible, pausable, or persistent. If a toast\n' +
    'carries an action ("Undo"), it must be reachable — and a toast that vanishes is not.';
});

on('busy', async () => {
  const region = $('#live-status');
  region.textContent = 'Searching…';
  log.muted('searching…');
  await new Promise((r) => setTimeout(r, 1200));
  region.textContent = '7 results found';
  log.ok('announced the RESULT, not the process');
  out.textContent =
    'Announce the OUTCOME, not the mechanics. "7 results found" is useful; "loading, loading,\n' +
    'loading" is noise.\n\n' +
    'A rule of thumb for async work:\n' +
    '  · under ~1s: announce only the result\n' +
    '  · longer: one "Searching…" then the result — and use aria-busy="true" on the region you are\n' +
    '    replacing, so the reader knows it is mid-update\n' +
    '  · progress that matters: role="progressbar" with aria-valuenow, updated at sensible\n' +
    '    intervals — not on every percent\n\n' +
    'And the thing to check on any list that updates as you type: does it announce the COUNT? A\n' +
    'combobox filtering to 3 results should say so. That single announcement is often the\n' +
    'difference between a usable autocomplete and one that has to be abandoned.';
});

on('naming', () => {
  renderTable('#results', [
    { source: 'aria-labelledby', wins: '1st', example: '<div role="dialog" aria-labelledby="t"><h2 id="t">Settings</h2>' },
    { source: 'aria-label', wins: '2nd', example: '<button aria-label="Close">×</button>' },
    { source: 'the element\'s own content', wins: '3rd', example: '<button>Save</button>' },
    { source: '<label for>', wins: 'for form controls', example: '<label for="n">Name</label><input id="n">' },
    { source: 'title attribute', wins: 'last resort', example: 'do not rely on it — not shown on touch, poorly supported' },
    { source: 'placeholder', wins: 'NOT a name', example: 'it disappears when you type; it is a hint, not a label' },
  ], { columns: ['source', 'wins', 'example'] });
  out.textContent =
    'Two failures worth naming explicitly:\n\n' +
    '1. PLACEHOLDER IS NOT A LABEL. It disappears exactly when the user needs it (while typing),\n' +
    '   it usually fails contrast requirements, and several readers do not announce it at all.\n' +
    '   Every input needs a real <label>, even if you visually hide it.\n\n' +
    '2. aria-label OVERRIDES THE VISIBLE TEXT — and if the two disagree, voice control breaks. A\n' +
    '   button reading "Save" with aria-label="Submit form" cannot be activated by saying "click\n' +
    '   Save", which is exactly what the user sees. WCAG 2.5.3 (Label in Name) requires the\n' +
    '   accessible name to CONTAIN the visible text.\n\n' +
    'The practical rule: prefer visible text as the name. Use aria-labelledby to point at existing\n' +
    'visible text. Use aria-label only when there is genuinely no visible text (an icon button) —\n' +
    'and then make it match what a user would call the thing.\n\n' +
    'Check your work in DevTools: the Accessibility pane shows the computed name and where it came\n' +
    'from. That panel settles arguments in seconds.';
});

on('state', () => {
  renderTable('#results', [
    { attr: 'aria-expanded', on: 'the trigger, not the panel', note: 'the single most commonly missed attribute' },
    { attr: 'aria-selected', on: 'tabs, options', note: 'selection within a set' },
    { attr: 'aria-checked', on: 'custom checkboxes/radios/switches', note: 'use <input> if you possibly can' },
    { attr: 'aria-current="page"', on: 'the active nav link', note: 'better than aria-selected for navigation' },
    { attr: 'aria-disabled', on: 'anything you want focusable but inert', note: 'unlike [disabled], it stays reachable — often better UX' },
    { attr: 'aria-describedby', on: 'the control', note: 'points at hint text or an error message' },
    { attr: 'aria-controls', on: 'the trigger', note: 'weak support; harmless, rarely load-bearing' },
    { attr: 'aria-hidden="true"', on: 'decorative content', note: 'NEVER on anything focusable — you create an element that is reachable but unnamed' },
  ], { columns: ['attr', 'on', 'note'] });
  out.textContent =
    'aria-expanded is worth singling out. Every disclosure, accordion, dropdown, hamburger menu and\n' +
    'combobox needs it, on the TRIGGER, updated when the state changes. Without it, a screen reader\n' +
    'user cannot tell whether the thing is open — they activate it and hear nothing different.\n\n' +
    'And the last row is a real bug generator: aria-hidden="true" on a container that contains a\n' +
    'focusable element produces an element that is IN the tab order and has NO accessible name.\n' +
    'The user tabs to something that announces nothing. If you want to hide something, use the\n' +
    'inert attribute (which removes focusability too) or hidden/display:none.';
});

on('rules', () => {
  renderTable('#results', [
    { n: 1, rule: 'Use a native element instead, if one exists', why: 'you get role, state, focus and keyboard for free' },
    { n: 2, rule: 'Do not change native semantics', why: '<button role="heading"> means you now owe the button behaviour to nobody' },
    { n: 3, rule: 'All interactive ARIA controls must be keyboard-operable', why: 'a role is a promise about behaviour' },
    { n: 4, rule: 'Do not use aria-hidden or role="presentation" on a focusable element', why: 'you create a reachable, unnamed control' },
    { n: 5, rule: 'Every interactive element needs an accessible name', why: '"button" with no name is unusable' },
  ], { columns: ['n', 'rule', 'why'] });
  out.textContent =
    'These are the W3C\'s own five rules, and they compress to: A ROLE IS A PROMISE ABOUT\n' +
    'BEHAVIOUR THAT YOU MUST THEN KEEP.\n\n' +
    'role="tablist" promises arrow-key navigation. role="menu" promises the menu keyboard contract\n' +
    '(and menu is for APPLICATION menus, not for a list of links — a nav is a nav). role="grid"\n' +
    'promises a two-dimensional keyboard model. Claiming the role without implementing the contract\n' +
    'is worse than using a plain list, because you have told the user to expect something.\n\n' +
    'Which is why the data is so consistently damning: surveys of the top million home pages find\n' +
    'that pages USING ARIA average MORE detected errors than pages using none. Not because ARIA is\n' +
    'bad — because it is used to paper over the wrong element.\n\n' +
    'Before you write any ARIA, ask: is there an element for this? <button>, <a href>, <details>,\n' +
    '<dialog>, <input type="checkbox">, <select>, <output>, <progress>. If yes, use it and stop.';
});
