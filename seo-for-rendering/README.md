# SEO for rendered content ⭐⭐⭐⭐

SEO for a modern app is mostly one question: **what does a crawler see when it fetches your URL?**
Everything else — metadata, structured data, sitemaps, canonicals — is bookkeeping on top of that
answer, and all of it is downstream of your rendering strategy.

```sh
./serve.sh    # then http://localhost:8080/seo-for-rendering/labs/01-what-crawlers-see/
```

---

## The model

```
crawler fetches the URL
        │
        ├─ HTML has the content     → indexed now, ranked on what's there
        │
        └─ HTML is an empty shell   → queued for rendering
                                       ├─ rendered eventually (hours to weeks)
                                       ├─ rendered with a budget you don't control
                                       └─ or not rendered at all (many crawlers never do)
```

Googlebot does execute JavaScript. Most other crawlers do not, or do it partially:

| Consumer | Executes JS? |
|---|---|
| Googlebot | yes, in a deferred second pass |
| Bingbot | partially |
| Social scrapers (Slack, WhatsApp, Twitter/X, Discord, iMessage) | **no** — your OG tags must be in the HTML |
| LLM crawlers (GPTBot, ClaudeBot, PerplexityBot) | mostly no |
| Most other bots | no |

So "Google renders JS" is true and insufficient. If your metadata isn't in the initial HTML, your
link previews are broken everywhere, and an increasing share of traffic arrives through consumers
that never run your bundle.

## The sandbox

The rendering sandbox has a `?meta=full` knob that adds real metadata and JSON-LD, so you have a
before and an after on the same page:

```
/render/csr/product/3               an empty shell — what a non-JS crawler gets
/render/ssr-par/product/3           content, minimal metadata
/render/ssr-par/product/3?meta=full content + description, canonical, OG, Twitter, JSON-LD
/render/stream/product/3            content, streamed — with a caveat for <head> (lab 02)
```

## Curriculum

| # | Lab | Question it answers | ⭐ |
|---|---|---|---|
| 01 | [What crawlers see](labs/01-what-crawlers-see/) | Is my content in the HTML, or a promise of content? | ⭐⭐⭐⭐⭐ |
| 02 | [Metadata](labs/02-metadata/) | Title, description, canonical, OG — per route, and the streaming trap | ⭐⭐⭐⭐ |
| 03 | [Structured data](labs/03-structured-data/) | JSON-LD that actually validates | ⭐⭐⭐⭐ |
| 04 | [Crawlability](labs/04-crawlability/) | robots, sitemaps, canonicals, pagination, the noindex traps | ⭐⭐⭐⭐ |
| 05 | [Audit it](labs/05-seo-audit/) | Build the checker and run it on something real | ⭐⭐⭐⭐⭐ |

Prerequisite: [rendering-strategies](../rendering-strategies/) lab 01. SEO is the loudest consumer
of that decision.

## The rule that covers most of it

> **If it matters for search or sharing, it must be in the HTML of the response — not added by
> JavaScript, not added after a fetch, not added on scroll.**

Corollaries: content behind "load more" is often invisible; a title set by a client-side router is
invisible to social scrapers; a canonical injected by JS is unreliable; and a page whose content
arrives via `useEffect` is, to most consumers, an empty page.
