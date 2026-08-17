# Lab 05 — Supply chain ⭐⭐⭐⭐

**Goal:** know what you're actually shipping, who can change it, and which controls are structural
rather than aspirational.

**Primary metric:** the multiplier — decisions you made vs packages you trust.

> <http://localhost:8080/security-and-auth/labs/05-supply-chain/>
> Plus `node audit.mjs ../../../react-sandbox/package-lock.json` for the build half.

---

## Part 1 — a `<script>` tag is arbitrary code execution, forever

Load **v1**, then let the vendor **push v1.0.1**. Same URL, same tag, one patch release later:

| what | v1 | v1.0.1 |
|---|---|---|
| `document.cookie` | | |
| `localStorage` keys | | |
| form fields the user is typing | | |
| sent to an external host | | |

Nothing there is an exploit. A third-party `<script>` runs with the **full authority of your
origin** — same DOM, same cookies, same storage, same credentialed `fetch`. There's no sandbox and
no permission model. "We added their analytics snippet" and "we granted a third party arbitrary code
execution on every page, forever" are the same sentence.

This is exactly how the British Airways (2018) and Ticketmaster breaches worked — a modified
third-party script on the payment page. It's called **Magecart**, and it's still the most common way
card data is stolen from the web.

### SRI

Press **pin it with SRI**. The browser fetches, hashes the bytes, compares, and refuses to execute:

```html
<script src="https://cdn.example.com/analytics.js"
        integrity="sha384-…" crossorigin="anonymous"></script>
```

SRI converts "I trust this CDN forever" into "I trust exactly these bytes". What it is **not**:

- It doesn't review the code — you pinned a hash of something you should still have read.
- It's incompatible with anything the vendor must be able to update. That tension is the real
  decision, and the honest resolution is usually "then it doesn't go on the checkout page."
- **It doesn't cover what the script loads after it runs.** A pinned loader that fetches a second,
  unpinned script has bought you nothing. Check for that specifically.
- `crossorigin="anonymous"` is required cross-origin — without CORS the browser can't read the
  bytes to hash them.

### The two controls that matter, in order

1. **No third-party scripts on pages handling credentials or payment.** Use the provider's iframe —
   a different origin, and that boundary *is* the control.
2. **Pin what you must include (SRI), and restrict where anything can send data** — CSP
   `connect-src` *and* `img-src`. The demo exfiltrates via an image URL precisely because that's the
   channel people forget.

## Part 2 — the build

```sh
node audit.mjs ../../../react-sandbox/package-lock.json
```

```
direct dependencies you chose                  4
packages actually installed                    115
multiplier                                     29×
packages that run code at install time         2
```

The count isn't the point; **the ratio** is. You made 4 decisions and inherited 115. You can't name
the people behind 111 of them.

### Where code runs, and as whom

| Stage | Runs | As | Gets |
|---|---|---|---|
| `npm install` | pre/post-install scripts | your user, your laptop, your CI | env vars, SSH keys, npm token, cloud creds |
| build | every plugin, loader, transform | CI, often with deploy credentials | the artifact, which it can modify before you sign it |
| runtime | whatever reached the bundle | your origin | cookies, storage, the DOM, the user |

**The install-time surface is worse than the runtime one**: it runs on a machine holding your
credentials, before any review of the artifact, and its effects are invisible in the diff.

### Precedents — five different failure modes

| Incident | What actually failed |
|---|---|
| `event-stream` (2018) | **trust transfer** — a maintainer handed the repo to a helpful volunteer |
| `ua-parser-js` (2021) | **account takeover** — maintainer's npm account compromised |
| `colors` / `faker` (2022) | **the maintainer isn't always on your side** — deliberate sabotage |
| `left-pad` (2016) | **availability** — unpublished, thousands of builds broke |
| `xz-utils` (2024) | **patient social engineering** — years spent becoming a co-maintainer |

Only one of those is a "vulnerability" in the CVE sense. `npm audit` would have caught approximately
none of them at the time. Vulnerability scanning and supply-chain security are different problems.

## The policy

