# Lab 05 — Chaos ⭐⭐⭐⭐

**Goal:** find out whether the fallbacks you wrote actually work.

**Primary metric:** what your UI does — not what the network does.

> <http://localhost:8080/resilience/labs/05-chaos/>

---

## The injector

Twenty lines, no dependency, works in any app:

```js
const real = window.fetch.bind(window);
window.fetch = async (input, init) => {
  await sleep(minDelay + Math.random() * (maxDelay - minDelay));
  if (Math.random() < failRate) throw new TypeError('Failed to fetch (injected)');
  return real(input, init);
};
```

Put it in your staging build behind a query flag. The value isn't the code — it's that the barrier
to trying is zero, so people actually try.

## What to look for

Install a fault, then use the *other* labs in this repo. Watch for the failures that only appear
under chaos:

- a spinner that never stops, because the error path forgot to clear loading state
- a retry loop with no budget, hammering a dead endpoint forever
- an optimistic update that was never rolled back
- a `Promise.all` that discarded three good results because of one failure
- an error message that says `undefined`
- two requests racing, and the **slower** one winning because nothing tracked ordering

Every one of these is invisible when the network is fast and reliable — which is precisely the
condition your development machine maintains.

## The checklist

| Fault | Ask |
|---|---|
| a slow dependency (+2s) | is there a timeout? does the rest of the page render? |
| intermittent 5% failure | do retries have a budget? does the user ever see a permanent error? |
| total dependency outage | does the page degrade per widget, or die whole? |
| offline mid-action | is the write queued or silently lost? does the UI lie about success? |
| a 401 mid-session | one refresh + one retry, or an infinite loop? |
| a lazy chunk 404 (stale deploy) | reload once, or a blank route forever? |
| a third-party script fails | does your page render without it? |

## Making it a practice

1. **Injector in staging, behind a query param.** Anyone can turn it on.
2. **Automate the obvious ones.** Playwright's `route()` can abort or delay specific requests, so
   "the reviews API is down" becomes a test asserting the product still renders. Those tests catch
   the regression where someone re-introduces a single `Promise.all`.
3. **Do it on purpose, on a schedule, while watching.** A game day where you turn off a dependency
   in staging for 20 minutes finds more real problems than a month of design review.
4. **The first time, you'll find something embarrassing.** That's the point, and it's much cheaper
   to find now.

> **A fallback you have never seen run is not a fallback.** It's an untested code path, written
> under optimistic assumptions, that will execute for the first time during an incident.

## Think about

- Why inject faults in the client rather than using a proxy?
- What's the difference between chaos testing and error-handling tests?
- Which fault would embarrass your app most?

<details>
<summary>Answers</summary>

**Client-side injection.** Zero setup, so people use it; it works on any device including a real
phone; and it can target specific URLs by pattern. A proxy (or the DevTools network conditions) is
better for *transport-level* realism — packet loss, bandwidth, TLS failures — so use both: the
injector for "what does my UI do", the proxy for "what does the network really do".

**Chaos vs error-handling tests.** Error-handling tests assert a known path: given a 500, show this
message. Chaos explores the *combinations* you didn't enumerate — two failures at once, a failure
during a transition, a slow response arriving after the user navigated away. Tests prove the paths
you thought of; chaos finds the ones you didn't. You need both, and chaos findings should become
tests.

**The embarrassing one.** For most apps: offline mid-write. The optimistic update stays on screen,
the request never retries, the user believes it saved, and the data is gone with no error anywhere.
It's embarrassing because it's silent and because it looks fine in every demo.
</details>

---

## 🏗️ Build challenge

1. Ship the injector in staging behind `?chaos=fail:0.1,delay:2000`.
2. Run a 30-minute game day with the team. Write down everything that surprised you.
3. Turn the top five findings into Playwright tests with `route()` interception.
4. Add one chaos scenario to your CI smoke suite — the cheapest one: "the least-critical API is
   down, the page still renders".
5. Repeat quarterly, and after any big refactor of your data layer.

**Done when:** the list of surprises from the second game day is shorter than the first.

---

## Interview questions

1. How would you inject faults in a front-end app with no infrastructure?
2. Name three UI bugs only visible under a slow or failing network.
3. Why is "offline mid-write" the failure most apps get wrong?
4. How do chaos findings become regression tests?
