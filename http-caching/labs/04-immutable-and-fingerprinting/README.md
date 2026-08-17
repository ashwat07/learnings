# Lab 04 — Immutable & fingerprinting ⭐⭐⭐⭐⭐

**Goal:** cache static assets for a year, ship a fix in a minute, and never re-download a file
that didn't change.

**Primary metric:** bytes over the wire on a returning visit after a deploy that changed one file.

> Open <http://localhost:8080/http-caching/labs/04-immutable-and-fingerprinting/>

---

## The concept

There is exactly one safe way to combine long cache lifetimes with the ability to deploy:

> **Never change the content at a URL. Change the URL.**

If `app.a1b2c3.js` always contains the same bytes, then `max-age=31536000, immutable` is not just
safe, it's *correct*. Deploying means producing `app.d4e5f6.js` and pointing the HTML at it. The
old file stays cached and harmless; users of the new HTML fetch the new file.

Which forces the other half of the rule:

> **The entry point must not be cached that way.** HTML (or your manifest, or your service-worker
> file) is the one thing that has to be re-fetched, because it's what carries the new URLs.
> `no-cache` (revalidate every time, cheap with an ETag) or a short `max-age`.

```
index.html          Cache-Control: no-cache            ← always revalidated, ~200 bytes
app.a1b2c3.js       Cache-Control: max-age=31536000, immutable
vendor.9f8e7d.js    Cache-Control: max-age=31536000, immutable
logo.4c5b6a.svg     Cache-Control: max-age=31536000, immutable
/api/*              Cache-Control: private, no-cache   (see Lab 05/06)
```

### What `immutable` adds

`max-age=31536000` already means "don't ask for a year". `immutable` covers the one case it
doesn't: **reloads**. Historically, pressing reload made browsers revalidate every subresource —
turning a reload of a 100-asset page into 100 conditional requests, all 304s, all pointless.
`immutable` says "not even then".

Modern Chrome stopped revalidating subresources on normal reload (Chrome 54+), which makes
`immutable` nearly a no-op there — but Firefox and Safari behaviours differ, CDNs and proxies read
it, and it costs 10 bytes. Ship it on fingerprinted assets.

## Break it / measure it

Click **first visit** → **deploy** → **returning visit**. Fill in:

| Strategy | First visit | After deploy | Stale assets | Verdict |
|---|---|---|---|---|
| A. stable URL + max-age=1y | 540KB | | | |
| B. `?v=N` + max-age=1y | 540KB | | | |
| C. hashed name + immutable | 540KB | | | |
| D. hashed, every hash changes | 540KB | | | |

The four outcomes, and the real-world name of each:

- **A** — "why are users still getting the old version?" The user is running last week's code and
  **there is nothing you can deploy to fix it**. You have to wait out the `max-age` or change every
  URL. This is the incident.
- **B** — correct. The caveat is that a few CDNs and corporate proxies ignore query strings when
  building cache keys, so two different `?v=` values can collide. It's the right choice when you
  can't control filenames (e.g. a CMS), and the wrong default otherwise.
- **C** — the answer.
- **D** — "why does every deploy re-download our whole vendor bundle?" Every chunk's hash changed
  because the build embeds the manifest (or module IDs) into every chunk. Technically correct,
  and it throws away the entire benefit. The fix is bundler config — extract the runtime/manifest
  into its own tiny chunk and use content hashes that don't depend on sibling chunks.

## The reload experiment

Three scripts are loaded by this page's HTML with different headers. Do this:

1. Click **reset counters**.
2. Normal reload (`Cmd/Ctrl-R`). Click **refresh the hit counts**. Which assets hit the server?
3. Hard reload (`Cmd/Ctrl-Shift-R`). Check again.
4. Navigate away and come back via a link (not reload). Check again.

| | classic `max-age=3600` | `immutable` | `no-cache` |
|---|---|---|---|
| Normal reload | | | |
| Hard reload | | | |
| Navigation | | | |

Then repeat in a second browser and note the differences. The point of this exercise is not to
memorise one browser's table — it's to internalise that **"reload" is three different behaviours**
and that a bug report saying "it works when I refresh" is telling you which one.

## Think about

- You use hashed filenames. A user has `index.html` cached from before the deploy and it points at
  `app.OLD.js`, which is gone from the server (you clean up old builds). What do they see? What
  should you do about it?
- Your SPA is one HTML file that never changes and a JS bundle that does. Where does the version
  number actually live?
- A user has the app open in a tab for six hours. You deploy. Their next lazy-loaded chunk
  request 404s. Design the fix.

<details>
<summary>Answers — the three deploy traps</summary>

**Deleted old chunks.** Keep the last N builds' assets around (a week is typical), or serve a
fallback that returns the current build's chunk. The 404-on-lazy-chunk error is one of the most
common production JS errors in the world, and its root cause is "we clean up the CDN too fast".

**Where the version lives.** In the HTML. That's the whole architecture: HTML is the mutable
pointer; everything it references is immutable content. If your HTML is cached long, you have no
pointer and no way to move it. (This is also why service-worker files must never be long-cached —
same role, same rule.)

**Six-hour-old tab.** Detect it: poll a `/version` endpoint or the build hash in your HTML, and
when it changes, either prompt the user to reload or handle chunk-load errors by reloading once
(with a guard so you can't loop). Combine with keeping old chunks around, because the reload
prompt is not instant.
</details>

---

## 🏗️ Build challenge: a fingerprinting build step

Write `fingerprint.mjs` — a build step that takes a directory of assets and an HTML entry point
and produces a correctly cacheable output.

Requirements:

1. Hash each asset's **content** (SHA-256, truncated to 8–10 chars) and emit
   `name.<hash>.ext`.
2. Rewrite references — in HTML, in CSS (`url()`, `@import`), and in JS (import specifiers) — to
   the hashed names. Handle the ordering problem: a CSS file that references an image must be
   hashed *after* the image, or its own hash is wrong.
3. Detect and refuse **cycles** in the reference graph with a clear error.
4. Emit `manifest.json` mapping original → hashed names.
5. Emit the headers file your host needs (`_headers` for Netlify/Cloudflare, `nginx.conf` snippet,
   or `S3` metadata JSON) — HTML `no-cache`, hashed assets `max-age=31536000, immutable`.
6. **Stability test:** running the build twice on unchanged input must produce byte-identical
   output including hashes. Changing one image must change exactly that image's hash, the CSS
   that references it, and the HTML — *and nothing else*. Write this as an actual test.

Then prove it with numbers:

```
deploy 1 → deploy 2 (changed: src/app.js only)
  changed assets:  2 / 14
  bytes a returning user must download:  81 KB / 540 KB  (15%)
```

**Stretch:** add subresource integrity (`integrity="sha384-…"`) to the emitted tags and explain
what breaks if you serve those assets from a CDN that recompresses.

**Done when:** the stability test passes, and you can show a run where changing one leaf asset
invalidates exactly its dependency chain and nothing more.

---

## Interview questions

1. Why is `Cache-Control: max-age=31536000, immutable` safe on `app.a1b2c3.js` and reckless on
   `app.js`?
2. What must the caching policy on your HTML be, and why does the rest of the strategy depend on
   it?
3. What does `immutable` add over a long `max-age`? Is it still worth setting?
4. A deploy changed one component. Users re-download the whole 900KB bundle set. Name three
   possible causes.
5. Hashed filenames vs `?v=` query strings — when would you deliberately choose the query string?
6. A user's tab has been open since before the deploy and lazy-loaded chunks now 404. Walk me
   through your fix, both immediate and structural.
