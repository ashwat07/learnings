// Lab 06 — Testing & architecture.
//
// A ~60-line auditor. It is not axe-core; it implements a handful of the checks axe implements
// hundreds of, so you can see the SHAPE of the ones a machine can do — and, by their narrowness,
// the shape of the ones it cannot.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

const CHECKS = [
  {
    id: 'image-alt',
    run: (doc) => [...doc.querySelectorAll('img:not([alt])')]
      .map((el) => `<img src="${(el.getAttribute('src') || '').slice(0, 40)}"> has no alt attribute`),
  },
  {
    id: 'label',
    run: (doc) => [...doc.querySelectorAll('input:not([type=hidden]), select, textarea')]
      .filter((el) => !el.labels?.length && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby'))
      .map((el) => `<${el.tagName.toLowerCase()} id="${el.id || '?'}"> has no accessible name`),
  },
  {
    id: 'button-name',
    run: (doc) => [...doc.querySelectorAll('button, a[href]')]
      .filter((el) => !el.textContent.trim() && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby') && !el.querySelector('img[alt]:not([alt=""])'))
      .map((el) => `<${el.tagName.toLowerCase()}> has no accessible name`),
  },
  {
    id: 'heading-order',
    run: (doc) => {
      const levels = [...doc.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => Number(h.tagName[1]));
      const issues = [];
      levels.forEach((l, i) => { if (i && l > levels[i - 1] + 1) issues.push(`heading jumps from h${levels[i - 1]} to h${l}`); });
      if (doc.querySelectorAll('h1').length !== 1) issues.push(`${doc.querySelectorAll('h1').length} <h1> elements (expected 1)`);
      return issues;
    },
  },
  {
    id: 'html-lang',
    run: (doc) => (doc.documentElement.getAttribute('lang') ? [] : ['<html> has no lang attribute']),
  },
  {
    id: 'landmark-main',
    run: (doc) => (doc.querySelector('main, [role=main]') ? [] : ['no <main> landmark']),
  },
  {
    id: 'aria-hidden-focus',
    run: (doc) => [...doc.querySelectorAll('[aria-hidden="true"]')]
      .filter((el) => el.querySelector('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'))
      .map(() => 'an aria-hidden element contains a focusable element'),
  },
  {
    id: 'positive-tabindex',
    run: (doc) => [...doc.querySelectorAll('[tabindex]')]
      .filter((el) => Number(el.getAttribute('tabindex')) > 0)
      .map((el) => `<${el.tagName.toLowerCase()} tabindex="${el.getAttribute('tabindex')}"> — positive tabindex`),
  },
  {
    id: 'duplicate-id',
    run: (doc) => {
      const seen = new Set(), dupes = new Set();
      for (const el of doc.querySelectorAll('[id]')) (seen.has(el.id) ? dupes : seen).add(el.id);
      return [...dupes].map((id) => `duplicate id="${id}" — breaks label/for and aria-labelledby`);
    },
  },
];

async function audit(doc, label) {
  const findings = CHECKS.flatMap((c) => c.run(doc).map((detail) => ({ check: c.id, detail })));
  renderTable('#results', findings.length ? findings.map((f) => ({ ...f, _detailClass: 'no' }))
    : [{ check: '—', detail: 'no violations found by these 9 checks' }], { columns: ['check', 'detail'] });
  log[findings.length ? 'bad' : 'ok'](`${label}: ${findings.length} finding(s)`);
  return findings;
}

on('audit', () => audit(document, 'this page').then(() => {
  out.textContent =
    'Nine checks. axe-core implements around a hundred, and between them automated tools reliably\n' +
    'detect roughly 30–40% of real accessibility issues.\n\n' +
    'That number is not a criticism of the tools — it is a statement about what is machine-checkable.\n' +
    'A machine can tell that an image has no alt. It cannot tell whether alt="image123.jpg" is a\n' +
    'useful description.';
}));

on('audit-bad', async () => {
  const html = await fetch('../01-semantics/').then((r) => r.text());
  const doc = new DOMParser().parseFromString(html, 'text/html');
  await audit(doc, 'lab 01');
  out.textContent =
    'Interesting result: the div-soup page produces FEW automated findings.\n\n' +
    'Nothing in it is technically invalid. The divs have no missing alt text, no unlabelled inputs,\n' +
    'no duplicate ids. A linter has nothing to complain about — and the page is unusable with a\n' +
    'keyboard.\n\n' +
    'That is the most important thing to understand about automated accessibility testing: A CLEAN\n' +
    'AXE REPORT IS NOT AN ACCESSIBLE PAGE. It means you have not made the mistakes a machine can\n' +
    'name.';
});

on('coverage', () => {
  renderTable('#results', [
    { finds: 'missing alt attributes', misses: 'whether the alt text is USEFUL' },
    { finds: 'contrast below 4.5:1', misses: 'text in an image, or gradient/overlay backgrounds' },
    { finds: 'unlabelled form fields', misses: 'a label that says the wrong thing' },
    { finds: 'missing lang, duplicate ids', misses: 'whether the reading ORDER makes sense' },
    { finds: 'invalid ARIA attributes', misses: 'ARIA that is valid and wrong' },
    { finds: 'aria-hidden on focusable content', misses: 'a focus trap, or focus lost on route change' },
    { finds: 'missing landmarks', misses: 'whether the keyboard can complete the core task' },
    { finds: 'positive tabindex', misses: 'whether the tab ORDER matches the visual order' },
  ], { columns: ['finds', 'misses'] });
  out.textContent =
    'Read the right-hand column: almost every entry is a JUDGEMENT, and that is why the coverage\n' +
    'number stalls around a third.\n\n' +
    'The rest is covered by three cheap habits, in increasing order of value:\n\n' +
    '1. THE KEYBOARD PASS. Unplug the mouse and complete the primary task. This finds more real\n' +
    '   problems per minute than any tool, and it needs no training.\n' +
    '2. THE SCREEN READER PASS. Fifteen minutes with VoiceOver or NVDA on your main flow. You will\n' +
    '   be bad at it at first; you will still find things immediately.\n' +
    '3. TESTING WITH DISABLED USERS. Nothing else tells you whether the experience is good rather\n' +
    '   than merely conformant, and it consistently surprises teams who thought they were done.\n\n' +
    'Do the first one today. It costs five minutes and it is the highest-yield accessibility\n' +
    'activity available to you.';
});

on('pipeline', () => {
  renderTable('#results', [
    { stage: 'editor', tool: 'eslint-plugin-jsx-a11y, axe DevTools extension', catches: 'the obvious, before commit' },
    { stage: 'unit / component', tool: 'jest-axe or vitest-axe on every component', catches: 'per-component regressions' },
    { stage: 'component tests', tool: 'Testing Library queries BY ROLE', catches: 'accidental semantic changes — getByRole fails when you swap a button for a div' },
    { stage: 'e2e', tool: '@axe-core/playwright on key flows, mid-flow (modals open, errors shown)', catches: 'state-dependent issues static scans never see' },
    { stage: 'CI gate', tool: 'fail on NEW violations, with a baseline', catches: 'regression without a big-bang cleanup' },
    { stage: 'manual', tool: 'keyboard + screen reader checklist per release', catches: 'the other 60%' },
    { stage: 'audit', tool: 'an external expert audit annually', catches: 'what your team has learned to stop seeing' },
  ], { columns: ['stage', 'tool', 'catches'] });
  out.textContent =
    'Two rows deserve emphasis.\n\n' +
    'TESTING LIBRARY, QUERIED BY ROLE, is a secret accessibility test. Writing\n' +
    '  getByRole("button", { name: "Save" })\n' +
    'means your test FAILS the moment someone replaces the button with a div or removes its\n' +
    'accessible name. You get semantic regression coverage from tests you were writing anyway —\n' +
    'which is why "query by role, never by test id" is worth enforcing.\n\n' +
    'AXE MID-FLOW, not just on load. Most static scans run against the initial page and therefore\n' +
    'never see your modal, your error state, your expanded menu or your loaded results — which is\n' +
    'where the interesting bugs live. Scan after each state transition in your e2e tests.\n\n' +
    'And the CI policy that actually works: BASELINE THE EXISTING VIOLATIONS, FAIL ON NEW ONES.\n' +
    'A gate that fails on 400 pre-existing issues gets disabled in a week. A gate that fails only\n' +
    'on what this PR added is one nobody argues with, and the baseline shrinks over time.';
});

on('architecture', () => {
  renderTable('#results', [
    { decision: 'a design system with accessible primitives', effect: 'the accessible path is the DEFAULT path' },
    { decision: 'no raw <div onClick> — a lint rule', effect: 'removes the single biggest category at source' },
    { decision: 'queries by role in every test', effect: 'semantics become load-bearing, so they cannot silently rot' },
    { decision: 'contrast tokens, not ad-hoc colours', effect: 'contrast is checked once, in the palette' },
    { decision: 'focus management owned by the router and the modal primitive', effect: 'nobody has to remember' },
    { decision: 'a11y acceptance criteria in the ticket', effect: 'it is scoped work, not a favour someone does at the end' },
    { decision: 'someone accountable', effect: 'the difference between a policy and an aspiration' },
  ], { columns: ['decision', 'effect'] });
  out.textContent =
    'THE ONE STRUCTURAL DECISION THAT MATTERS MOST: put accessibility in the design system, not in\n' +
    'the feature code.\n\n' +
    'If your <Button>, <Modal>, <Tabs>, <Combobox> and <Field> are correct once — labelled, focus-\n' +
    'managed, keyboard-complete, contrast-checked — then a feature team using them gets\n' +
    'accessibility without knowing any of this. If they are not, every team re-derives it, badly,\n' +
    'forever.\n\n' +
    'That reframes the whole problem. Accessibility is not a per-feature tax; it is a\n' +
    'PLATFORM PROPERTY, and platform properties are cheap when centralised and ruinous when not.\n' +
    'See design-system in architecture-and-state lab 06 — the accessibility argument is the\n' +
    'strongest argument for a design system, and usually the least-mentioned one.\n\n' +
    'Finally, the legal and commercial framing, since it is often what unlocks the budget: the\n' +
    'European Accessibility Act applies from June 2025 to a wide range of consumer digital\n' +
    'services; US ADA litigation over websites runs to thousands of cases a year; and public-sector\n' +
    'procurement in most of Europe and North America requires a conformance statement. "We will do\n' +
    'it later" is a decision with a price attached.';
});
