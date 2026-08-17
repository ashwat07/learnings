# Lab 01 — XSS & sanitization ⭐⭐⭐⭐⭐

**Goal:** know which sinks execute attacker data, escape by context, and stop reaching for
`innerHTML`.

**Primary metric:** which of the five sinks executed your payload.

> <http://localhost:8080/security-and-auth/labs/01-xss/>
> The payloads are yours; `/api/reflect` is a deliberately vulnerable localhost endpoint, rendered
> in a `sandbox="allow-scripts"` iframe so a successful payload can run without touching this page.

---

## The one sentence

> **XSS is attacker-controlled data reaching a place where the browser expects code.**

Every variant — reflected, stored, DOM-based, mutation — is that sentence with a different route
from source to sink.

## The sinks

| Sink | Safe? |
|---|---|
| `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` | ❌ parses HTML |
| `dangerouslySetInnerHTML` | ❌ (the name is the control) |
| `setAttribute('href' \| 'src' \| 'action', …)` | ⚠️ `javascript:` and `data:` execute |
| `setAttribute('on*', …)` | ❌ |
| `eval`, `new Function`, `setTimeout("string")` | ❌ |
| `element.style` / CSS injection | ⚠️ `url()` can exfiltrate |
| `textContent` / `innerText` | ✅ never parsed |
| `{value}` in JSX | ✅ escaped by default |

Run the lab and fill in which executed:

| sink | executed? |
|---|---|
| raw (`innerHTML`) | |
| attribute interpolation | |
| escaped | |
| sanitized | |
| textContent | |

The **attribute** case is the one that teaches the most: the payload `" onmouseover="…" x="` breaks
out of the attribute. Quoting alone isn't a defence — **escaping must know its context**.

The **`javascript:` URL** case is the one people miss: no tag, no handler, just an `href` your app
set from data.

## Three rules

**1. Escape by context.** HTML text, HTML attribute, URL, CSS and JS contexts each need different
escaping. One `escapeHtml()` applied to a URL does not stop `javascript:`. This is the strongest
argument against building HTML by string concatenation — frameworks track context for you.

**2. Sanitise only rich text, with an allow-list, using a real library.** Use **DOMPurify**. A
deny-list ("strip `<script>`") loses to `<img onerror>`, `<svg onload>`, `<iframe srcdoc>`, and
**mutation XSS**, where the HTML parser rewrites your sanitised-but-not-normalised output back into
something executable. The 8-line sanitiser in `/api/reflect` exists to show the *shape*
(allow-list tags, drop **all** attributes) — don't ship it.

**3. Validate URL schemes.** Anywhere data reaches `href`/`src`/`action`/`formaction`, allow only
`http:`, `https:`, `mailto:` and relative URLs.

## CSP as the second line

Run **render again with a CSP**: with `script-src 'none'` even the raw sink can't execute.

But be precise about what that buys. The injection still happened — the attacker still controls your
markup, and can deface the page, exfiltrate via an image URL (unless `img-src` is restricted), or
phish with an injected form (unless `form-action` is). CSP is **mitigation, not repair**. Lab 02.

## Trusted Types — the structural fix

```
Content-Security-Policy: require-trusted-types-for 'script'
```

Assigning a plain string to `innerHTML` now **throws**. You must pass a value produced by a policy
you registered, which means every dangerous assignment funnels through one auditable place. It turns
"we hope nobody wrote a sink" into a runtime guarantee, and it's the only mechanism that makes DOM
XSS structurally hard rather than merely unlikely.

Chromium-only for now; deploy it report-only first and read the violations — they're a free
inventory of every sink in your app, including the ones inside dependencies.

## Framework-specific traps

| Framework | The escape hatch that bites |
|---|---|
| React | `dangerouslySetInnerHTML`; also `href={userValue}` (React does **not** validate schemes) |
| Vue | `v-html` |
| Angular | `bypassSecurityTrustHtml` and friends |
| Svelte | `{@html …}` |
| Any | a "rich text" editor's output, and Markdown renderers with `html: true` |

Grep for these. Each occurrence should have a sanitiser next to it and a comment saying why.

## Think about

- Your CMS returns HTML. Where do you sanitise — server, client, or both?
- Is `textContent` always safe?
- What's mutation XSS?

<details>
<summary>Answers</summary>

**Where to sanitise.** Both, and know why each: on the **server/on write** so the stored data is
clean and every consumer (email, native app, exports) benefits; on the **client/on render** because
you can't trust that everything reaching the DOM came through the sanitised path. If you can only do
one, sanitise on render — that's the sink.

**`textContent`.** Safe against HTML parsing, always. It's not a defence against everything: content
you display can still be misleading (a fake "your session expired, sign in here" message), and if
you later copy that text into an `href` or `eval` you're back in trouble. Safe *sink*, not safe
*data*.

**Mutation XSS.** The sanitiser produces markup that looks safe, but the browser's HTML parser
*re-interprets* it when assigned to `innerHTML` — because parsing and serialising HTML is not
round-trip-safe (`<noscript>`, `<template>`, foreign content in `<svg>`/`<math>`, and namespace
confusion all bite). It's the reason "I wrote a sanitiser with a regex" is never true, and why
DOMPurify parses into a real DOM rather than manipulating strings.
</details>

---

## 🏗️ Build challenge: find your own sinks

1. **Inventory**: grep the codebase for every dangerous sink (`innerHTML`, `dangerouslySetInnerHTML`,
   `v-html`, `eval`, `setAttribute` with a variable name, `href={`). Produce the list with owners.
2. **Lint them**: an ESLint rule that fails on new occurrences, with an allow-list of reviewed ones
   (`eslint-plugin-no-unsanitized` does most of this).
3. **Deploy Trusted Types report-only** and collect violations for a week. You'll find sinks inside
   dependencies that no grep would have shown.
4. **Add a URL-scheme validator** used by every component that renders a link, and a test with
   `javascript:`, `data:text/html`, `vbscript:` and a whitespace-obfuscated `java\tscript:`.
5. **Write a stored-XSS test**: submit a payload through your real content path, then load the page
   that renders it in a headless browser and assert nothing executed (hook `window.alert` and
   `postMessage`). Run it in CI — it's the only test that covers the whole path.

**Done when:** the CI test fails when you remove the sanitiser, and the Trusted Types report names a
sink you didn't know about.

---

## Interview questions

1. Define XSS in one sentence.
2. Name four sinks and two safe alternatives.
3. Why isn't quoting an attribute enough?
4. Deny-list vs allow-list sanitisation — why does the deny-list lose?
5. What does CSP buy you after an injection has already happened?
6. What do Trusted Types change structurally?
