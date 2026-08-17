// Lab 02 — Messages & plurals.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
const loc = () => $('#locale').value;

on('plurals', () => {
  const pr = new Intl.PluralRules(loc());
  const counts = [0, 1, 2, 3, 5, 11, 21, 22, 100, 101, 1.5];
  const categories = new Set();
  const rows = counts.map((n) => {
    const c = pr.select(n);
    categories.add(c);
    return { count: n, category: c };
  });
  renderTable('#results', rows, { columns: ['count', 'category'] });
  log.head(`${loc()} uses ${categories.size} of the 6 categories: ${[...categories].join(', ')}`);
  out.textContent =
    `Locale "${loc()}" uses these categories: ${[...categories].join(', ')}.\n\n` +
    'The six possible categories are zero, one, two, few, many, other. English uses two (one,\n' +
    'other). Japanese uses one (other). Arabic uses all six. Polish uses one/few/many/other, and\n' +
    'which one you get depends on the last TWO digits.\n\n' +
    'Which means:\n\n' +
    '  count === 1 ? "item" : "items"\n\n' +
    'is not a simplification — it is a rule that only exists in a handful of languages, hard-coded\n' +
    'into your source. There is no way for a translator to fix it, because the code has already\n' +
    'decided there are exactly two possibilities.\n\n' +
    'Also note 1.5 in English: it selects "other", not "one". "1.5 items" is correct and\n' +
    '"1.5 item" is not — another case the ternary gets wrong.\n\n' +
    'Intl.PluralRules gives you the category. ICU MessageFormat lets the TRANSLATION FILE supply a\n' +
    'string per category, which is where that decision belongs.';
});

on('concat', () => {
  renderTable('#results', [
    { code: '`You have ${n} ` + (n===1 ? "message" : "messages")', breaks: 'plural forms; word order; the translator sees three fragments' },
    { code: '"Delete " + itemType + "?"', breaks: 'gender/case agreement — German needs "den/die/das", Russian declines the noun' },
    { code: '`${count} results for "${q}"`', breaks: 'nothing, IF it is one whole template string. This one is fine.' },
    { code: 'label + ":" ', breaks: 'French puts a space before a colon; Japanese uses a different colon' },
    { code: '"Showing " + a + " to " + b + " of " + c', breaks: 'word order — many languages put the total first' },
    { code: 'sort(items).join(", ")', breaks: 'list separators; use Intl.ListFormat' },
  ], { columns: ['code', 'breaks'] });
  out.textContent =
    'THE RULE: A MESSAGE IS A WHOLE SENTENCE WITH NAMED PLACEHOLDERS. Never fragments joined in\n' +
    'code.\n\n' +
    'Two reasons, and the second one is the one people underestimate:\n\n' +
    '1. GRAMMAR. Word order differs (German pushes verbs to the end; Japanese is\n' +
    '   subject-object-verb), nouns decline, adjectives agree with gender, and a fragment cannot\n' +
    '   express any of that.\n' +
    '2. CONTEXT. A translator working from a spreadsheet sees "Delete" with no idea whether it is a\n' +
    '   button, a menu item, or part of "Delete 3 files?". In German, "Delete" as a button label\n' +
    '   ("Löschen") differs from "Delete" in a sentence. Fragments make good translation\n' +
    '   IMPOSSIBLE, not merely harder.\n\n' +
    'The corollary that surprises people: interpolating a whole template is FINE.\n' +
    '  t("search.results", { count, query })  →  "{count} results for \\"{query}\\""\n' +
    'The translator gets the whole sentence and can move the placeholders wherever their language\n' +
    'needs them. That is the entire difference.';
});

on('icu', () => {
  const l = loc();
  const pr = new Intl.PluralRules(l);
  // A 15-line ICU-ish formatter, to show the shape. Use intl-messageformat or FormatJS in anger.
  const MESSAGES = {
    en: { inbox: { one: 'You have 1 message', other: 'You have {count} messages' } },
    ja: { inbox: { other: '{count}件のメッセージがあります' } },
    pl: { inbox: { one: 'Masz 1 wiadomość', few: 'Masz {count} wiadomości', many: 'Masz {count} wiadomości', other: 'Masz {count} wiadomości' } },
    ar: { inbox: { zero: 'ليس لديك رسائل', one: 'لديك رسالة واحدة', two: 'لديك رسالتان', few: 'لديك {count} رسائل', many: 'لديك {count} رسالة', other: 'لديك {count} رسالة' } },
    ru: { inbox: { one: 'У вас {count} сообщение', few: 'У вас {count} сообщения', many: 'У вас {count} сообщений', other: 'У вас {count} сообщения' } },
    cy: { inbox: { zero: 'Nid oes gennych negeseuon', one: 'Mae gennych 1 neges', two: 'Mae gennych 2 neges', few: 'Mae gennych {count} neges', many: 'Mae gennych {count} neges', other: 'Mae gennych {count} neges' } },
  };
  const format = (key, { count }) => {
    const forms = MESSAGES[l]?.[key] ?? MESSAGES.en[key];
    const template = forms[pr.select(count)] ?? forms.other;
    return template.replace('{count}', new Intl.NumberFormat(l).format(count));
  };
  renderTable('#results', [0, 1, 2, 3, 5, 21, 100].map((count) => ({
    count, message: format('inbox', { count }), category: pr.select(count),
  })), { columns: ['count', 'category', 'message'] });
  out.textContent =
    'The translation file supplies one string PER CATEGORY, and the code supplies only the number.\n' +
    'Switch to ar and watch six different sentences appear for six counts — none of which your\n' +
    'source code knows about, which is exactly the point.\n\n' +
    'In real ICU MessageFormat syntax the whole thing is one string, which is what a translator\n' +
    'edits:\n\n' +
    '  {count, plural,\n' +
    '     =0 {You have no messages}\n' +
    '    one {You have one message}\n' +
    '  other {You have # messages}}\n\n' +
    'Note "=0" versus the "zero" category: they are different things. "=0" is an EXACT MATCH you\n' +
    'add because English wants a special sentence for zero; "zero" is a grammatical category that\n' +
    'only some languages have. Exact matches are checked first, in every language, which makes them\n' +
    'a clean way to special-case without breaking anyone.\n\n' +
    'Use FormatJS / intl-messageformat, or i18next with the ICU plugin. ICU MessageFormat is what\n' +
    'every translation tool on earth understands, which matters more than the syntax being pretty.';
});

