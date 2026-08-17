# Lab 02 — Metadata ⭐⭐⭐⭐

**Goal:** get every page's metadata right in the HTML, and know the three traps that make it wrong
in ways nobody notices for a month.

**Primary metric:** zero failures on the checklist, and a social card that renders.

> Open <http://localhost:8080/seo-for-rendering/labs/02-metadata/>

---

## The checklist

| Field | Rule | Why |
|---|---|---|
| `<title>` | 15–60 chars, important words first | Strongest on-page signal; truncates at ~55–60 |
| `meta description` | ≤ 160 chars | Not a ranking factor — it's the snippet people decide on. Omit it and Google writes one |
| `link rel=canonical` | self-referencing, absolute | Without it, `?utm_source=…` is a separate competing page |
| `og:title` / `og:description` | present | Or scrapers show a bare URL |
| `og:image` | **absolute URL**, 1200×630, publicly fetchable | Relative URLs are ignored. Behind auth = blank card |
| `og:url` | canonical URL | |
| `twitter:card` | `summary_large_image` | Otherwise you get the small card |
| `<html lang>` | set | Search, translation prompts, screen-reader pronunciation |
| `viewport` | set | Mobile-friendliness is a ranking factor |
| `robots` | **check for a stray `noindex`** | The most expensive one-line bug in SEO |

Run the checker against the page with and without `?meta=full` and compare.

## The social card

Run **render the social card**. That's roughly what Slack, X, WhatsApp, Discord and iMessage
produce — **from the HTML alone, with no JavaScript**.

`og:image` rules that catch people:

- Must be **absolute**. Relative URLs are silently ignored.
- 1200×630, under ~5MB.
- **Must be publicly fetchable.** Behind auth, behind a bot-blocking WAF, or requiring cookies →
  blank card. This is the number one cause of "our preview is broken".
- Scrapers **cache aggressively**. After fixing tags, re-scrape (Facebook sharing debugger, X card
  validator) or the old card sticks around.

Ten-second test for any real site: **paste the URL into a Slack DM to yourself.**

## The three traps

**1. Metadata set by the client router.** `react-helmet`, `document.title = …`, or `next/head` in a
client component all run *after* JavaScript. Googlebot may see them. **No social scraper will.**

> Test: `curl` the URL. If the title in the response is "My App" for every route, every share
> preview on your site says "My App".

**2. Metadata that depends on slow data, on a streamed page.** `<head>` is flushed first, so
anything in it must be known **before the first byte**. If your `<title>` needs the 900ms query,
you either wait for it (losing streaming for that route) or ship a placeholder.

Frameworks paper over this by injecting a late `<title>` via script — fine for browsers, a gamble
for crawlers. Honest options: derive the title from something you already have (the URL slug), fetch
just that one field before flushing, or don't stream that route. This is a direct consequence of
[rendering-strategies lab 03](../../../rendering-strategies/labs/03-streaming/).

**3. A stray `noindex`.** A staging default, a CMS toggle, a `robots` meta on a shared layout.
Symptom: traffic falls off a cliff a week after a deploy, because deindexing isn't instant.
**Assert on it in CI for every public route.**

Plus two more from the table on the page: a canonical built from the request URL (including query
parameters — so every `?utm_source` page canonicalises to itself), and an unreachable `og:image`.

## Where metadata belongs, by framework

| Framework | Server-rendered metadata |
|---|---|
| Next.js App Router | the `metadata` export / `generateMetadata()` — **not** a client component |
| Next.js Pages Router | `next/head` in a page (server-rendered), not in a `useEffect` |
| Remix / React Router | the `meta` export |
| SvelteKit | `<svelte:head>` in a `+page.svelte` rendered on the server |
| Astro | the frontmatter + `<head>` |
| Vanilla | your template |

The rule under all of them: **the metadata must be a function of the route and its data, evaluated
on the server.**

## Think about

- Your title is 90 characters. What actually happens?
- Should every page have a canonical, including the canonical page itself?
- A page has three `<h1>`s. Is that a problem?

<details>
<summary>Answers</summary>

**90-char title.** Google truncates the display at ~55–60 characters (it's pixel-based, not
character-based, so it varies). The full title is still read for ranking, but the user sees the
first half — so the branding you put at the end is invisible and the words that would earn the
click may be cut. Front-load the distinguishing words; put the brand last, where losing it costs
nothing.

**Self-referencing canonicals.** Yes. It's explicitly recommended: it resolves query-parameter
variants, protocol/host variants (`www` vs apex, http vs https), and trailing-slash variants to one
URL, and it costs nothing. The bug to avoid is generating it from the *request* URL, which makes
every variant canonicalise to itself and defeats the purpose.

**Three h1s.** Legal in HTML5 and not a ranking penalty. It *is* a signal that the page's structure
isn't deliberate — heading hierarchy is used by screen readers for navigation, and by search engines
to understand structure. One `h1` describing the page, `h2`s for sections, is a discipline worth
keeping for accessibility reasons even if search doesn't care.
</details>

---

## 🏗️ Build challenge: metadata as a build artefact

Metadata bugs are all "someone forgot" bugs, which means they're preventable mechanically.

Build `meta-check.mjs`:

1. Crawl every route (from the sitemap, or the router config) and run the full checklist.
2. **Fail CI on**: missing/duplicate titles across routes, missing canonical, `noindex` on a public
   route, relative `og:image`, missing `lang`. Duplicate titles across routes are the most common
   real finding — a template that forgot to interpolate.
3. **Verify the `og:image` actually loads** with a HEAD request *and no cookies*, and check its
   dimensions. This catches the auth/WAF case that a local check never would.
4. Compare `curl`'d HTML against browser-rendered HTML and fail if metadata only exists after JS.
5. Emit a report of every route's title/description so a content person can review them as a
   spreadsheet — the review is usually more valuable than the automation.
6. Snapshot-test the social card: render the tags into an HTML preview and store it as a CI
   artefact, so a reviewer sees what a share will look like in the PR.

**Done when:** it catches a duplicate title, a `noindex`, and an `og:image` that 404s for an
anonymous fetch — on a real site.

---

## Interview questions

1. Why must metadata be server-rendered, given that Googlebot runs JavaScript?
2. What breaks if `og:image` is a relative URL?
3. Your streamed page's title depends on a slow query. What are your options?
4. What's a self-referencing canonical and why bother?
5. How would you catch a stray `noindex` before it costs you a month of traffic?
6. Title is 90 characters. What does the user see, and what does Google use?
