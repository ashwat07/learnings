# Capstone 21 — The production audit ⭐⭐⭐⭐⭐⭐

**Goal:** diagnose an application you did not write, with no list of planted sins, and produce a
report that someone else could act on without you in the room.

**Primary metric:** would a staff engineer on that team read your report and say "yes, that's our
problem, and we know what to do on Monday"?

---

## Why this one exists

Capstone 19 hands you 16 labelled sins. Capstone 20 asks you to teach. Neither tests the thing you'll
actually be paid for:

> A stakeholder says "the app feels slow." You have no list, no annotations, no author to ask, and
> limited time. Find what's actually wrong, prove it, rank it by what's worth fixing, and convince
> people.

Some companies use exactly this as a senior interview exercise: *here's a URL, you have 90 minutes,
tell us what's slow and what you'd do.* Everything in Labs 01–18 is the vocabulary; this is the
sentence.

The hard skill here isn't profiling — you can already profile. It's **triage under uncertainty**:
deciding which of eleven real problems matter, separating "slow" from "slow for a defensible reason,"
and estimating impact you can't measure directly.

## Rules of engagement

Read this before you pick a target. You're going to be poking at someone else's production system.

**Fine, and what this capstone is:**
- Loading public pages in your own browser and profiling what happens locally. That's just browsing
  with DevTools open.
- Running Lighthouse / PageSpeed Insights against a public URL.
- Reading public field data (CrUX) for any origin.
- A handful of scripted page loads at human volume for repeatability.

**Not fine, and not required by any part of this exercise:**
- Load or stress testing, or scripted runs at a volume that could affect the service. Human-scale
  traffic only — if you're looping hundreds of loads, throttle it or use a local copy.
- Touching authenticated, paid, or private areas without permission, or working around auth, rate
  limits, or bot protection.
- Testing anything sensitive — banking, health, government services.
- Publishing a "this site is terrible" post naming a company. Keep the report private, or anonymise
  the target if you want to share your method.

**If the target is a client or employer:** get the scope in writing first — which URLs, which
environments, what time windows, who to notify. Ten minutes of email prevents a very bad afternoon.

Best targets, in order: **your own project** (no constraints at all), a **large open-source app** you
can run locally, then a public site whose ToS permits ordinary automated access.

## Pick a target

Choose one that will actually teach you something:

- [ ] Real, non-trivial: substantial content, at least 3–4 distinct interactions, ideally a list or
      feed and a form.
- [ ] Not yours, or at least not written by you — the point is reading unfamiliar code.
- [ ] Has a JS framework in it (you'll want Lab 08's instincts).
- [ ] Public field data exists for it (check PageSpeed Insights — if it has CrUX data, you get a
      reality check on your lab numbers, which is a rare luxury).
- [ ] You can stand to use it for an hour without losing your mind.

Write down, before you start: **your three predictions** about what you'll find. Sealed-envelope
style. At the end, score yourself. This calibrates your instincts better than any amount of reading,
and if you were badly wrong it's the most useful paragraph in your write-up.

## The protocol

Follow it in order. The discipline is the deliverable — an audit that jumps straight to a
Performance trace misses the load problems, and one that only runs Lighthouse misses everything
interactive.

### Phase 0 — set up so your numbers mean something

| Setting | Value |
|---|---|
| Browser | fresh incognito, **all extensions disabled** |
| Runs per measurement | 3 minimum, report the **median** (never a single run) |
| Cold load | cache disabled, "Empty cache and hard reload" |
| Warm load | measured separately — most real visits are warm |
| Mobile profile | CPU 4× (mid-tier) and 6× (low-end), Fast 3G and Slow 4G |
| Desktop profile | no throttle, for comparison only |
| Viewport | one mobile (390×844), one desktop (1440×900) |

Record the environment in the report. An audit without its conditions stated is not reproducible, and
a non-reproducible audit gets dismissed the moment someone can't repeat it.

### Phase 1 — cold load

1. Lighthouse, mobile preset, 3 runs, median. Save the JSON.
2. Performance panel, reload-and-record, with **Screenshots** on. Note FCP, LCP, and what the LCP
   element actually is.
3. Network: total requests, transferred bytes, render-blocking resources, the waterfall shape, and
   the protocol (h1/h2/h3). Look for import chains (Lab 12) and blocking CSS (Lab 13).
4. Coverage: unused CSS and JS percentages.
5. Third parties: list every distinct origin, and what each costs in bytes and main-thread time.
   This is very often the top finding, and it's also the one with the most political friction.
6. Long tasks during load, with attribution. TBT.

### Phase 2 — interactions

Pick the 5 most important interactions (what does a user come here to *do*?). For each:

1. Record a Performance trace. Read the **Interactions** track for the three-phase INP breakdown
   (Lab 16) — and name the dominant phase, because it determines the fix.
2. Identify the bottleneck stage: Style / Layout / Paint / Composite / JS (Labs 01–06, 17).
3. Check for forced reflows (Lab 14) and layout shifts (Lab 18).
4. Scroll every scrollable region and record FPS and worst frame (Lab 02).
5. Layers panel: layer count and GPU memory (Lab 15).

### Phase 3 — sustained use

The phase nobody does, where the interesting findings live.

1. Use the app normally for 10 minutes. Navigate between all its routes repeatedly.
2. Heap snapshots at start, 5 minutes, 10 minutes, each after a forced GC. Detached node counts
   (Labs 09/10).
