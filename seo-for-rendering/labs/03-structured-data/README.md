# Lab 03 — Structured data ⭐⭐⭐⭐

**Goal:** write JSON-LD that validates, describes what's actually on the page, and doesn't fail
silently.

**Primary metric:** zero errors from the validator, and every claim visible on the page.

> Open <http://localhost:8080/seo-for-rendering/labs/03-structured-data/>

---

## Why it matters and why it fails quietly

JSON-LD tells a search engine what a page *means*: this is a product, that number is its price,
those stars are an aggregate rating. It's what makes you eligible for rich results — star ratings,
prices, FAQ accordions, breadcrumbs in the SERP.

**Nothing throws when it's wrong.** No build error, no console warning, no HTTP failure. You simply
don't get rich results, and nobody tells you why. That's what makes a validator worth having in CI.

## The mistakes that actually happen

Load the **subtly broken** example. Seven problems in twenty lines, all of them real:

| Mistake | Correct |
|---|---|
| No `@context` | `"@context": "https://schema.org"` — **the single most common failure** |
| `"price": "£249.00"` | `"price": "249.00"` — bare number, no symbol, no thousands separator |
| `"priceCurrency": "Pounds"` | `"GBP"` — ISO 4217, three letters |
| `"availability": "InStock"` | `"https://schema.org/InStock"` — the full URL |
| Relative `image` | absolute URL |
| `ratingValue: 6` with `bestRating: 5` | ≤ `bestRating` |
| `reviewCount: 0` | omit the whole `aggregateRating` node |
| `"author": "Ada"` | `{ "@type": "Person", "name": "Ada" }` |

## The rule no validator can check

> **Structured data must describe content that is visible on the page.**

Marking up a 5-star rating no user can see is a manual-action offence, not a clever trick. "We have
reviews on another page" doesn't count. A validator will happily approve markup that gets you
penalised — the check is human.

## The types worth knowing

| Type | Use for | Required |
|---|---|---|
| `Product` + `Offer` | anything sold | `name`; offer needs `price`, `priceCurrency` |
| `Article` / `BlogPosting` / `NewsArticle` | content | `headline`, `datePublished` |
| `BreadcrumbList` | navigation context in the SERP | `itemListElement` with `position` starting at **1** |
| `Organization` | site-wide identity, logo, social profiles | `name` |
| `FAQPage` | Q&A content | `mainEntity` with `Question`/`Answer` |
| `Event`, `Recipe`, `HowTo`, `JobPosting`, `LocalBusiness` | as named | varies |

Two structural notes:

- **One `<script type="application/ld+json">` per page is enough** — use a `@graph` array to hold
  several entities and link them with `@id`. Multiple disconnected blocks work, but linking them
  (product → brand → organization) is what lets a search engine build the entity relationships.
- **A JSON syntax error kills the whole block.** One trailing comma and every entity in it is
  ignored. Generate it with `JSON.stringify`, never with string concatenation — which also handles
  the escaping problem (`</script>` inside a description will terminate your script tag; escape
  `<` as `<`, as the sandbox does).

## Where to put it

Server-rendered, like all metadata (Lab 02). Injected by JavaScript, it's unreliable — Googlebot
may pick it up in the second pass; nothing else will.

## Think about

- Why must `price` be a bare number when the page shows "£249.00"?
- Your product page has an `aggregateRating` and no visible reviews. What's the risk?
- Would you mark up a page with `FAQPage` if the answers are behind an accordion?

<details>
<summary>Answers</summary>

**Bare price.** Because the currency is a separate machine-readable field. `"£249.00"` is a
*rendering* of a price in one locale; a consumer that needs to compare prices or convert currencies
can't parse it reliably (`1.234,56` vs `1,234.56` vs `£1,234.56`). Separating value from currency is
the same principle as storing a timestamp rather than a formatted date.

**Rating with no visible reviews.** A manual action for spammy structured data — which removes rich
results for the whole site, not just that page, and takes a reconsideration request to lift. If the
rating is real but lives elsewhere, show it on the page. If it isn't shown, don't mark it up.

**FAQ behind an accordion.** Yes — that's explicitly fine. The content is in the HTML and visible
after one interaction with no navigation; collapsed-by-default UI is allowed. What isn't fine is
content that has to be *fetched* on expand, because then it isn't in the HTML at all (Lab 01).
</details>

---

## 🏗️ Build challenge: structured data in CI

Extend the validator in `app.js` into something that runs on every build.

1. **Crawl every route**, extract every JSON-LD block, and validate it. Fail on errors, warn on
   recommendations.
2. **Cross-check against the page.** For `Product`, assert that the marked-up `name` and `price`
   appear in the page's visible text. This is the check that prevents the manual-action case, and
   no off-the-shelf validator does it because it needs your page's DOM.
3. **Validate the `@graph`**: every `@id` referenced resolves to a node in the same document; no
   orphaned entities.
4. **Escaping test**: inject `</script>` and `<!--` into a product description and assert the page
   still parses. If your JSON-LD is built by string concatenation, this will break, and it's an XSS
   vector as well as an SEO bug.
5. **Diff against the previous build** and report added/removed structured data per route — a
   silently dropped `Product` block after a refactor is invisible otherwise.
6. Optionally verify against Google's Rich Results Test API for the types it supports, and treat
   your local rules as the fast pre-check.

**Done when:** the escaping test catches a concatenation-built block, and the visible-content check
catches a rating that isn't rendered.

---

## Interview questions

1. What is JSON-LD for, and what happens when it's wrong?
2. Name four common validation failures.
3. Why must structured data describe visible content?
4. One JSON-LD block or several? What does `@graph` buy you?
5. Why is building JSON-LD by string concatenation dangerous?
6. Where must structured data be rendered, and why?
