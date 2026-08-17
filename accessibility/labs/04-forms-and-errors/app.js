// Lab 04 — Forms & errors.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
let mode = 'bad';

const FIELDS = ['name', 'email', 'card'];
const validate = () => FIELDS
  .map((f) => ({ field: f, value: $(`#${f}`).value.trim() }))
  .filter(({ field, value }) => !value || (field === 'email' && !value.includes('@')))
  .map(({ field, value }) => ({
    field,
    message: !value
      ? `${$(`#${field}`).labels[0].textContent} is required`
      : 'Enter an email address in the format name@example.com',
  }));

function clear() {
  $('#summary').hidden = true;
  for (const f of FIELDS) {
    $(`#${f}-err`).hidden = true;
    $(`#${f}`).removeAttribute('aria-invalid');
    $(`#${f}`).setAttribute('aria-describedby', f === 'name' ? 'name-hint' : '');
  }
}

on('mode-bad', () => { mode = 'bad'; clear(); log.head('mode: broken'); out.textContent =
  'Now submit the empty form and listen.'; });
on('mode-good', () => { mode = 'good'; clear(); log.head('mode: accessible'); out.textContent =
  'Now submit the empty form and listen to the difference.'; });

on($('#form'), 'submit', (e) => {
  e.preventDefault();
  clear();
  const errors = validate();
  if (!errors.length) { log.ok('submitted'); return; }

  if (mode === 'bad') {
    // Colour only, no programmatic association, no focus move, no announcement.
    for (const { field, message } of errors) {
      $(`#${field}`).style.borderColor = '#ff7b72';
      const el = $(`#${field}-err`);
      el.textContent = message;
      el.hidden = false;
    }
    log.bad(`${errors.length} error(s) shown visually only`);
    out.textContent =
      'Three things are wrong, and each one blocks a different group of people:\n\n' +
      '1. NOTHING WAS ANNOUNCED. The user pressed Pay and, as far as a screen reader is concerned,\n' +
      '   nothing happened. Focus is still on the button.\n' +
      '2. THE ERROR TEXT IS NOT ASSOCIATED WITH ITS FIELD. Tabbing to "Full name" announces "Full\n' +
      '   name, edit text" — the error sitting visually below it is a separate, unrelated node.\n' +
      '3. THE ERROR IS SIGNALLED BY COLOUR (a red border). WCAG 1.4.1: colour must never be the\n' +
      '   only means of conveying information. Roughly 1 in 12 men has a colour vision deficiency,\n' +
      '   and nobody using a screen reader sees a border at all.\n\n' +
      'Switch to the accessible version and submit again.';
  } else {
    // The accessible version: association, invalid state, a summary, and focus.
    for (const { field, message } of errors) {
      const input = $(`#${field}`);
      const err = $(`#${field}-err`);
      err.textContent = message;
      err.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      // describedby chains: the hint AND the error, in the order they should be read.
      const hint = field === 'name' ? 'name-hint ' : '';
      input.setAttribute('aria-describedby', `${hint}${field}-err`);
    }
    const summary = $('#summary');
    summary.innerHTML = `<strong>There ${errors.length === 1 ? 'is 1 problem' : `are ${errors.length} problems`} with this form</strong>` +
      `<ul>${errors.map((e2) => `<li><a href="#${e2.field}">${e2.message}</a></li>`).join('')}</ul>`;
    summary.hidden = false;
    summary.focus();                     // tabindex="-1" + role="alert"
    log.ok(`${errors.length} error(s): summary announced, focus moved, each field associated`);
    out.textContent =
      'Four mechanisms, and they map one-to-one onto the failures in the broken version:\n\n' +
      '  aria-invalid="true"        the field announces itself as invalid\n' +
      '  aria-describedby           the error text is READ WITH THE FIELD when you tab to it — this\n' +
      '                             is the single most important one\n' +
      '  an ERROR SUMMARY at the top, focused on submit, with links to each field. Announced\n' +
      '                             because focus moved to it; navigable because they are links.\n' +
      '  an icon or text prefix     so the error is not signalled by colour alone\n\n' +
      'The summary pattern comes from the GOV.UK Design System, and it is the best-tested error\n' +
      'pattern in existence: it works for screen readers (focus moves, so it is announced), for\n' +
      'sighted keyboard users (links jump to the field), for people with cognitive disabilities\n' +
      '(all the problems in one place), and on a small screen (you do not have to hunt).\n\n' +
      'Tab into a field now and listen: "Full name, edit text, invalid data, As it appears on your\n' +
      'card, Full name is required."';
  }
});