on('context', () => {
  const l = loc();
  const ord = new Intl.PluralRules(l, { type: 'ordinal' });
  renderTable('#results', [1, 2, 3, 4, 11, 21, 22, 23, 101].map((n) => ({
    n, 'ordinal category': ord.select(n),
    'en suffix': { one: 'st', two: 'nd', few: 'rd', other: 'th' }[ord.select(n)] ?? '',
  })), { columns: ['n', 'ordinal category', 'en suffix'] });
  out.textContent =
    'ORDINALS are a separate rule set: Intl.PluralRules(l, { type: "ordinal" }). English needs\n' +
    'st/nd/rd/th, and the rule is not "look at the last digit" — 11th, 12th and 13th break that,\n' +
    'and 111th breaks the naive fix. Most languages do not use suffixes at all.\n\n' +
    'GENDER AND CONTEXT. Two more things the message file has to be able to express:\n\n' +
    '  · GENDER: "{name} updated their profile" needs he/she/they in languages where the verb or\n' +
    '    adjective agrees. ICU has a select clause for exactly this:\n' +
    '      {gender, select, female {She} male {He} other {They}} updated the profile\n' +
    '    And the data question underneath it: do you actually know the user\'s gender, and should\n' +
    '    you? Often the right answer is to write around it.\n' +
    '  · CONTEXT/DISAMBIGUATION: the same English word is different words elsewhere. "Post" the\n' +
    '    verb and "post" the noun; "Free" as in price and "free" as in liberty. Give keys a\n' +
    '    namespace and a description field:\n' +
    '      "button.post.action": { message: "Post", description: "Button that publishes a comment" }\n' +
    '    That description is not documentation — it is an INPUT to the translation, and its absence\n' +
    '    is the most common cause of embarrassing translations.';
});

on('rules', () => {
  renderTable('#results', [
    { rule: 'a message is a whole sentence', not: 'fragments joined in code' },
    { rule: 'named placeholders, never positional', not: '"%s bought %s" — untranslatable ordering' },
    { rule: 'plurals via ICU / PluralRules', not: 'count === 1 ? a : b' },
    { rule: 'a key + a description per message', not: 'the English string as the key' },
    { rule: 'numbers, dates, currency formatted by Intl', not: 'inside the translated string' },
    { rule: 'never concatenate a label and a value', not: '`${label}: ${value}`' },
    { rule: 'plan for +35% text length', not: 'fixed-width buttons' },
    { rule: 'pseudo-localize in CI', not: 'discovering it after translation' },
  ], { columns: ['rule', 'not'] });
  out.textContent =
    'THE ENGLISH STRING AS THE KEY is worth arguing about, because it is a popular design.\n\n' +
    'It reads beautifully — t("You have {count} messages") — and it fails in two specific ways:\n' +
    '  · fixing a typo in the English changes the key, orphaning every translation\n' +
    '  · two identical English strings that need DIFFERENT translations collapse into one key\n' +
    '    ("Post" the button and "Post" the heading)\n' +
    'Structured keys (inbox.messageCount) plus a description field avoid both, at the cost of\n' +
    'readability at the call site. Pick deliberately; do not drift into it.\n\n' +
    'PSEUDO-LOCALIZATION is the highest-value thing on this list and takes an afternoon. Generate a\n' +
    'fake locale that transforms every string:\n' +
    '  "Save changes"  →  "[!!! Şåvé çhåñgéš ~~~~~~~ !!!]"\n' +
    'Accented characters prove the string went through your i18n layer; the padding simulates a\n' +
    '+35% German expansion; the brackets reveal truncation and concatenation instantly. Run your\n' +
    'app in it and every hard-coded string appears in plain English, unmissable.\n\n' +
    'Put it behind ?locale=pseudo in staging and run your screenshot tests against it. You will\n' +
    'find hard-coded strings and clipped buttons months before a translator does.';
});
