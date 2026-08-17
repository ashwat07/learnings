// Lab 03 — Bidi & typography.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
const stage = $('#stage');

on('ltr', () => {
  stage.dir = 'ltr'; stage.lang = 'en';
  $('#c1').lastChild.textContent = ' — margin-left, border-left, text-align: left';
  log.muted('dir=ltr');
});

on('rtl', () => {
  stage.dir = 'rtl'; stage.lang = 'ar';
  log.ok('dir=rtl — note which card mirrored');
  out.textContent =
    'The LOGICAL card mirrored: its indent and border moved to the right, and the text is\n' +
    'right-aligned. The PHYSICAL card did not — its border is still on the left, which in an RTL\n' +
    'layout is the wrong side entirely.\n\n' +
    'That is the whole of RTL support in modern CSS. Change the vocabulary and the browser mirrors\n' +
    'the layout for you when dir="rtl" is set.\n\n' +
    'Note also what mirrored WITHOUT any CSS: the button row (flex follows the writing direction),\n' +
    'and the order of inline content. The browser is doing the bidi algorithm for you; you only\n' +
    'have to stop fighting it with hard-coded lefts and rights.';
});

on('logical', () => {
  renderTable('#results', [
    { physical: 'margin-left / right', logical: 'margin-inline-start / end' },
    { physical: 'padding-left / right', logical: 'padding-inline-start / end' },
    { physical: 'border-left / right', logical: 'border-inline-start / end' },
    { physical: 'left / right (position)', logical: 'inset-inline-start / end' },
    { physical: 'text-align: left / right', logical: 'text-align: start / end' },
    { physical: 'width / height', logical: 'inline-size / block-size' },
    { physical: 'top / bottom', logical: 'inset-block-start / end' },
    { physical: 'border-radius: 4px 0 0 4px', logical: 'border-start-start-radius, etc.' },
    { physical: 'float: left', logical: 'float: inline-start' },
    { physical: 'transform: translateX(10px)', logical: 'no logical equivalent — flip it in a [dir=rtl] rule' },
  ], { columns: ['physical', 'logical'] });
  out.textContent =
    'Search your codebase for margin-left, padding-right, text-align: left and float: left. That\n' +
    'list is your RTL backlog, and converting it is mechanical.\n\n' +
    'The pieces logical properties do NOT solve, and which you must handle explicitly:\n\n' +
    '  · TRANSFORMS. translateX(10px) goes the same physical way regardless of direction. Flip it\n' +
    '    with [dir="rtl"] & { transform: translateX(-10px) } or a CSS variable holding the sign.\n' +
    '  · DIRECTIONAL ICONS. An arrow meaning "next" must point the other way; a "back" chevron\n' +
    '    mirrors. But a play button does NOT mirror (media controls follow the timeline), and\n' +
    '    neither does a checkmark or a clock. Mirroring everything is as wrong as mirroring\n' +
    '    nothing — the rule is: mirror it if its meaning depends on reading direction.\n' +
    '  · SHADOWS AND GRADIENTS with a physical offset.\n' +
    '  · KEYBOARD ARROWS. In an RTL layout, ArrowLeft usually means "next" in a carousel.\n' +
    '  · SCROLL POSITION. scrollLeft is negative or reversed in RTL depending on the browser; use\n' +
    '    scrollIntoView or the logical scroll APIs where you can.\n\n' +
    'And set dir on the <html> element from the locale, not per component — the browser needs it\n' +
    'for the bidi algorithm, form controls, and native scrollbar placement.';
});

on('length', () => {
  const samples = [
    { locale: 'en', text: 'Save changes' },
    { locale: 'de', text: 'Änderungen speichern' },
    { locale: 'fi', text: 'Tallenna muutokset' },
    { locale: 'ru', text: 'Сохранить изменения' },
    { locale: 'ja', text: '変更を保存' },
    { locale: 'ar', text: 'حفظ التغييرات' },
  ];
  const base = samples[0].text.length;
  renderTable('#results', samples.map((s) => ({
    locale: s.locale, text: s.text, chars: s.text.length,
    'vs English': `${Math.round((s.text.length / base - 1) * 100)}%`,
  })), { columns: ['locale', 'text', 'chars', 'vs English'] });
  let i = 0;
  const cycle = setInterval(() => {
    const s = samples[i % samples.length];
    $('#fw').textContent = s.text;
    $('#fw').lang = s.locale;
    $('#fw').dir = s.locale === 'ar' ? 'rtl' : 'ltr';
    if (++i > 12) clearInterval(cycle);
  }, 700);
  out.textContent =
    'Watch the fixed-width box cycle through the same label in six languages. It clips.\n\n' +
    'THE RULE OF THUMB: budget +35% for European languages against English, and more for short\n' +
    'strings — a 10-character English label can double. Asian languages usually run SHORTER, which\n' +
    'creates the opposite bug: a layout that only looks right when the text fills the space.\n\n' +
    'What follows for CSS:\n' +
    '  · never a fixed width on anything containing translated text; use min-width and let it grow\n' +
    '  · never a fixed height either — text wraps to two lines and gets clipped vertically\n' +
    '  · design at the LONGEST plausible string, not the English one\n' +
    '  · text-overflow: ellipsis hides the problem instead of solving it, and hides it from YOU\n' +
    '  · avoid text baked into images entirely; it cannot be translated at all\n\n' +
    'Which is exactly what the 400% zoom test in accessibility lab 05 also exercises — the same\n' +
    'fixed-size assumptions break under both, so fixing one fixes the other.';
});

