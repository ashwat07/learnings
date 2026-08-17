// Lab 01 — Formatting with Intl.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
const loc = () => $('#locale').value;

on('numbers', () => {
  const l = loc();
  renderTable('#results', [
    { what: 'plain number', code: 'Intl.NumberFormat(l)', result: new Intl.NumberFormat(l).format(1234567.891) },
    { what: 'currency', code: "{ style: 'currency', currency: 'EUR' }", result: new Intl.NumberFormat(l, { style: 'currency', currency: 'EUR' }).format(1234.5) },
    { what: 'currency, no symbol', code: "{ currencyDisplay: 'code' }", result: new Intl.NumberFormat(l, { style: 'currency', currency: 'JPY', currencyDisplay: 'code' }).format(1234) },
    { what: 'percent', code: "{ style: 'percent' }", result: new Intl.NumberFormat(l, { style: 'percent' }).format(0.876) },
    { what: 'compact', code: "{ notation: 'compact' }", result: new Intl.NumberFormat(l, { notation: 'compact' }).format(1234567) },
    { what: 'units', code: "{ style: 'unit', unit: 'kilometer-per-hour' }", result: new Intl.NumberFormat(l, { style: 'unit', unit: 'kilometer-per-hour' }).format(88) },
    { what: 'signed', code: "{ signDisplay: 'always' }", result: new Intl.NumberFormat(l, { signDisplay: 'always' }).format(12.5) },
    { what: 'fixed decimals', code: '{ minimumFractionDigits: 2 }', result: new Intl.NumberFormat(l, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(3.1) },
  ], { columns: ['what', 'code', 'result'] });
  out.textContent =
    `Switch to de-DE, fr-FR and hi-IN and watch the same number change shape.\n\n` +
    '  en-US   1,234,567.891\n' +
    '  de-DE   1.234.567,891      ← the separators SWAP\n' +
    '  fr-FR   1 234 567,891      ← a narrow no-break space, not a normal space\n' +
    '  hi-IN   12,34,567.891      ← lakh/crore grouping: 2-2-3, not 3-3-3\n\n' +
    'The Indian grouping is the one that catches every hand-rolled formatter, because everyone\n' +
    'assumes groups of three. If you have ever written a regex like /\\B(?=(\\d{3})+(?!\\d))/g, it is\n' +
    'wrong for roughly 1.4 billion people.\n\n' +
    'CURRENCY. Note that the currency is a PROPERTY OF THE MONEY, not of the locale: €1,234.50 shown\n' +
    'to a German user is "1.234,50 €" — same currency, different presentation. Never derive the\n' +
    'currency from the locale, and never store a formatted string. Store an amount in minor units\n' +
    '(integer cents) plus an ISO code, and format at the edge.\n\n' +
    'Note also that JPY has no minor unit and Intl knows that — ¥1,234, not ¥1,234.00. Hard-coding\n' +
    '"two decimal places" is another very common bug.';
});

on('dates', () => {
  const l = loc();
  const d = new Date('2025-03-04T18:30:00Z');
  renderTable('#results', [
    { what: 'short date', code: "{ dateStyle: 'short' }", result: new Intl.DateTimeFormat(l, { dateStyle: 'short' }).format(d) },
    { what: 'long date', code: "{ dateStyle: 'long' }", result: new Intl.DateTimeFormat(l, { dateStyle: 'long' }).format(d) },
    { what: 'date + time', code: "{ dateStyle: 'medium', timeStyle: 'short' }", result: new Intl.DateTimeFormat(l, { dateStyle: 'medium', timeStyle: 'short' }).format(d) },
    { what: 'in Tokyo', code: "{ timeZone: 'Asia/Tokyo' }", result: new Intl.DateTimeFormat(l, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tokyo' }).format(d) },
    { what: 'weekday only', code: "{ weekday: 'long' }", result: new Intl.DateTimeFormat(l, { weekday: 'long' }).format(d) },
    { what: 'range', code: 'formatRange', result: new Intl.DateTimeFormat(l, { dateStyle: 'medium' }).formatRange(d, new Date('2025-03-09T00:00:00Z')) },
    { what: 'the user\'s time zone', code: 'resolvedOptions().timeZone', result: Intl.DateTimeFormat().resolvedOptions().timeZone },
  ], { columns: ['what', 'code', 'result'] });
  out.textContent =
    '2025-03-04 is the 4th of March or the 3rd of April depending on where you are. dateStyle:\n' +
    '"short" produces 3/4/25 in en-US and 04.03.25 in de-DE — which is exactly why you should never\n' +
    'show a numeric date to a global audience without knowing the locale, and why "medium" (with\n' +
    'the month spelled out) is the safer default for anything important.\n\n' +
    'THE THREE RULES FOR TIME:\n' +
    '  1. STORE IN UTC. Always. An ISO 8601 string with a Z, or epoch milliseconds.\n' +
    '  2. FORMAT IN THE USER\'S ZONE, which you get from\n' +
    '     Intl.DateTimeFormat().resolvedOptions().timeZone — never from a UTC offset, because\n' +
    '     offsets change twice a year and an IANA zone name ("Europe/Berlin") carries the rules.\n' +
    '  3. FOR EVENTS THAT HAPPEN AT A LOCAL TIME (a meeting, a shop opening, a birthday), store the\n' +
    '     LOCAL time AND the zone, not an instant. "9am Tokyo" and "the instant that was 9am Tokyo\n' +
    '     when I saved it" diverge the moment the rules change.\n\n' +
    'And a calendar caveat: not every locale uses the Gregorian calendar by default. ar-SA can use\n' +
    'the Islamic calendar; ja-JP has era-based years. Intl handles this; a date library configured\n' +
    'with a format string does not.';
});

on('relative', () => {
  const l = loc();
  const rtf = new Intl.RelativeTimeFormat(l, { numeric: 'auto' });
  const lf = (type) => new Intl.ListFormat(l, { style: 'long', type });
  renderTable('#results', [
    { what: '-1 day', result: rtf.format(-1, 'day') },
    { what: '-3 hours', result: rtf.format(-3, 'hour') },
    { what: '+2 weeks', result: rtf.format(2, 'week') },
    { what: 'list (and)', result: lf('conjunction').format(['apples', 'pears', 'plums']) },
    { what: 'list (or)', result: lf('disjunction').format(['apples', 'pears', 'plums']) },
    { what: 'display name (region)', result: new Intl.DisplayNames([l], { type: 'region' }).of('DE') },
    { what: 'display name (language)', result: new Intl.DisplayNames([l], { type: 'language' }).of('fr') },
  ], { columns: ['what', 'result'] });
  out.textContent =
    'numeric: "auto" gives you "yesterday" instead of "1 day ago" — in every language, with the\n' +
    'right idiom, for free. Hand-rolling that means writing a special case per language for the\n' +
    'words that are not "N units ago", and there are a lot of them.\n\n' +
    'Intl.ListFormat is the one nobody knows exists. "apples, pears, and plums" has an Oxford comma\n' +
    'in en-US, does not in en-GB, and in Japanese uses a different separator entirely. Joining with\n' +
    '", " and appending " and " is wrong in most languages.\n\n' +
    'Intl.DisplayNames gives you country, language, script and currency names IN THE USER\'S\n' +
    'LANGUAGE. That is a translation file you do not have to maintain — country lists are a classic\n' +
    'example of a 250-row table that teams translate by hand, badly, and never update.';
});

on('collation', () => {
  const l = loc();
  const words = ['Öl', 'Zebra', 'apple', 'Apfel', 'ähnlich', 'banana', 'Banane'];
  const naive = [...words].sort();
  const proper = [...words].sort(new Intl.Collator(l).compare);
  const numericSort = ['file10', 'file2', 'file1'].sort(new Intl.Collator(l, { numeric: true }).compare);
  renderTable('#results', [
    { what: 'Array.sort() default', result: naive.join(', ') },
    { what: `Intl.Collator('${l}')`, result: proper.join(', ') },
    { what: 'numeric: true', result: numericSort.join(', ') },
    { what: 'case-insensitive search', result: String(new Intl.Collator(l, { sensitivity: 'base' }).compare('resume', 'résumé') === 0) },
  ], { columns: ['what', 'result'] });
  out.textContent =
    'Array.prototype.sort() with no comparator sorts by UTF-16 CODE UNIT. That puts every uppercase\n' +
    'letter before every lowercase one, and every accented character after "z". It is not\n' +
    'alphabetical in any language, including English.\n\n' +
    'Intl.Collator is the fix, and it is locale-aware in ways you would not guess: in Swedish "ö"\n' +
    'sorts after "z" as a separate letter; in German it sorts with "o". Same character, different\n' +
    'correct answer.\n\n' +
    'Two options worth knowing:\n' +
    '  numeric: true          "file2" before "file10" — the natural sort everyone wants\n' +
    '  sensitivity: "base"    "resume" matches "résumé" and "RESUME" — the right way to do\n' +
    '                         accent-insensitive search, instead of a normalize().replace() hack\n\n' +
    'Performance note: create the Collator ONCE and reuse it. Constructing an Intl formatter is\n' +
    'expensive (it loads locale data); calling .compare or .format is cheap. The same applies to\n' +
    'every Intl.*Format — hoist them out of your render function.';
});

on('traps', () => {
  renderTable('#results', [
    { trap: "'İstanbul'.toLowerCase()", why: 'Turkish dotted/dotless i — use toLocaleLowerCase("tr")' },
    { trap: "'ß'.toUpperCase() === 'SS'", why: 'uppercasing is not reversible; never round-trip case' },
    { trap: "'👍'.length === 2", why: 'String.length counts UTF-16 code units, not characters' },
    { trap: "'é'.length can be 1 or 2", why: 'precomposed vs combining — normalize("NFC") before comparing' },
    { trap: 'text.split("")', why: 'splits surrogate pairs; use [...text] or Intl.Segmenter' },
    { trap: 'substring(0, 20) + "…"', why: 'can cut a grapheme in half; use Intl.Segmenter' },
    { trap: 'new Date("03/04/2025")', why: 'parsing depends on the engine; parse ISO or use explicit parts' },
    { trap: 'sorting with .sort()', why: 'code-unit order, not alphabetical' },
    { trap: 'currency from locale', why: 'currency is a property of the money' },
    { trap: 'assuming 2 decimal places', why: 'JPY has 0, some currencies have 3' },
  ], { columns: ['trap', 'why'] });

  const seg = new Intl.Segmenter(loc(), { granularity: 'grapheme' });
  const emoji = '👨‍👩‍👧‍👦 family';
  log.line(`"${emoji}".length = ${emoji.length}`);
  log.line(`[...emoji].length = ${[...emoji].length}`);
  log.ok(`[...Segmenter.segment(emoji)].length = ${[...seg.segment(emoji)].length}`);

  out.textContent =
    'Look at the log. That string is 8 things a user sees, 14 code points, and 18 UTF-16 code\n' +
    'units — the family emoji alone is one grapheme built from four people joined by zero-width\n' +
    'joiners. Three different numbers, and only one of them is what a user means by "characters".\n\n' +
    '  .length             UTF-16 code units — what your database column limit counts\n' +
    '  [...string]         code points — better, still splits emoji made of several\n' +
    '  Intl.Segmenter      GRAPHEME CLUSTERS — what a human calls a character\n\n' +
    'Which matters the moment you truncate a string, count characters in a text field, reverse a\n' +
    'string, or index into one. Intl.Segmenter also does word and sentence granularity, which is\n' +
    'how you word-wrap or count words in Japanese and Thai — languages that do not use spaces, and\n' +
    'where split(" ") returns one enormous "word".\n\n' +
    'And normalization: "é" can be one code point (U+00E9) or two (e + U+0301). They look\n' +
    'identical, compare unequal, and both arrive from real keyboards. Normalize to NFC before\n' +
    'storing or comparing anything a user typed.';
});
