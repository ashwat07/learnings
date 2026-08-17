# Lab 05 — Release safety ⭐⭐⭐⭐⭐⭐

**Goal:** make shipping boring, by making un-shipping trivial.

**Primary metric:** blast radius, and time to recover.

> <http://localhost:8080/quality-and-delivery/labs/05-release-safety/>

---

## Run the simulator

100 users; the new release is broken for 30% of them.

| Strategy | Users affected |
|---|---|
| big bang | |
| canary with an automated gate | |
| feature flag | |

The big-bang number happens **before anyone looks at a dashboard**. That's the real cost: not that the
bug existed, but that the blast radius was everyone, immediately — your detection speed no longer
matters.

**What made the canary work isn't the staging, it's the automated gate.** A canary a human has to
watch is a canary that gets promoted on a Friday afternoon because the dashboard looked fine.

What to gate on, in order of usefulness:

1. **error rate on the new version vs the old** — a ratio, not an absolute; traffic varies
2. **a business metric** — checkout completions, sign-ups
3. p75 latency and Core Web Vitals
4. crash-free session rate

The second is added last and valued most: a release can be error-free and still cut conversion by 8%,
and only the funnel will tell you.

## Deploy ≠ release

| | |
|---|---|
| **deploy** | the code is on the server. Boring, frequent, reversible only by another deploy |
| **release** | users can see it. A config change, reversible in **seconds** |

Once those are separate you can deploy twenty times a day, merge to main continuously (no long-lived
branches, no big-bang merges), and turn one feature off without reverting the eleven other changes in
the same build.

## The mechanisms

| Mechanism | Gives | Costs |
|---|---|---|
| feature flags | deploy ≠ release; instant off | branches in production; cleanup debt |
| canary / progressive rollout | a bounded blast radius | infrastructure; two versions live |
| **automated gates** | detection without a human watching | you must define good metrics |
| fast rollback | the shortest path to known-good | forward-compatible migrations |
| blue/green | an instant switch both ways | double the infrastructure |
| shadow traffic | real load with no user impact | side effects must be suppressed |
| **a kill switch** | stop the bleeding without a deploy | almost none — **build it** |

**The metric that matters is MTTR**, not deploy frequency. The DORA research is consistent: elite
teams deploy more often *and* have lower change-failure rates, because the same properties produce
both — small changes are easier to review, attribute and reverse.

Which gives a test for any process proposal: **does it shorten time-to-detect or time-to-recover?** A
four-hour manual regression pass before every release does neither. It lengthens the interval between
deploys, which makes each one bigger and each failure harder to attribute. That's the "safety" that
makes things less safe.

## Flags, and their debt

| Type | Life | Rule |
|---|---|---|
| release flag | days–weeks | **delete it** once fully on |
| experiment flag | the test's length | delete at conclusion |
| ops / kill switch | permanent | keep, document, **test on a schedule** |
| permission / entitlement | permanent | **not a feature flag** — that's authorisation |

Every flag is a branch in production, and n flags are 2ⁿ states of which you test about two. A
codebase with 200 stale flags has behaviour nobody can predict and nobody dares delete.

The discipline: **every release flag gets an owner and an expiry at creation**; CI warns past expiry
and fails after a grace period; removing the flag is part of the *feature* ticket; and **test the
flag-off path**, because the old path is production code until you delete it — a rollback into an
untested path isn't a rollback.

## The kill switch

The one mechanism to build **before** you need it. Properties that matter:

- **fail safe, not fail open.** If the flag service is down, default to known-good. A flag system that
  fails open turns its outage into yours.
- **it must work without a deploy.** If turning it off needs CI, it isn't a kill switch.
- cache the value with a short TTL and a push channel, so "off" propagates in seconds.
- **test it on a schedule.** An untested kill switch is a comforting story.

Same shape as the service-worker kill switch
([service-workers lab 05](../../../service-workers/labs/05-traps/)) and the too-old-client switch
([offline-and-pwa lab 05](../../../offline-and-pwa/labs/05-updates/)): both are ways to reach clients
you can no longer deploy to.

## Rollback vs roll-forward

| Situation | Do |
|---|---|
| a clear regression, cause unknown | **roll back.** Diagnose calmly afterwards |
| a small, understood bug with a one-line fix | roll forward — **only if CI is fast** |
| a migration has already run | roll forward; you usually can't un-migrate |
| a third party changed | kill switch on that integration |

**Default to rolling back first.** Debugging under pressure with users affected produces bad
decisions. "We know what it is, we can push a fix" is how a ten-minute incident becomes ninety.

What makes rollback possible — all decided **before** you need it:

- **forward-compatible migrations.** Add columns, don't rename; write to both for a release; remove
  later. The same two-release discipline as API changes.
- **keep the previous build deployable and its assets online.** A rollback that 404s on chunks isn't
  one.
- **rollback is one command, and someone on call has run it before.**
- **know what isn't reversible**: sent emails, charged cards, published webhooks, migrated data. Those
  need flags in *front* of them, not rollback behind them.

**Measure time-to-rollback.** If nobody knows it, it's longer than you think.

## Think about

- Can you deploy on a Friday? What would have to be true?
- What's the difference between a feature flag and a config value?
- Why is "deploy less often" the wrong response to a bad release?

<details>
<summary>Answers</summary>

**Friday deploys.** Yes, if: the change is small, it's behind a flag or a canary with an automated
gate, rollback is one command and someone has run it, monitoring alerts on user-visible symptoms, and
someone is actually around. The Friday rule is a proxy for "we can't recover quickly" — fix the real
constraint and the day of the week stops mattering. Keeping the rule while never fixing the constraint
is how you end up with enormous Monday deploys, which are exactly the risky kind.

**Flag vs config.** A flag is *temporary*, *targeted* (per user, cohort or percentage) and expected to
be deleted; a config value is permanent, global, and part of how the system is set up. They're often
implemented with the same mechanism, and conflating them is why flag systems accumulate hundreds of
entries nobody can classify. Keep them in separate namespaces with different lifecycle rules.

**"Deploy less often."** It optimises the wrong variable. Fewer deploys means bigger deploys, which
means more changes per release, which means harder attribution when something breaks and a bigger
thing to revert — so both time-to-detect and time-to-recover get *worse*. The response to a bad
release is smaller releases with better gates and faster rollback.
</details>

---

## 🏗️ Build challenge

1. Add a flag system with per-user targeting, percentage rollouts, and a fail-safe default.
2. Put your next feature behind a flag and ship it dark. Enable for 1%, then 10%, then everyone.
3. Add an automated canary gate on error rate **and** one business metric.
4. Give every flag an owner and expiry; add the CI check.
5. Make rollback one command. Time it. Practise it in a drill.
6. Audit your migrations for forward compatibility.
7. Build and test a kill switch for your riskiest integration.

**Done when:** you can turn off any feature shipped this quarter in under a minute, without a deploy.

---

## Interview questions

1. What's the difference between deploy and release, and what does separating them enable?
2. Why is a canary without an automated gate nearly worthless?
3. What's flag debt and how do you prevent it?
4. Rollback or roll-forward — how do you decide?
5. What makes a rollback impossible, and how do you avoid it?
6. Why does MTTR matter more than deploy frequency?