on('fonts', () => {
  renderTable('#results', [
    { concern: 'script coverage', detail: 'your brand font probably has no Arabic, Devanagari, Thai or CJK' },
    { concern: 'CJK font size', detail: 'a full CJK font is megabytes — subset per page or use a system stack' },
    { concern: 'line-height', detail: 'CJK and Devanagari need more; a tight Latin line-height clips diacritics' },
    { concern: 'font-weight', detail: 'many non-Latin fonts have fewer weights; synthetic bold looks wrong' },
    { concern: 'unicode-range', detail: 'serve a different @font-face per script — the browser downloads only what is used' },
    { concern: 'lang attribute', detail: 'the browser picks the right font and hyphenation from it; also required for screen readers' },
    { concern: 'Turkish, Vietnamese, Polish', detail: 'Latin, but need extended ranges your subset may have dropped' },
  ], { columns: ['concern', 'detail'] });
  out.textContent =
    'unicode-range is the mechanism that makes multi-script fonts affordable:\n\n' +
    '  @font-face { font-family: App; src: url(latin.woff2); unicode-range: U+0000-00FF; }\n' +
    '  @font-face { font-family: App; src: url(arabic.woff2); unicode-range: U+0600-06FF; }\n\n' +
    'Same family name, several files; the browser downloads only the ones whose characters actually\n' +
    'appear on the page. An English page never fetches the Arabic file.\n\n' +
    'Two things people get wrong:\n' +
    '  · SUBSETTING TOO AGGRESSIVELY. A Latin subset of U+0000-00FF drops Polish ł, Turkish ğ,\n' +
    '    Romanian ș and every Vietnamese diacritic — so those users get a fallback font mid-word,\n' +
    '    which looks broken. Subset by the languages you actually support.\n' +
    '  · LINE-HEIGHT TUNED FOR LATIN. Devanagari and Thai have marks above and below that a 1.2\n' +
    '    line-height clips outright. Use a larger line-height for those scripts (a :lang() rule),\n' +
    '    or a comfortable global one.\n\n' +
    'And always set lang on <html> (and on any element in a different language). It drives font\n' +
    'selection, hyphenation, quotation marks (the CSS quotes property is locale-aware), spell\n' +
    'check, and the voice a screen reader uses — a French paragraph read in an English voice is\n' +
    'unintelligible. See asset-optimization lab 04.';
});

on('mixed', () => {
  stage.dir = 'rtl'; stage.lang = 'ar';
  $('#results').innerHTML =
    '<div class="row"><span>bare interpolation:</span> ' +
    '<span dir="auto">مرحبا user123 (5 items)</span></div>' +
    '<div class="row"><span>with isolation:</span> ' +
    '<span dir="auto">مرحبا <bdi>user123</bdi> (5 items)</span></div>';
  log.head('mixed-direction text');
  out.textContent =
    'A Latin username inside an Arabic sentence, or an Arabic name inside an English one, is where\n' +
    'the Unicode bidi algorithm gets ambiguous — and the classic symptom is punctuation jumping to\n' +
    'the wrong end of the string.\n\n' +
    'Two tools:\n\n' +
    '  <bdi>   BIDI ISOLATE. Wrap any user-supplied or dynamic string whose direction you do not\n' +
    '          control. It tells the algorithm "treat this as an opaque run", which stops it from\n' +
    '          reordering the text AROUND it. Use it for every username, filename and search term.\n' +
    '  dir="auto"  the browser infers direction from the first strong character. Perfect for a\n' +
    '          field where the user may type either script — a comment box, a search input.\n\n' +
    'The CSS equivalent is unicode-bidi: isolate, which <bdi> applies by default.\n\n' +
    'And numbers: Arabic and Persian may render digits as ٠١٢٣ (Eastern Arabic numerals) depending\n' +
    'on locale. Intl.NumberFormat handles it; the digits still read left-to-right inside an\n' +
    'RTL line, which is correct and looks wrong until you know it is correct.';
});
