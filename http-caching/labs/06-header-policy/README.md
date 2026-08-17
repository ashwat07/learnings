# Lab 06 — Design a header policy ⭐⭐⭐⭐⭐⭐

**Goal:** produce and defend a complete caching policy for a real application, resource type by
resource type — the actual senior-interview exercise.

**Primary metric:** blocking requests and bytes on a returning visit, with zero correctness
violations.

> Open <http://localhost:8080/http-caching/labs/06-header-policy/>

---

## Part 1 — the designer (on the page)

Sixteen resource types. For each, pick a `Cache-Control` policy, a `Vary`, and a validator, then
grade yourself. Read every explanation, including the ones you got right — several rows have more
than one defensible answer and the difference is a trade you should be able to state.

Do it once cold, before reading anything below. Write your score down.

Then read the model answer, and do the harder exercise: **for every row, say what would have to
change about the application to allow a better policy.** Header design is downstream of URL
design. "Hash the avatar filename on upload" is a better fix than any header.

## The policy that covers 90% of apps

```
# the pointer — must be re-fetched to learn the new URLs
/index.html            Cache-Control: no-cache
                       ETag: "<content hash>"

# content-addressed — the URL changes when the bytes change
/assets/*.[hash].*     Cache-Control: public, max-age=31536000, immutable
                       Vary: Accept-Encoding

# public API data, staleness is invisible
GET /api/catalogue     Cache-Control: public, max-age=60, stale-while-revalidate=86400
                       ETag, Vary: Accept-Encoding

# per-user data
GET /api/me            Cache-Control: private, no-cache
                       ETag

# the user's own writes
GET /api/cart          Cache-Control: private, no-cache
                       ETag

# writes
POST /api/*            Cache-Control: no-store

# the service worker, if any
/sw.js                 Cache-Control: no-cache
```

Four rules generate almost all of it:

1. **Immutable content gets an immutable URL and a year.**
2. **Mutable pointers (HTML, SW, manifest) get `no-cache` + a validator.**
3. **Per-user data gets `private`.** `private` means "not shared", which is what people usually
   mean when they reach for `no-store`.
4. **Staleness the user didn't cause is negotiable (SWR). Staleness the user did cause is not.**

## Part 2 — audit a real site

`check-policy.mjs` in this folder is a working auditor. Run it:

```sh
node check-policy.mjs https://your-site.example/
node check-policy.mjs --from-page https://your-site.example/     # pulls subresources out of the HTML
node check-policy.mjs --json https://your-site.example/app.js | jq
```

It checks freshness arithmetic (including `Age`), whether validators are actually honoured, and
about a dozen rules from Labs 01–05. Exit code 1 if it finds anything error-level.

Run it against:

- [ ] a site you work on
- [ ] a large e-commerce site
- [ ] a documentation site (these are usually excellent)
- [ ] a news site (these are usually a mess)

For each finding, write one sentence: what would a user experience because of it? "No
`Vary: Accept-Encoding` on a compressed response" is a fact. "A proxy could serve gzipped bytes to
a client that can't decode them, producing garbage" is a finding.

## 🏗️ Build challenge: make it a policy *enforcer*

Auditing after the fact is worth less than preventing. Extend `check-policy.mjs` into
`policy-check` — a CI gate.

Requirements:

1. **A declarative policy file** describing intent, not headers:

   ```yaml
   rules:
     - match: "/assets/**/*.[hash].*"
       immutable: true
     - match: "*.html"
       revalidate: always
       private: when-authenticated
     - match: "/api/**"
       default: private-no-cache
       overrides:
         "/api/catalogue": { maxAge: 60, staleWhileRevalidate: 86400, public: true }
   ```

   Compile that into the headers each rule implies, and verify the live site matches. The
   indirection matters: reviewers can read intent, and the same file can generate config for
   nginx / Netlify `_headers` / Cloudflare / S3 metadata.

2. **Detect the fingerprint pattern automatically** — don't rely on a regex someone forgot to
   update. Fetch a URL twice across two deploys (or compare against a manifest) and classify.

3. **Report the cost, not just the violation.** For each finding, estimate the bytes and requests
   it costs per 1,000 returning visitors, and sort by that. A policy report that isn't sorted by
   impact gets ignored.

4. **A `--budget` mode** that fails CI if a returning visit would exceed N blocking requests or
   M KB. This is the version that actually changes behaviour on a team, because it turns caching
   from an opinion into a build failure.

5. **Handle redirects, `Content-Encoding` negotiation, and HTTP/2 vs /3** correctly, and say in
   the README which of these your tool ignores. Being explicit about your tool's blind spots is
   part of the deliverable.

**Stretch:** add a mode that reads a HAR file from a real user session and reports what a *second*
visit would have looked like under the current policy vs the proposed one.

**Done when:** you can run `policy-check --budget requests=5,kb=50` in CI against a staging
deployment, it fails on a deliberately broken header, and the failure message tells the developer
exactly which file and which directive.

---

## The write-up (do this — it's the actual deliverable)

Produce a one-page caching policy document for an app you work on. Sections:

1. **Asset classes** — the 5–8 categories your app actually has.
2. **The policy per class**, with the header string.
3. **Why**, one sentence each, naming the failure mode it prevents.
4. **What has to be true for it to work** — e.g. "requires content-hashed filenames from the
   build", "requires the CDN to strip cookies on `/assets/*`".
5. **How we'd know it broke** — the metric or alert.

If you can write that page, you can answer any caching question in an interview, because every
question is a request to justify one of its lines.

---

## Interview questions

1. Walk me through the caching headers for a typical SPA, top to bottom.
2. Which resource in a modern web app must never be cached long, and why does everything else
   depend on it?
3. When would you use `private` instead of `no-store`? Give the byte cost of getting it wrong.
4. A returning user loads your app and makes 40 requests, all of which are 304s. Is that good?
5. Your CDN and your browser cache want different lifetimes. How do you express that?
6. How would you prove, with data, that a caching change was worth making?
