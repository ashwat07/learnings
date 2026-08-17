# Lab 05 — Audit it ⭐⭐⭐⭐⭐

**Goal:** turn labs 01–04 into a check that runs on every deploy, and find something real with it.

**Primary metric:** zero error-level findings on your own site's top routes.

> Open <http://localhost:8080/seo-for-rendering/labs/05-seo-audit/>
> CLI: `node seo-audit.mjs https://example.com/product/123`

---

## The tool

`seo-audit.mjs` in this folder is a working, dependency-free auditor. It fetches the **raw HTML**
and checks:

| Category | Checks |
|---|---|
| indexability | `noindex` in meta **and** in the `X-Robots-Tag` header; non-200 status |
| content | words in the raw HTML, `h1` count, link count |
| metadata | title (presence + length), description, canonical (presence + absolute), `lang`, viewport |
| social | `og:title`, `og:image` (presence + absolute), `twitter:card` |
| images | missing `alt` |
| structured data | valid JSON, `@context`, `@type`, price format, currency code, availability URL |

Exit code 1 on error-level findings, so it gates a deploy.

```sh
node seo-audit.mjs https://example.com/                       # one URL
node seo-audit.mjs --json https://example.com/ | jq           # machine-readable
node seo-audit.mjs $(curl -s https://example.com/sitemap.xml | grep -o 'https://[^<]*' | head -20)
```

## What the sandbox audit shows

Run the in-page audit across all seven modes. The pattern is the whole course in one table:

- **Metadata is independent of rendering strategy.** The CSR page *with* metadata passes every
  metadata check and still has no content. Two different problems; you need both fixed.
- **The RSC row** has the data in the HTML and no words in the DOM — which is why "we use RSC"
  isn't an answer to "is it indexable". Check the output, not the architecture.
- **Streaming** is fine for content and needs care in `<head>` (Lab 02).

## Run it on something real

Pick a site you work on and audit its top 20 URLs by traffic. First runs typically find:

- **duplicate titles** across routes (a template that forgot to interpolate)
- **a missing or relative canonical**
- **an `og:image` that 404s** for an anonymous fetch (behind auth, or a WAF blocking bots)
- **a `noindex`** somewhere it shouldn't be
- **JSON-LD with a currency symbol in `price`**

Write down each finding, the user-visible consequence, and the fix. That list is the deliverable —
the tool is just what produced it.

## The limits of a static audit — say these out loud

A tool that fetches HTML cannot tell you:

- **What Googlebot sees after rendering.** Use Search Console's URL Inspection, or add a
  headless-browser pass (below).
- **Whether your structured data describes visible content** (Lab 03's uncheckable rule).
- **Whether your titles are any good.** Length is checkable; persuasiveness isn't.
- **Whether the page deserves to rank.** None of this is a substitute for the content being worth
  finding.

Being explicit about what your tool doesn't cover is part of shipping it. A green audit that
someone reads as "our SEO is fine" is worse than no audit.

---

## 🏗️ Build challenge: make it a gate

Extend `seo-audit.mjs`:

1. **`--render`**: a headless-browser pass that loads the URL, waits for network idle, and diffs the
   rendered DOM against the raw HTML. Report **what content only exists after JS** — that's the
   single most valuable output for a JS-heavy site, and nothing else produces it.
2. **`--crawl <sitemap>`**: audit every URL in a sitemap, with concurrency and a rate limit (don't
   hammer your own origin). Report the distribution rather than 5,000 individual results.
3. **Cross-URL checks** that only make sense in aggregate: duplicate titles, duplicate descriptions,
   canonical chains (A→B→C), orphans, URLs in the sitemap that 404 or redirect.
4. **`--budget`**: fail on thresholds (`words>=150`, `errors==0`, `duplicate-titles==0`) so it can
   run in CI.
5. **Verify the `og:image`** with a HEAD request and no cookies; check dimensions and size.
6. **A baseline diff**: store the last run and report *changes*, so a PR shows "this PR added a
   noindex to /pricing" rather than a wall of pre-existing findings. This is what makes a checker
   survive contact with a real codebase — a tool that reports 400 known issues gets muted on day
   two.

**Done when:** it runs in your CI on every PR against a preview deployment, it fails on a
deliberately added `noindex`, and its baseline diff means the output is short enough that people
read it.

---

## Interview questions

1. What can a static HTML audit tell you, and what can it not?
2. How would you check what Googlebot sees after rendering?
3. Your audit reports 400 findings on an existing site. How do you make it useful?
4. Which single check would you add first to a CI pipeline, and why?
5. How do you check an `og:image` properly?
6. What's the difference between an audit that finds problems and one that prevents them?
