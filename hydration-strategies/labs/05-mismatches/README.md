# Lab 05 — Hydration mismatches ⭐⭐⭐⭐⭐

**Goal:** recognise all six causes on sight, know which fix each one needs, and understand why this
is a production-only bug class.

**Primary metric:** you can name the cause from the symptom without a debugger.

> Open <http://localhost:8080/hydration-strategies/labs/05-mismatches/>

---

## The premise

Hydration assumes the client will produce **exactly** the markup the server already sent. When it
doesn't, you get anything from a console warning to a silently wrong page to a **full client-side
re-render** — which throws away every benefit you paid for.

And it's a production-only class: in development the server and client are the same machine, same
locale, same timezone, same clock. Everything agrees.

## The six causes

| # | Cause | Examples |
|---|---|---|
| 1 | **Time** | "3 minutes ago", countdowns, "today", greetings by hour |
| 2 | **Randomness / ids** | `Math.random()` ids, `aria-describedby`, module-level counters |
| 3 | **Locale & timezone** | `toLocaleString()` with no args, dates near midnight |
| 4 | **Browser-only APIs** | `window.innerWidth`, `matchMedia`, `localStorage` (theme!) |
| 5 | **Invalid HTML nesting** | `<div>` in `<p>`, `<tr>` outside `<table>` |
| 6 | **Things outside your control** | extensions, translators, password managers |

### #5 is the one that makes people doubt their sanity

Your render function is perfectly deterministic and you still get a mismatch, because **the HTML
parser is not a passive reader**. It applies the spec's error-recovery rules and *restructures*
invalid markup:

```
you sent:  <p>Intro <div>block</div> more</p>
DOM became: <p>Intro </p><div>block</div> more<p></p>
```

The server described one tree; the browser built another; hydration compares against the built one.
Tells: it only happens with SSR (client-only rendering uses DOM APIs, which don't apply parser
recovery), and the component usually *looks* fine.

Find it by running your server HTML through a validator, or diffing `document.body.innerHTML`
against the response body. React 19's error messages now name the offending tag pair, which is a
large improvement over "text content did not match".

### #3 changes values, not just formatting

A timestamp at 23:30 UTC is "today" on the server and "tomorrow" for a user in Tokyo. A mismatch
warning is the *good* outcome here; a silently wrong date is the normal one.

## The four fixes, ranked

| | Fix | How | Quality |
|---|---|---|---|
| 1 | **Make the server able to decide** | a cookie / URL segment / header the server reads | **best** — no mismatch *and* no flash |
| 2 | **Two-pass**: render neutral, correct after mount | `useEffect` / `onMounted` | correct; one frame of the wrong thing |
| 3 | **Client-only** subtree | dynamic import with `ssr: false`, `<ClientOnly>` | no SSR benefit for that subtree |
| 4 | **Suppress the warning** | `suppressHydrationWarning` on **one** element | last resort; hides, doesn't fix |

Fix 1 is nearly always available and nearly always skipped. Most mismatches are "the server didn't
know something the client knows" — so *tell it*. Dark mode via a cookie the server reads has no
mismatch and no flash; dark mode via `localStorage` has both.

The exception where a blocking inline script is genuinely right: theme, when the server truly can't
know (first visit, no cookie yet). ~200 bytes in `<head>`, render-blocking on purpose, sets a class
on `<html>` before first paint.

## What a mismatch costs

| Framework | On mismatch |
|---|---|
| React 18 | **Discards the server HTML for that root** and re-renders on the client |
| React 19 | Same recovery; much better error message (names the element, shows a diff) |
| Vue 3 | Warns in dev; patches the DOM to match the client render |
| Svelte / Astro | Warns; behaviour varies by adapter and version |

The universal point: **a mismatch means the fast path was abandoned**, so the cost is exactly equal
to the SSR benefit you were buying. A page that mismatches is a page that would have been simpler as
CSR.

## Monitoring it

Because it's production-only, it needs a production signal:

- Count hydration errors per release in your error tracker.
- **Filter known-external causes** (extension-injected nodes on `<body>`, translated text) or the
  real ones drown in noise.
- Treat mismatches *inside your components* as bugs and mismatches on `<html>`/`<body>` attributes
  as noise.
- Don't chase a 100% clean rate — chase a stable one, and investigate step changes after a release.

## Think about

- Why do mismatches almost never show up in development?
- Your dark mode flashes light for one frame *and* logs a hydration warning. One fix addresses
  both. What is it?
- A component renders a formatted price and mismatches only for some users. What's your first
  question?

<details>
<summary>Answers</summary>

**Not in development.** Same machine for server and client: same clock, same timezone, same locale,
no CDN cache in between, no extensions in a clean profile, and often a dev-only render path. Every
variable that causes a mismatch is held constant. That's why this class needs production monitoring
rather than better local testing.

**Dark mode.** Store the preference in a **cookie** rather than `localStorage`, and read it on the
server. The server then renders the correct theme: no mismatch (both sides agree) and no flash (the
correct theme is in the first paint). One change, both symptoms.

**Price mismatch for some users.** "What locale is the server formatting with, and what locale is the
browser using?" It'll be `toLocaleString()` with no explicit locale — the same code producing
`€1.234,50` on a German server and `€1,234.50` for a US user. Pass the locale explicitly, chosen
from a signal the server has.
</details>

---

## 🏗️ Build challenge: catch them before production

Mismatches are detectable statically and in CI. Build both.

**Part A — a lint rule set** for your codebase:

1. Ban `Date.now()`, `new Date()`, `Math.random()`, `performance.now()` in render paths (component
   bodies, not effects).
2. Ban `toLocaleString`/`toLocaleDateString`/`Intl.*` **without an explicit locale argument**.
3. Ban `window`/`document`/`localStorage`/`matchMedia` access outside effects and event handlers.
4. Ban invalid nesting in JSX where it's statically detectable (`<div>` inside `<p>`, `<tr>` outside
   a table ancestor) — this one catches the sanity-destroying case at compile time.

**Part B — a CI check**:

1. Render each route on the server, load it in a headless browser, and capture every hydration
   warning. Fail the build on any warning originating in your own components.
2. Run each route under **three environments** — a different timezone (`TZ=Asia/Tokyo`), a different
   locale, and a clock offset by an hour. Most time/locale mismatches appear immediately and are
   invisible in a single-environment test.
3. Validate the server HTML with an HTML validator and fail on nesting errors.
4. Diff the server response body against `document.body.innerHTML` after parse-but-before-hydrate,
   and report any structural difference — that's the parser-rewrite detector, and nothing else
   catches it.

**Done when:** the `TZ=Asia/Tokyo` run catches a date bug your normal test suite passes, and the
nesting validator catches a `<div>` in a `<p>` that nobody had noticed.

---

## Interview questions

1. Name six causes of hydration mismatches.
2. Why do they almost never appear in development?
3. How can perfectly deterministic code still mismatch?
4. What does React do when hydration fails, and what does that cost?
5. Rank the fixes for a theme toggle that mismatches.
6. How would you catch time and locale mismatches in CI?