| Control | Stops |
|---|---|
| lockfile committed, **`npm ci`** (never `npm install`) in CI | a resolved version you never reviewed |
| `--ignore-scripts` + an explicit allow-list | install-time code execution |
| SRI on every third-party script | a CDN or vendor changing the bytes |
| CSP `script-src` / `connect-src` / `img-src` | second-stage loads and exfiltration |
| no third-party scripts on payment/auth pages | Magecart, entirely |
| version cooldown before adoption | the window when a compromised publish is live |
| dependency review in PRs | tree growth nobody decided on |
| **automated updates with good tests** | the *other* failure mode: never patching |
| SBOM + provenance/attestations | not knowing what you shipped, when it matters |
| a private registry proxy | dependency confusion; and caches packages that get unpublished |

**Dependency confusion**, since it's the least-known: an attacker publishes
`@yourcompany/internal-utils` to the *public* registry at version `99.0.0`, and your resolver
prefers it over your internal one. A registry proxy with scope pinning closes it.

**Pin the toolchain too.** A GitHub Action referenced by tag is mutable — reference it by commit
SHA. Same idea as SRI, applied to CI.

### Hold the balance

The opposite failure is just as real: teams that pin everything and never update ship
known-vulnerable code for years. The goal isn't fewer updates, it's **updates you can apply quickly
and safely** — good tests, small diffs, automated PRs, fast rollback. A team that can ship a patch
in an hour is safer than one that has pinned everything since 2022.

## Think about

- Marketing wants a tag manager on every page, including checkout. What do you say?
- A dependency you use has a critical CVE, but only in a code path you don't call. Ship the patch?
- Why doesn't `npm audit` passing mean much?

<details>
<summary>Answers</summary>

**Tag manager on checkout.** Say yes everywhere except the pages handling payment or credentials,
and be specific about why: a tag manager is, by design, a channel for publishing arbitrary
JavaScript to your origin without a code review, and the people with access to it are usually not in
your on-call rotation. On checkout, the provider's iframe gives you the same business outcome with a
real origin boundary. If you're subject to PCI DSS 4.0, requirements 6.4.3 and 11.6.1 make this
mandatory rather than advisory — you must inventory, authorise, and detect changes to every script
on the payment page.

**CVE in an unused path.** Ship it. The analysis that says "we don't call that path" is a snapshot
that goes stale the moment someone adds a feature, and it has to be redone for every future version.
Reachability analysis is useful for *prioritising* — it tells you whether to page someone tonight —
not for deciding whether to patch at all. The only cheap-to-maintain state is current.

**`npm audit`.** It matches your tree against a database of *disclosed* vulnerabilities. It says
nothing about a package that is malicious-but-undisclosed, about maintainer trust, about install
scripts, or about a compromised publish from ten minutes ago. It's a smoke detector, not a lock —
and it's also noisy in the other direction, flagging transitive dev-only dependencies that never
reach production, which trains teams to ignore it.
</details>

---

## 🏗️ Build challenge: measure and shrink your surface

1. **Run `audit.mjs` on your real project.** Record the multiplier, install-script list, and
   duplicate versions.
2. **Kill the install scripts**: switch CI to `npm ci --ignore-scripts`, find what breaks, allow-list
   only those. Usually it's just the native binaries.
3. **Inventory every third-party script tag in production** — including ones injected by a tag
   manager (grep the built HTML *and* watch the network panel; they're not the same list).
4. **Add SRI** to the ones that can be pinned; move the ones that can't off your sensitive pages.
5. **Add `connect-src` and `img-src`** to your CSP, report-only first (lab 02) — you'll discover
   every host your page talks to, which is a useful shock.
6. **Set up automated dependency PRs** with a 3-day cooldown and a test suite good enough that you
   merge them without reading the diff.
7. **Generate an SBOM** (`npm sbom --sbom-format cyclonedx`) in CI and store it with the build. The
   day a `left-pad` happens, "which of our 400 deployed versions contains this?" is answerable in
   seconds or in days.

**Done when:** you can answer "what changed in our dependency tree last week, and who published it?"
without opening a browser.

---

## Interview questions

1. What can a third-party `<script>` on your page do?
2. What does SRI guarantee, and what are its three gaps?
3. Why is install-time the highest-privilege moment in your pipeline?
4. `npm install` vs `npm ci` — why does it matter in CI?
5. What is dependency confusion, and what closes it?
6. Why is "pin everything and never update" also a security failure?