on('autocomplete', () => {
  renderTable('#results', [
    { attr: 'autocomplete="name" / "email" / "tel"', gives: 'the browser fills it; assistive tech gets purpose (WCAG 1.3.5)' },
    { attr: 'autocomplete="cc-number" / "cc-exp"', gives: 'card autofill — a large measurable conversion gain' },
    { attr: 'autocomplete="one-time-code"', gives: 'iOS/Android offer the SMS code above the keyboard' },
    { attr: 'type="email" / "tel" / "url"', gives: 'the right mobile keyboard, plus native validation' },
    { attr: 'inputmode="numeric"', gives: 'a numeric keypad WITHOUT the spinner and validation of type=number' },
    { attr: 'type="number"', gives: 'rarely what you want — it strips leading zeros and scroll-wheels' },
    { attr: 'enterkeyhint="next" / "send"', gives: 'a labelled Enter key on mobile' },
  ], { columns: ['attr', 'gives'] });
  out.textContent =
    'autocomplete is an accessibility requirement, not a convenience. WCAG 2.1 added 1.3.5 (Identify\n' +
    'Input Purpose) specifically so that assistive tech can present familiar fields in a user\'s\n' +
    'preferred way — icons, their own vocabulary, autofill from a personal profile. For someone with\n' +
    'a motor disability, autofill can be the difference between a 30-second checkout and a\n' +
    'ten-minute one.\n\n' +
    'And type="number" deserves its warning: it strips leading zeros, allows "e" and "+", scrolls\n' +
    'when the wheel passes over it, and rejects perfectly good input like a phone number with\n' +
    'spaces. For anything that is a NUMERAL rather than a QUANTITY (card, phone, postcode, OTP),\n' +
    'use type="text" with inputmode="numeric".';
});

on('checklist', () => {
  renderTable('#results', [
    { item: 'every input has a <label for>', why: 'placeholder is not a label' },
    { item: 'labels are clickable and hit the field', why: 'a much bigger touch target, for free' },
    { item: 'required marked with `required` AND in the label text', why: 'an asterisk alone is not announced meaningfully' },
    { item: 'errors: aria-invalid + aria-describedby + text + icon', why: 'never colour alone' },
    { item: 'an error summary, focused, with links', why: 'the GOV.UK pattern; the best-tested one there is' },
    { item: 'validate on BLUR and on submit, not on every keystroke', why: 'per-keystroke errors announce "invalid" while you are still typing' },
    { item: 'do not disable the submit button', why: 'a disabled button gives no reason and is often unfocusable' },
    { item: 'group related fields in <fieldset><legend>', why: 'radio groups and address blocks need a group name' },
    { item: 'autocomplete on everything the browser knows', why: 'WCAG 1.3.5, and conversion' },
    { item: 'inputs are at least 24×24 CSS px of target', why: 'WCAG 2.5.8 target size' },
    { item: 'errors survive a page reload / back button', why: 'losing 20 fields is an accessibility failure too' },
  ], { columns: ['item', 'why'] });
  out.textContent =
    'Two of those get argued about, so here is the reasoning:\n\n' +
    'DO NOT DISABLE THE SUBMIT BUTTON while the form is invalid. It feels tidy, and it is hostile:\n' +
    'the user gets no explanation of what is missing, a disabled button is skipped by the tab order\n' +
    'in most browsers, and someone using a screen reader may never find it. Let them submit, then\n' +
    'tell them precisely what is wrong. (If you need to prevent double submission, disable it AFTER\n' +
    'submit and announce that you are working.)\n\n' +
    'VALIDATE ON BLUR, NOT ON EVERY KEYSTROKE. "Invalid email" announced after the first character\n' +
    'of an address is both wrong and, with a screen reader, deafening. Validate when the user leaves\n' +
    'the field, and re-validate on input ONLY after it has already failed once — so the error clears\n' +
    'as soon as they fix it.\n\n' +
    'Finally: native constraint validation (required, type=email, pattern) is free and works without\n' +
    'JavaScript — but its default bubbles are not announced consistently and disappear quickly. Use\n' +
    'novalidate and your own messages, keeping the native attributes for semantics and autofill.';
});
