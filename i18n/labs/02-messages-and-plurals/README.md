# Lab 02 — Messages & plurals ⭐⭐⭐⭐⭐

**Goal:** write messages a translator can actually translate.

> <http://localhost:8080/i18n/labs/02-messages-and-plurals/>

---

## Plural categories

Six exist: `zero`, `one`, `two`, `few`, `many`, `other`. Run the lab and switch locales:

| Locale | Categories used |
|---|---|
| ja | 1 — `other` |
| en | 2 — `one`, `other` |
| pl | 4 — `one`, `few`, `many`, `other` |
| ar | **6** — all of them |

So:

```js
count === 1 ? 'item' : 'items'
```

isn't a simplification — it's a rule that exists in a handful of languages, hard-coded into your
source where **no translator can fix it**. (It's also wrong in English: `1.5` selects `other`, so
"1.5 item" is what that ternary produces.)

`Intl.PluralRules` gives the category; **ICU MessageFormat lets the translation file supply a string
per category**, which is where that decision belongs:

```
{count, plural,
   =0 {You have no messages}
  one {You have one message}
other {You have # messages}}
```

`=0` (exact match, checked first, works in every language) is different from the `zero` category (a
grammatical category only some languages have). Exact matches are the clean way to special-case.

## The concatenation trap

| Code | Breaks |
|---|---|
| `` `You have ${n} ` + (n===1?'message':'messages') `` | plurals, word order; the translator sees fragments |
| `'Delete ' + itemType + '?'` | gender/case agreement — German needs den/die/das, Russian declines |
| `'Showing ' + a + ' to ' + b + ' of ' + c` | word order — many languages put the total first |
| `label + ':'` | French puts a space before a colon; Japanese uses a different one |
| `` `${count} results for "${q}"` `` | **nothing** — one whole template is fine |

**A message is a whole sentence with named placeholders.** Two reasons:

1. **Grammar.** Word order differs, nouns decline, adjectives agree. A fragment can't express any of
   it.
2. **Context.** A translator sees "Delete" in a spreadsheet with no idea whether it's a button, a
   menu item, or part of "Delete 3 files?". Fragments make good translation *impossible*, not merely
   harder.

The corollary that surprises people: **interpolating a whole template is fine.**
`t('search.results', {count, query})` gives the translator the full sentence with placeholders they
can move.

## Ordinals, gender, context

- **Ordinals** are a separate rule set: `Intl.PluralRules(l, {type: 'ordinal'})`. English st/nd/rd/th
  isn't "look at the last digit" — 11th/12th/13th break that, and 111th breaks the naive fix.
- **Gender:** ICU has `{gender, select, female {She} male {He} other {They}}`. The data question
  underneath: do you know it, and should you? Often the answer is to write around it.
- **Context/disambiguation:** "Post" the verb vs the noun; "Free" as price vs liberty. Namespace your
  keys and add a **description** field — that description is an *input* to translation, and its
  absence is the most common cause of embarrassing translations.

## The rules

| Do | Not |
|---|---|
| a message is a whole sentence | fragments joined in code |
| named placeholders | positional `%s` |
| plurals via ICU / `PluralRules` | `count === 1 ? a : b` |
| a key + a description | the English string as the key |
| numbers/dates via `Intl`, outside the string | formatted inside the translation |
| plan for +35% text length | fixed-width buttons |
| **pseudo-localize in CI** | discovering it after translation |

**The English string as key** is a popular design that fails two specific ways: fixing a typo orphans
every translation, and two identical English strings needing different translations collapse into
one key. Structured keys + descriptions avoid both, at the cost of call-site readability. Choose
deliberately.

## Pseudo-localization

The highest-value item on that list, and an afternoon's work:

```
"Save changes"  →  "[!!! Şåvé çhåñgéš ~~~~~~~ !!!]"
```

Accents prove the string went through your i18n layer; padding simulates German expansion; brackets
reveal truncation and concatenation instantly. Any string still in plain English is hard-coded.

Put it behind `?locale=pseudo` in staging and run screenshot tests against it. You'll find hard-coded
strings and clipped buttons months before a translator does.

## Think about

- Your designer wants "1 item" / "2 items" / "many items". Is that i18n-able?
- Why are positional placeholders (`%s`) worse than named ones?
- How do you translate a string containing a link?

<details>
<summary>Answers</summary>

**"many items".** The category `many` exists but means something different per language — in Polish
it's a grammatical class covering 5–21, not "a lot". If the designer wants a *semantic* bucket
("more than 20"), express it in code as a separate message key (`inbox.manyMessages`) chosen by your
own threshold, and let each language pluralize *that* message normally. Don't overload the plural
category.

**Positional `%s`.** The translator can't reorder them — "%s bought %s" must keep buyer-then-item,
but plenty of languages want the object first. Named placeholders (`{buyer} bought {item}`) can be
moved freely, and they're self-documenting, which halves the context problem.

**A string with a link.** Never split it into "Read our " + link + " for details". Use rich-text
message formatting: `t('terms', {link: chunks => <a href="/terms">{chunks}</a>})` against a message
like `By continuing you accept our <link>terms</link>`. The translator gets one sentence and can put
the link wherever the grammar needs it. FormatJS and i18next both support this.
</details>

---

## 🏗️ Build challenge

1. Grep for string concatenation around translated text. That's your backlog.
2. Convert your plurals to ICU. Start with the counts users actually see.
3. Add descriptions to every key. Yes, all of them — it's the highest-leverage translation input.
4. Build pseudo-localization and wire it to `?locale=pseudo`.
5. Add CI checks: missing keys, unused keys, ICU syntax validity, and **placeholder-set equality**
   between each translation and the source.
6. Run your screenshot tests in pseudo and fix the clipping.

**Done when:** the pseudo locale shows no plain-English strings and no clipped text.

---

## Interview questions

1. How many plural forms does Arabic have, and what does that mean for your code?
2. Why is string concatenation untranslatable?
3. `=0` vs the `zero` category.
4. What's pseudo-localization and what does it catch?
5. Structured keys vs English-as-key — trade-offs?