3. DOM node count and listener count over time — a staircase is a finding.
4. Does it get slower? Quantify it: re-run one Phase 2 interaction at minute 0 and minute 10 and
   compare. "The app is slower after ten minutes of use" with numbers attached is a genuinely
   valuable bug report, and almost nobody files it.

### Phase 4 — reality check against the field

Your lab numbers are a simulation. Compare them with real users:

1. PageSpeed Insights for the URL → the CrUX panel gives p75 LCP, INP, CLS from real Chrome users.
2. Where your lab findings and the field data **disagree**, investigate. Common causes: your
   throttling doesn't match the real device mix, geography and CDN, cache hit rates, logged-in vs
   anonymous.
3. If the field data says the site is fine and your lab says it's terrible — the field data wins for
   *prioritisation*, and you should say so. This paragraph is what separates an engineer from a tool
   operator.

### Phase 5 — synthesis

Now stop measuring and start thinking. For each finding:

**Impact** — who is affected, how often, and how much? Prefer a user-facing unit ("LCP p75 4.2s →
est. 2.1s") over an internal one ("removes 180KB"). Where you're guessing, say so and give a range.

**Confidence** — high (measured directly, reproduced 3×), medium (strong evidence, one cause among
several), low (hypothesis worth an hour's spike).

**Effort** — S / M / L in engineer-days, with the risky unknowns named.

**Priority** = impact × confidence ÷ effort. Sort by it. Then sanity-check the order by asking: if
the team only does the top two, is the app meaningfully better? If not, re-rank.

And the finding type everyone omits: **things that are slow for a defensible reason.** The
`backdrop-filter` that costs 8ms and is the product's entire visual identity. The 200KB analytics
bundle that legal requires. Name these explicitly and say you're *not* recommending changing them.
A report that only lists sins reads as naive; one that shows judgment gets acted on.

## The report

`REPORT.md`, from [report-template.md](report-template.md). Structure:

1. **Executive summary — one page maximum.** Three sentences of verdict, then the top 3 findings with
   estimated impact. Assume this is the only part most people read, because it is.
2. **Method and environment** — enough for someone to reproduce you.
3. **Findings**, ranked. Each one: symptom → evidence (trace screenshot, numbers) → mechanism (which
   pipeline stage and why) → recommendation → estimated impact → effort → confidence.
4. **Deliberate non-findings** — slow but justified, and why you're leaving it.
5. **What I couldn't determine** — where you ran out of access, time, or certainty. Stating this
   builds more trust than pretending completeness.
6. **Prediction scorecard** — your three sealed predictions vs what you found.
7. **Appendix** — raw numbers, Lighthouse JSON, trace files, screenshots.

Length target: **8–15 findings, report under 2,500 words** excluding the appendix. If it's longer,
you haven't triaged — you've transcribed. Cutting a real finding because it isn't in the top 15 is
part of the exercise.

## Then do the hard half

An audit nobody acts on is a diary entry.

- [ ] **Fix the top finding yourself.** If it's your project or an open-source app, do the work and
      measure the delta. If it's a public site, reproduce the pattern locally, fix it there, and
      report the mechanism with numbers.
- [ ] **Write the 5-minute version.** Present the whole thing in five minutes to someone non-technical
      — a designer, a PM, your partner. If they can't restate the top finding afterwards, rewrite it.
      This is the actual skill.
- [ ] **Pre-write the pushback.** For each top-3 recommendation, write the strongest objection a
      sceptical senior engineer would raise ("that shadow is our brand", "we can't drop that vendor",
      "our users are all on desktop") and your evidence-based response. If your only answer is
      "performance matters", you've lost the argument.

## Done when

- [ ] `REPORT.md` complete, under 2,500 words, 8–15 ranked findings.
- [ ] Every finding has: evidence, named pipeline stage or resource, estimated impact, effort,
      confidence.
- [ ] At least one deliberate non-finding.
- [ ] Field data compared with lab data, with any disagreement explained.
- [ ] Phase 3 done properly — you know whether the app degrades over 10 minutes, with numbers.
- [ ] One finding fixed and measured.
- [ ] Prediction scorecard filled in honestly.
- [ ] Someone non-technical can restate your top finding after a 5-minute talk.

## Stretch

- Automate it with [audit.mjs](audit.mjs) — the scaffold is there, the interesting parts are TODO.
  A repeatable audit you can run monthly beats a heroic one you run once.
- Audit three competitors in the same sector and produce a comparison. This is a genuinely
  marketable artefact.
- Re-audit your target in a month. Did anything change? Did anything you'd have recommended get
  done by accident? What regressed?
- Audit the *same* app on a real low-end Android over USB debugging, and write up everything your
  4×-throttle desktop simulation got wrong. It will be more than you expect, and this is the
  paragraph that will make you trusted on a performance team.

---

## Interview questions

1. You get a URL and 90 minutes. Walk me through your process.
2. Lighthouse says 45 and the CrUX data says the site is fine. Which do you believe, and what do you
   do?
3. How do you estimate the business impact of an LCP improvement without an A/B test?
4. You find 20 problems. How do you decide what goes in the top 3?
5. The top finding is a third-party script the marketing team owns. Now what?
6. How would you know whether an app leaks memory during real use?
7. What would make you tell a team their performance is *fine* and they should work on something else?
