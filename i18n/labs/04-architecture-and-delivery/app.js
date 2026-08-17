// Lab 04 — i18n architecture & delivery.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

on('detect', () => {
  const supported = ['en-US', 'en-GB', 'de-DE', 'fr-FR', 'ja-JP', 'ar-EG'];
  // The right way to negotiate: let Intl do the matching, including fallbacks like
  // de-AT → de-DE and en-CA → en-US.
  const best = new Intl.Locale(
    Intl.DateTimeFormat.supportedLocalesOf(navigator.languages, { localeMatcher: 'best fit' })[0]
    ?? supported.find((s) => navigator.languages.some((n) => s.startsWith(n.split('-')[0])))
    ?? 'en-US',
  );
  renderTable('#results', [
    { source: 'navigator.languages', value: navigator.languages.join(', '), note: 'ORDERED preference list — use all of it, not just [0]' },
    { source: 'navigator.language', value: navigator.language, note: 'just the first; a common under-use' },
    { source: 'Accept-Language header', value: '(server side)', note: 'the same list, with q-weights, available before any JS' },
    { source: 'resolved time zone', value: Intl.DateTimeFormat().resolvedOptions().timeZone, note: 'a hint about REGION, never about language' },
    { source: 'your best match', value: best.toString(), note: `from supported: ${supported.join(', ')}` },
  ], { columns: ['source', 'value', 'note'] });
  out.textContent =
    'THE PRECEDENCE ORDER, and every step exists because of a real complaint:\n\n' +
    '  1. AN EXPLICIT USER CHOICE, persisted. If someone picked a language, that decision outranks\n' +
    '     everything forever. Store it in a cookie so the SERVER can honour it on the first byte.\n' +
    '  2. THE URL (/de/…, or ?lang=de). Shareable and crawlable — a link sent to a colleague must\n' +
    '     open in the language it was written in.\n' +
    '  3. Accept-Language / navigator.languages, matched properly against what you support.\n' +
    '  4. A default.\n\n' +
    'THREE THINGS TO NEVER DO:\n' +
    '  · Never geolocate by IP to choose a LANGUAGE. A German speaker in Japan gets Japanese; a\n' +
    '    tourist gets a language they cannot read; a VPN user gets nonsense. Country is not\n' +
    '    language — Switzerland has four, and Spanish is spoken in twenty countries.\n' +
    '  · Never redirect automatically without an escape. If you must redirect, show a persistent\n' +
    '    "View in English" link and remember the choice.\n' +
    '  · Never use only navigator.languages[0]. It is an ORDERED LIST, and someone whose first\n' +
    '    preference you do not support may well speak their second fluently.\n\n' +
    'Region matters separately from language: en-GB vs en-US is spelling, dates, and currency, not\n' +
    'a different translation file. Model locale as language + region and let one translation file\n' +
    'serve several regions where that is true.';
});

on('urls', () => {
  renderTable('#results', [
    { strategy: '/de/products (path prefix)', seo: 'best', pros: 'crawlable, shareable, cacheable per locale, obvious', cons: 'routing work' },
    { strategy: 'de.example.com (subdomain)', seo: 'good', pros: 'separable infra and teams', cons: 'cookies and auth across subdomains' },
    { strategy: 'example.de (ccTLD)', seo: 'strongest regional signal', pros: 'local trust, legal separation', cons: 'expensive, many domains to run' },
    { strategy: '?lang=de (query)', seo: 'weak', pros: 'trivial to add', cons: 'often stripped, poorly cached, looks temporary' },
    { strategy: 'cookie only, one URL', seo: 'WORST', pros: 'none worth it', cons: 'a shared link opens in the wrong language; crawlers see one version' },
  ], { columns: ['strategy', 'seo', 'pros', 'cons'] });
  out.textContent =
    'THE COOKIE-ONLY APPROACH IS THE ONE TO AVOID, and the reason is concrete: a URL must identify\n' +
    'its content. If /products renders in whatever language the visitor last chose, then a link\n' +
    'shared between colleagues opens differently for each of them, a CDN cannot cache it without a\n' +
    'Vary that destroys the hit rate, and a search engine only ever indexes one version.\n\n' +
    'PATH PREFIX is the default recommendation for most products.\n\n' +
    'Whichever you choose, the SEO plumbing is the same and is not optional:\n\n' +
    '  <link rel="alternate" hreflang="de" href="https://example.com/de/products">\n' +
    '  <link rel="alternate" hreflang="en-GB" href="https://example.com/en-gb/products">\n' +
    '  <link rel="alternate" hreflang="x-default" href="https://example.com/products">\n\n' +
    'Rules that are easy to get wrong: hreflang must be RECIPROCAL (every version links to every\n' +
    'other, including itself), the canonical of each version points at ITSELF and not at the\n' +
    'English one, and x-default marks the page for users whose language you do not serve. See\n' +
    'seo-for-rendering lab 04.\n\n' +
    'And set <html lang> and dir to match the URL. A page served at /ar/ with lang="en" gets the\n' +
    'wrong font, the wrong screen-reader voice, and no RTL.';
});

