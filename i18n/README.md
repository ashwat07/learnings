# Internationalization & localization ⭐⭐⭐⭐

i18n is not translation. It is the set of decisions that make translation *possible* — and almost
all of them are made before a single string is translated, by people who weren't thinking about it.

```sh
./serve.sh    # then http://localhost:8080/i18n/labs/01-formatting/
```

Everything here uses the platform's own `Intl` APIs. They are excellent, built in, and consistently
underused — most of the bugs in this course are caused by hand-rolling something `Intl` already does
correctly for 200+ locales.

---

## i18n vs l10n vs g11n

| Term | Is | Owned by |
|---|---|---|
| **i18n** | making the product *capable* of being localized | engineering |
| **l10n** | actually adapting it for a locale | translators, regional teams |
| g11n | the whole business of operating internationally | product |

The numeronyms are letter counts: i-18 letters-n. Which tells you how often people type them.

## The assumptions that break

Every one of these is false somewhere, and each has caused a production incident:

| Assumption | Reality |
|---|---|
| text is left-to-right | Arabic, Hebrew, Persian, Urdu |
| a name has a first and last part | many cultures don't split that way, or order it differently |
| translated text is about the same length | German runs +35%, Finnish more; Chinese much shorter |
| a comma separates thousands | `1.234,56` in most of Europe; `1 234,56` in France; `1,2345` grouping in India |
| dates are unambiguous | `03/04/2025` is two different days |
| plural means "one or many" | Arabic has 6 forms, Polish 4, Japanese 1 |
| uppercasing is reversible | Turkish `i` → `İ`, and `ß` → `SS` |
| a character is a `char` | emoji, combining marks, and every non-BMP script |
| sorting is alphabetical | locale-dependent, and never `Array.sort()`'s default |

## Curriculum

| # | Lab | Question it answers | ⭐ |
|---|---|---|---|
| 01 | [Formatting](labs/01-formatting/) | Numbers, dates, currency, lists, relative time — without a library | ⭐⭐⭐⭐ |
| 02 | [Messages & plurals](labs/02-messages-and-plurals/) | Why string concatenation is untranslatable | ⭐⭐⭐⭐⭐ |
| 03 | [Bidi & typography](labs/03-bidi-and-typography/) | RTL, logical properties, fonts, text length | ⭐⭐⭐⭐⭐ |
| 04 | [Architecture & delivery](labs/04-architecture-and-delivery/) | Where do translations live and when do they load? | ⭐⭐⭐⭐ |

Related: [asset-optimization lab 04](../asset-optimization/labs/03-fonts/) (font subsetting per
script) and [seo-for-rendering lab 04](../seo-for-rendering/labs/04-crawlability/) (`hreflang` and
locale URLs).

## The one habit

**Never build a sentence out of parts in code.** Grammar is not concatenation, and every language
disagrees with yours about word order, agreement, and how many plural forms exist. A message is a
whole template with named placeholders — always.
