# Lab 01 — Formatting with Intl ⭐⭐⭐⭐

**Goal:** delete your formatting helpers.

> <http://localhost:8080/i18n/labs/01-formatting/>

---

## The same number, four locales

```
en-US   1,234,567.891
de-DE   1.234.567,891      ← the separators swap
fr-FR   1 234 567,891      ← a narrow no-break space
hi-IN   12,34,567.891      ← lakh/crore grouping: 2-2-3, not 3-3-3
```

If you've written `/\B(?=(\d{3})+(?!\d))/g`, it's wrong for about 1.4 billion people.

## Currency is a property of the money, not the locale

€1,234.50 shown to a German user is `1.234,50 €` — same currency, different presentation. Never
derive currency from locale, never store a formatted string. **Store minor units (integer) + an ISO
code, format at the edge.** And note JPY has no minor unit — `Intl` knows; hard-coding two decimal
places doesn't.

## Dates: three rules

1. **Store in UTC.** ISO 8601 with a `Z`, or epoch millis.
2. **Format in the user's zone**, from `Intl.DateTimeFormat().resolvedOptions().timeZone` — an IANA
   name, never a UTC offset. Offsets change twice a year; `Europe/Berlin` carries the rules.
3. **For events at a local time** (a meeting, a shop opening), store the local time **and the zone**,
   not an instant. Those diverge the moment the rules change.

`03/04/2025` is two different days. `dateStyle: 'medium'` (month spelled out) is the safer default
for anything that matters.

Not every locale defaults to the Gregorian calendar — `ar-SA` can use Islamic, `ja-JP` has eras.
`Intl` handles it; a format string doesn't.

## The APIs, and what each replaces

| API | Replaces |
|---|---|
| `Intl.NumberFormat` | your separator regex, your currency helper, `toFixed` |
| `Intl.DateTimeFormat` | a date library's locale files (often 30–70KB) |
| `Intl.RelativeTimeFormat` | your "3 days ago" function, with `numeric: 'auto'` giving "yesterday" |
| **`Intl.ListFormat`** | `join(', ') + ' and '` — wrong in most languages, and the Oxford comma differs between en-US and en-GB |
| **`Intl.DisplayNames`** | your hand-maintained 250-row country list |
| **`Intl.Collator`** | `Array.sort()`, which sorts by UTF-16 code unit — not alphabetical in any language |
| `Intl.PluralRules` | `n === 1 ? a : b` (lab 02) |
| `Intl.Segmenter` | `.length`, `split('')`, `substring` |

**Construct once, reuse.** Creating an `Intl` formatter loads locale data and is expensive; calling
`.format`/`.compare` is cheap. Hoist them out of render functions.

`Intl.Collator` options worth knowing: `numeric: true` gives natural sort (`file2` before `file10`),
and `sensitivity: 'base'` makes `resume` match `résumé` — the correct way to do accent-insensitive
search.

## The traps

| Trap | Why |
|---|---|
| `'İstanbul'.toLowerCase()` | Turkish dotted/dotless i — use `toLocaleLowerCase('tr')` |
| `'ß'.toUpperCase() === 'SS'` | uppercasing isn't reversible; never round-trip case |
| `'👍'.length === 2` | `.length` counts UTF-16 code units |
| `'é'.length` is 1 **or** 2 | precomposed vs combining — `normalize('NFC')` before comparing |
| `text.split('')` | splits surrogate pairs |
| `substring(0, 20) + '…'` | can cut a grapheme in half |
| `new Date('03/04/2025')` | engine-dependent parsing |

Run the lab and read the log:

```
'👨‍👩‍👧‍👦 family'.length              = 18   UTF-16 code units
[...'👨‍👩‍👧‍👦 family'].length         = 14   code points
Segmenter (grapheme)             = 8    what a human calls characters
```

Only the third is what a user means. That matters whenever you truncate, count, reverse or index.
`Intl.Segmenter` also does **word** granularity, which is how you count words in Japanese or Thai —
languages without spaces, where `split(' ')` returns one enormous "word".

## Think about

- You store prices as `"$19.99"`. What's wrong?
- Your user is in Berlin with their browser in English. Which locale?
- Why can't you compare user-typed strings with `===`?

<details>
<summary>Answers</summary>

**Storing `"$19.99"`.** Four problems: it's a float in disguise (rounding errors on arithmetic), it
hard-codes a currency, it hard-codes a *presentation*, and it can't be summed, converted or
re-formatted. Store `{ amount: 1999, currency: 'USD' }` in minor units and format at the edge.

**Berlin + English browser.** Language English, region probably German — so `en-DE`, or `en-GB` if
you don't support that: English text, European date formats, EUR, metric. This is why locale is
language **and** region, and why "what language do they read" and "what conventions do they expect"
are separate questions. Let them override, and remember the choice.

**Comparing typed strings.** Unicode normalization: `é` can be one code point or two, both from real
keyboards, both looking identical and comparing unequal. Normalize to NFC before storing or
comparing. And for *matching* rather than equality (search, dedup), use
`Intl.Collator(locale, {sensitivity: 'base'})`, which also handles case and accents in a
locale-correct way.
</details>

---

## 🏗️ Build challenge

1. Find every formatting helper in your codebase. Replace each with `Intl`.
2. Measure the bundle before and after — if you drop a date library's locale files, it's often
   30–70KB.
3. Audit for `toFixed`, `.sort()` without a comparator, and `.length` used as a character count.
4. Hoist `Intl` constructors out of render paths and memoise by locale.
5. Add a test that formats a fixed set of values in five locales and snapshots the output. It fails
   when someone reintroduces a hand-rolled formatter.

**Done when:** no formatting code in your app takes a locale-specific branch.

---

## Interview questions

1. Why is Indian number grouping a problem for hand-rolled formatters?
2. Where does currency come from — the money or the locale?
3. Why store an IANA zone rather than a UTC offset?
4. Three ways to count "characters", and which is right?
5. What does `Intl.Collator` do that `.sort()` doesn't?