on('loading', () => {
  renderTable('#results', [
    { approach: 'all locales in the main bundle', cost: 'every user downloads every language', when: 'never, beyond 2–3 tiny locales' },
    { approach: 'one file per locale, dynamic import', cost: 'one extra request, cacheable forever', when: 'the default for a client-rendered app' },
    { approach: 'per locale AND per route/namespace', cost: 'more requests, smaller each', when: 'large apps; load "checkout" strings only in checkout' },
    { approach: 'server-rendered, strings inlined', cost: 'zero client cost, no flash', when: 'the best option when you have a server' },
    { approach: 'fetched at runtime from a CDN/service', cost: 'a network round trip before first paint', when: 'when translators must publish without a deploy' },
  ], { columns: ['approach', 'cost', 'when'] });
  out.textContent =
    'THE FAILURE MODE THAT MATTERS: the flash of untranslated content. The app renders in the\n' +
    'default language, the translation file arrives, and everything re-renders — visible, ugly, and\n' +
    'a layout shift (CLS) as the text length changes.\n\n' +
    'Ways out, best first:\n' +
    '  1. SERVER-RENDER IN THE RIGHT LOCALE. No flash is possible, because the first byte is\n' +
    '     already correct. This is the strongest argument for SSR in a multilingual product.\n' +
    '  2. Inline the CURRENT locale\'s strings into the HTML (a script tag) and lazy-load only when\n' +
    '     the user switches.\n' +
    '  3. Block the first render on the translation load and show a skeleton. Honest, but slower.\n' +
    '  4. Preload the locale file: <link rel="preload" as="fetch" crossorigin> so it is not\n' +
    '     discovered late. See resource-hints lab 03.\n\n' +
    'Cache the locale files with a content hash and a long max-age — they change on deploy, not per\n' +
    'request. And split by NAMESPACE as well as locale once the file passes a few hundred keys:\n' +
    'the checkout strings do not belong in the marketing page bundle.\n\n' +
    'One more thing to check: are your DATE and NUMBER formats coming from Intl (built into the\n' +
    'browser, zero bytes) or from a date library with locale files (kilobytes per locale)? Most\n' +
    'apps can delete the second entirely.';
});

on('workflow', () => {
  renderTable('#results', [
    { step: 'extract', how: 'a script scans the source for t() calls and produces the source file', why: 'never hand-maintain the English file' },
    { step: 'describe', how: 'every key carries a description and a screenshot reference', why: 'context is an INPUT to translation, not documentation' },
    { step: 'send', how: 'push to the TMS (Crowdin, Lokalise, Phrase) from CI', why: 'a manual step is a step that stops happening' },
    { step: 'translate', how: 'humans, with the description and a screenshot', why: 'MT is a first draft, not a release' },
    { step: 'pull', how: 'a PR that adds the translated files', why: 'reviewable, revertable, versioned with the code' },
    { step: 'validate in CI', how: 'missing keys, unused keys, broken ICU syntax, placeholder mismatch', why: 'a missing {count} is a runtime crash' },
    { step: 'fall back', how: 'missing key → the source language, and LOG it', why: 'never show a raw key to a user' },
    { step: 'pseudo-localize', how: 'a fake locale in CI + screenshot tests', why: 'finds hard-coded strings and clipping before translators do' },
  ], { columns: ['step', 'how', 'why'] });
  out.textContent =
    'PLACEHOLDER MISMATCH VALIDATION is the check that earns its keep on day one. If the English is\n' +
    '"{count} items" and a translation says "{cont} Elemente", you get either a literal "{cont}" on\n' +
    'screen or a thrown error — from a typo, in a file nobody on your team can read. A CI check that\n' +
    'compares the placeholder SET of every translation against the source catches it in seconds.\n\n' +
    'The other rule worth being firm about: NEVER SHIP A RAW KEY TO A USER. "checkout.button.submit"\n' +
    'appearing on a page is the single most recognisable sign of a broken i18n pipeline. Fall back to\n' +
    'the source language and emit a warning to your monitoring — a missing translation should be an\n' +
    'alert, not a rendering.\n\n' +
    'And the organisational point: TRANSLATION IS ASYNCHRONOUS TO DEVELOPMENT. Shipping a feature\n' +
    'with English strings and translating them a week later is normal and fine, PROVIDED the\n' +
    'fallback is clean and the extraction is automatic. Blocking releases on translation is what\n' +
    'makes teams start hard-coding strings "just for now".';
});

on('measure', async () => {
  // A rough measure of what your i18n layer costs, using the resource timing API.
  const entries = performance.getEntriesByType('resource')
    .filter((e) => /locale|i18n|messages|intl/i.test(e.name))
    .map((e) => ({ file: e.name.split('/').pop(), size: `${Math.round(e.transferSize / 1024)}KB`, ms: Math.round(e.duration) }));
  renderTable('#results', entries.length ? entries : [
    { file: '(no locale files loaded on this page)', size: '—', ms: '—' },
  ], { columns: ['file', 'size', 'ms'] });
  out.textContent =
    'On your own app, run this in the console:\n\n' +
    "  performance.getEntriesByType('resource')\n" +
    "    .filter(e => /locale|i18n|messages/i.test(e.name))\n" +
    '    .map(e => [e.name.split("/").pop(), Math.round(e.transferSize/1024) + "KB", Math.round(e.duration) + "ms"])\n\n' +
    'The three numbers to know, and the questions they answer:\n' +
    '  · KB per locale file — is a user downloading strings for languages they will never see?\n' +
    '  · when it loads relative to first paint — is there a flash of untranslated content?\n' +
    '  · how much of your bundle is a date/number library — can Intl replace it entirely?\n\n' +
    'That last one is frequently 30–70KB of pure win. Intl.DateTimeFormat, Intl.NumberFormat,\n' +
    'Intl.RelativeTimeFormat, Intl.ListFormat, Intl.PluralRules and Intl.Collator are built in,\n' +
    'cover every locale, weigh nothing, and are more correct than the library you would ship.';
});
