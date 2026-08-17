# Lab 04 — Crawlability ⭐⭐⭐⭐

**Goal:** control which URLs get crawled and which get indexed, and stop your URLs competing with
each other.

**Primary metric:** every public route crawlable and indexable; every duplicate resolved to one
canonical.

> Open <http://localhost:8080/seo-for-rendering/labs/04-crawlability/>

---

## The distinction everything depends on

> **robots.txt controls CRAWLING. `meta robots` controls INDEXING.**

Get this backwards and you produce the most common "we tried everything" situation in SEO:

- You `Disallow` a page to keep it out of the index.
- The crawler never fetches it — so it **never sees your `noindex`**.
- Other sites link to it, so it gets indexed anyway, as a bare URL with no snippet.
- Nothing you add to the page can fix it, because nothing on the page is ever read.

**To remove a page from the index: allow crawling, serve `noindex`.**

## robots.txt matching (not what you think)

Run the tester. The rules:

- Only **one group** applies — the most specific `User-agent` match.
- Within it, **the longest matching path wins**, regardless of order in the file.
- Ties go to `Allow`.
- `*` matches any sequence; `$` anchors the end.

So this allows `/search/help` even though the `Disallow` comes first:

```
Disallow: /search
Allow: /search/help
```

"I put the Allow first" is not a fix for anything, because order is irrelevant.

### The traps

| Trap | Consequence |
|---|---|
| `Disallow` to prevent indexing | Blocks crawling, not indexing — see above |
| Blocking `/_next/static`, `/assets`, `/*.js` | **The crawler can't render your page.** A CSR site becomes an empty shell |
| `noindex` **and** `Disallow` | The `noindex` is never read; the page stays indexed indefinitely |
| Staging `robots.txt` deployed to production | `Disallow: /` — the entire site drops out over days |
| Relying on `Crawl-delay` | Ignored by Google |

The staging-robots case is a genuine outage-class incident. Assert on production's `robots.txt` in
CI, and alert on indexed page count.

## Sitemaps

| Rule | Detail |
|---|---|
| 50,000 URLs / 50MB per file | Beyond that, a sitemap **index**. Split by section so Search Console shows you indexing per section |
| Absolute URLs, same host | Relative `<loc>` is invalid |
| `lastmod` **is** used | It influences recrawl scheduling — but only if honest. Setting it to "now" every build teaches the crawler to ignore it |
| `priority` / `changefreq` | **Ignored by Google.** Harmless noise |
| Only canonical, indexable URLs | A sitemap containing noindexed or redirected URLs is a contradiction, and a common source of Search Console warnings |
| Reference it in `robots.txt` **and** submit it | Both |

## Canonicals

| Situation | Canonical |
|---|---|
| `/products?page=2` | **self** |
| `/products?utm_source=email` | `/products` |
| `/products?sort=price` | `/products`, usually |
| `/products?colour=blue` (a facet) | self **if** it's a page you want ranked; otherwise noindex it |
| `http`/`https`, `www`/apex | one chosen host — and **redirect**, don't rely on canonical |
| Syndicated copy elsewhere | the original URL (cross-domain canonical) |
| Infinite scroll | back it with real paginated URLs |

### Pagination is the expensive one

Canonicalising `/products?page=2` to `/products` tells Google page 2 is a duplicate of page 1 — so
**the products that only appear on page 2 are never indexed.** This is self-inflicted deindexing and
it's extremely common.

Correct handling:

- Each page self-canonicalises.
- Each page links to next/previous with **real `<a href>`** (`rel=next/prev` is no longer used by
  Google, but the links are how the crawler walks the set).
- Every item is reachable within a few clicks of an indexable page.
- Infinite scroll is backed by paginated URLs that render server-side.

**A canonical is a hint, not a directive.** Google ignores canonicals it disagrees with — usually
when your internal links and sitemap say something different. Make all your signals agree.

## `noindex` traps

The one that hides best: **`X-Robots-Tag` as an HTTP header.** A CDN, WAF or platform default can
add it, and it's invisible in the HTML.

```sh
curl -sI https://example.com/page | grep -i x-robots-tag
```

And deindexing isn't instant — the symptom appears days or weeks after the deploy that caused it,
by which time nobody connects them. **Assert on it in CI** for every public route, checking both the
meta tag and the header.

## Think about

- You want a thank-you page out of Google. `robots.txt` or `noindex`?
- Your faceted navigation produces 40,000 URL combinations. What's your strategy?
- Should `/products?page=2` be `noindex`?

<details>
<summary>Answers</summary>

**Thank-you page.** `noindex`, and *allow* crawling so the tag is read. If it's genuinely sensitive,
neither is a security control — put it behind auth.

**40,000 facets.** Decide which facets are *landing pages* (the ones people search for: "blue
running shoes") and make those indexable, self-canonical, and linked. Everything else: `noindex` or
block the parameter in Search Console's parameter handling / robots.txt. The failure mode of doing
nothing is crawl budget spent on 40,000 near-duplicates instead of your actual products.

**`noindex` on page 2.** No — that's the same mistake as canonicalising it away. Items that only
appear on page 2 stop being indexed. Self-canonical, indexable, linked. The "duplicate content"
worry about pagination is folklore; the pages aren't duplicates, they have different items on them.
</details>

---

## 🏗️ Build challenge: a crawl budget audit

`crawl-audit.mjs` — crawl your own site the way a bot would and report what it finds.

1. Start from the sitemap and from `/`, follow `<a href>` links (respecting `robots.txt` with the
   **longest-match** rules you implemented here), up to N pages.
2. For each URL record: status, canonical, `noindex` (meta **and** header), title, word count in the
   raw HTML, and inbound internal link count.
3. Report:
   - **orphans** — in the sitemap but not linked from anywhere (nothing will find them naturally)
   - **dead ends** — pages with no outbound internal links
   - **canonical conflicts** — page A canonicalises to B, but B canonicalises to C
   - **sitemap contradictions** — URLs in the sitemap that are noindexed, redirected, or 404
   - **duplicate titles** across URLs
   - **crawl depth** — how many clicks from the home page each URL is; anything beyond 4 is at risk
4. Estimate crawl budget waste: how many URLs are near-duplicates of each other (same title, same
   word count, differing only by a query parameter).
5. Output a graph (DOT/mermaid) of the internal link structure for the top N pages — the picture
   usually reveals the problem faster than the table.

**Done when:** it finds a real orphan and a real canonical conflict on a site you didn't build for
this exercise.

---

## Interview questions

1. What's the difference between `robots.txt` and `meta robots`?
2. Why doesn't `Disallow` remove a page from the index?
3. In `robots.txt`, which rule wins between `Disallow: /search` and `Allow: /search/help`?
4. What should `/products?page=2` canonicalise to, and why does the wrong answer cost you?
5. Where can a `noindex` hide where you won't see it in the HTML?
6. Which sitemap fields does Google actually use?
