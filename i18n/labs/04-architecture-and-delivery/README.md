# Lab 04 — Architecture & delivery ⭐⭐⭐⭐

**Goal:** decide where translations live, how a locale is chosen, and what the URL looks like.

> <http://localhost:8080/i18n/labs/04-architecture-and-delivery/>

---

## Locale detection, in precedence order

1. **An explicit user choice, persisted.** It outranks everything, forever. Store it in a **cookie**
   so the server can honour it on the first byte.
2. **The URL** (`/de/…`). Shareable and crawlable.
3. `Accept-Language` / `navigator.languages`, matched properly against what you support.
4. A default.

### Three things never to do

- **Never geolocate by IP to choose a language.** Country isn't language — Switzerland has four,
  Spanish spans twenty countries, and a tourist gets something they can't read.
- **Never redirect automatically without an escape.** If you must, show a persistent "View in
  English" and remember the choice.
- **Never use only `navigator.languages[0]`.** It's an *ordered list*; someone whose first
  preference you don't support may speak their second fluently.

Region matters separately from language: `en-GB` vs `en-US` is spelling, dates and currency, not a
different translation file.

## URL strategies

| Strategy | SEO | Note |
|---|---|---|
| **`/de/products`** (path prefix) | best | the default recommendation |
| `de.example.com` | good | separable infra; cookie/auth complexity |
| `example.de` (ccTLD) | strongest regional signal | expensive to operate |
| `?lang=de` | weak | often stripped, poorly cached |
| **cookie only, one URL** | **worst** | a shared link opens in the wrong language |

The cookie-only failure is concrete: **a URL must identify its content.** Otherwise a shared link
opens differently per person, a CDN can't cache it without a `Vary` that destroys hit rate, and
crawlers index one version.

Whichever you pick, the SEO plumbing is the same and isn't optional:

```html
<link rel="alternate" hreflang="de"        href="https://example.com/de/products">
<link rel="alternate" hreflang="en-GB"     href="https://example.com/en-gb/products">
<link rel="alternate" hreflang="x-default" href="https://example.com/products">
```

`hreflang` must be **reciprocal** (every version links to every other, including itself), each
version's canonical points at **itself**, and `x-default` marks the page for unmatched languages.
See [seo-for-rendering lab 04](../../../seo-for-rendering/labs/04-crawlability/).

And set `<html lang>` and `dir` to match the URL.

## Delivery

| Approach | Cost | When |
|---|---|---|
| all locales in the main bundle | everyone downloads every language | never, beyond 2–3 tiny locales |
| one file per locale, dynamic import | one cacheable request | the default for a CSR app |
| per locale **and** namespace | more requests, smaller each | large apps |
| **server-rendered, strings inlined** | zero client cost, no flash | best when you have a server |
| fetched from a CDN at runtime | a round trip before first paint | when translators publish without a deploy |

**The failure mode that matters: the flash of untranslated content.** The app renders in the default
language, the file arrives, everything re-renders — visible, ugly, and a layout shift as text length
changes.

Ways out, best first: server-render in the right locale (the strongest argument for SSR in a
multilingual product); inline the current locale into the HTML; block first render on the load and
show a skeleton; preload the locale file.

Check whether your dates and numbers come from `Intl` (built in, zero bytes) or a date library with
locale files (kilobytes each). Most apps can delete the second.

## The translation workflow

| Step | How | Why |
|---|---|---|
| extract | a script scans for `t()` calls | never hand-maintain the source file |
| describe | every key has a description + screenshot | context is an *input* to translation |
| send | push to the TMS from CI | a manual step stops happening |
| translate | humans, with context | MT is a first draft |
| pull | a PR adding the files | reviewable, revertable, versioned |
| **validate in CI** | missing/unused keys, ICU syntax, **placeholder-set equality** | a missing `{count}` is a crash |
| fall back | missing key → source language, **and log it** | never show a raw key |
| pseudo-localize | a fake locale + screenshot tests | finds hard-coded strings early |

**Placeholder mismatch validation** earns its keep on day one: `{cont}` instead of `{count}`, from a
typo in a file nobody on your team reads, produces a literal `{cont}` on screen or a thrown error. A
CI check comparing placeholder sets catches it in seconds.

**Never ship a raw key to a user.** `checkout.button.submit` on a page is the most recognisable sign
of a broken pipeline. Fall back to the source language and alert.

**Translation is asynchronous to development.** Shipping with English and translating a week later is
normal *provided* the fallback is clean and extraction is automatic. Blocking releases on translation
is what makes teams hard-code strings "just for now".

## Think about

- Should `/de/` and `/de-AT/` be separate?
- A translator finds a typo. How long to production?
- What breaks when you add your first RTL language?

<details>
<summary>Answers</summary>

**`/de/` vs `/de-AT/`.** Only if the content genuinely differs — different prices, legal text,
availability, or vocabulary (Austrian German differs in everyday nouns). If it's the same
translation, one `/de/` route with regional *formatting* derived separately is cheaper to run and
avoids splitting your SEO signal across near-duplicate pages. Add the region when there's a business
reason, not preemptively.

**Typo to production.** Depends on the architecture you chose, and this is the question that decides
it. Bundled translations: a full deploy — hours to days. Runtime-fetched from a TMS or CDN: minutes,
no deploy. Most teams should bundle (fewer moving parts, no runtime dependency, no flash) and accept
deploy latency; teams with large translation teams and frequent copy changes get real value from the
runtime path. Decide which problem you have.

**First RTL language.** Layout, and much more than you expect: every physical CSS property, icon
direction, keyboard arrows, scroll handling, transforms, charts and any absolutely positioned
element. It's the point at which "we support multiple languages" becomes "we support multiple
layouts" — which is why doing logical properties from the start costs nothing and retrofitting them
costs a quarter.
</details>

---

## 🏗️ Build challenge

1. Implement proper locale negotiation: explicit choice → URL → `Accept-Language` → default, with
   `supportedLocalesOf` doing the matching.
2. Move to path-prefix URLs and add reciprocal `hreflang` with `x-default`.
3. Split translations per locale (and per namespace if large), content-hashed and long-cached.
4. Eliminate the flash: server-render the locale, or inline the current one.
5. Add the CI validations, especially placeholder-set equality.
6. Measure: KB per locale, when it loads relative to first paint, and how much of your bundle is a
   date library you can delete.

**Done when:** a shared link opens in the right language for everyone, and no user downloads strings
for a language they'll never see.

---

## Interview questions

1. What's the precedence order for choosing a locale?
2. Why never geolocate to pick a language?
3. Why is a cookie-only locale bad for SEO and caching?
4. What causes a flash of untranslated content, and how do you remove it?
5. What does placeholder-mismatch validation catch?
