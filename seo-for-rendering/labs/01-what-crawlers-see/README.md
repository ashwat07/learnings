# Lab 01 — What crawlers see ⭐⭐⭐⭐⭐

**Goal:** answer, for any URL, "is the content in the HTML?" — in one command, with no debate.

**Primary metric:** words of text, links, and metadata present in the raw response.

> Open <http://localhost:8080/seo-for-rendering/labs/01-what-crawlers-see/>

---

## The method

Fetch the URL, parse it **without executing scripts**, and see what's there. `DOMParser` does
exactly this — it builds a document and runs nothing, which is the same view a non-JS consumer has.

```js
const doc = new DOMParser().parseFromString(html, 'text/html');
doc.body.textContent;                    // the text a crawler can index
doc.querySelectorAll('a[href]').length;  // the links it can follow
doc.querySelector('meta[name=description]')?.content;
```

On a real site it's one command:

```sh
curl -s https://example.com/product/123 | less
```

If the content isn't in there, it doesn't exist for most of the web.

## Measure it

| mode | words | links | headings | description? | JSON-LD |
|---|---|---|---|---|---|
| csr | | | | | |
| ssr | | | | | |
| ssr-par | | | | | |
| stream | | | | | |
| rsc | | | | | |

## What the numbers mean

**CSR is an empty document.** Not "slower to index" — empty. A skeleton, a script tag, no text, no
links to follow. Every claim about SEO and CSR reduces to whether you trust one crawler's
JS-rendering queue to fill that in.

**RSC is the interesting row.** The data *is* in the HTML — inside the flight payload `<script>` —
but it isn't in the DOM as text or links, so a text extractor finds nothing. Real RSC frameworks
solve this by **also** server-rendering the payload to HTML. Which means: *"we use RSC" tells you
nothing about SEO.* Check the output, not the architecture. (Run the raw-HTML view on `rsc` and
see for yourself.)

**Streaming is fine for content** and has a `<head>` caveat — Lab 02.

## Who actually runs your JavaScript

| Consumer | Executes JS? | Consequence |
|---|---|---|
| Googlebot | yes, deferred second pass | indexed eventually, on a budget you don't control |
| Bingbot | partially | unreliable |
| Slack / WhatsApp / X / Discord / iMessage | **no** | your link previews are broken |
| GPTBot / ClaudeBot / PerplexityBot | mostly no | invisible to an increasing share of traffic |
| Internal tools, monitors, archives | no | |

"Google renders JS" is true and insufficient. The share of traffic arriving through consumers that
*don't* is going up, not down.

## Two-wave indexing, honestly

Googlebot crawls, indexes what's in the HTML, and queues JS-dependent pages for rendering later.
Google has said the delay is usually small now — but "usually small" is a different guarantee from
"in the response", and it applies to one crawler. What the deferred pass costs you in practice:

- Content indexed later than competitors' (matters for news, launches, stock).
- Rendering happens with a budget; large or slow pages can be truncated or skipped.
- Any content requiring interaction (click "load more", open a tab) is never seen.
- Your *link previews* are broken regardless, because scrapers don't have a second wave at all.

## Think about

- Your SPA ranks fine. Does that prove client-side rendering is safe?
- Which content on your site is behind a click, a scroll, or a fetch?
- What does a Slack preview of your product page look like right now?

<details>
<summary>Answers</summary>

**"We rank fine."** It proves Googlebot rendered *those* pages. It says nothing about the pages that
weren't rendered (you can't see the absence), about other search engines, about social previews, or
about LLM crawlers. And it's fragile: a JS error, a slow third-party script, or a new
render-blocking dependency can silently remove pages from the index, with the symptom appearing
weeks later as a traffic decline nobody can attribute.

**Behind a click.** Common offenders: tabbed content, "read more" expanders, infinite scroll,
filtered lists, reviews loaded on scroll, FAQ accordions rendered client-side. If the text only
exists after an interaction, treat it as not indexed. Server-render it and use CSS/`<details>` to
collapse it visually — that's indexed *and* collapsed.

**Slack preview.** Paste your URL into a Slack DM to yourself. If you get a bare URL or the wrong
image, your OG tags aren't in the HTML. This is a 10-second check that finds real bugs, and Lab 02
is the fix.
</details>

---

## 🏗️ Build challenge: a no-JS diff

Build `crawler-view.mjs`:

```sh
node crawler-view.mjs https://example.com/product/123 --compare-rendered
```

1. Fetch the raw HTML and report the no-JS view: title, meta, headings, word count, links,
   canonical, structured data.
2. With `--compare-rendered`, load the same URL in a headless browser, wait for network idle, and
   diff the two: **what content only exists after JavaScript?** That diff is the actionable output —
   it's the list of things invisible to non-JS consumers.
3. Add `--as googlebot|slackbot|gptbot` to send the real user agents and compare responses. Some
   sites serve different HTML to bots, which is worth knowing about (and is a risk: divergence
   between what users and crawlers see is the definition of cloaking).
4. Crawl N pages from the sitemap and report the distribution — pages with under 100 words in the
   raw HTML are your risk list, ranked by traffic.
5. Check the social preview specifically: fetch as a scraper (no JS) and report exactly what a
   Slack/X/WhatsApp card would show, including whether the OG image URL resolves and is under the
   size limits.

**Done when:** it produces a ranked list of URLs whose content is JS-only for a real site, and the
top item is something the team didn't know about.

---

## Interview questions

1. How do you check what a crawler sees, in one command?
2. Googlebot runs JavaScript. Why isn't that the end of the discussion?
3. Your React SPA ranks well. What does that prove and what does it not?
4. What's the SEO status of content behind a "load more" button?
5. Why can an RSC page be invisible to a text extractor even though the data is in the HTML?
6. Which consumers never run JS, and what breaks for them?
