# Resource hints: preload / prefetch / preconnect / priority ⭐⭐⭐⭐

The browser can only download what it has discovered. Everything in this course is about
**discovery time** — moving the moment a resource becomes known earlier, so the network can start
sooner. Hints don't make anything faster; they make things *start* sooner, which is usually the
same thing and occasionally very much not.

```sh
./serve.sh    # then http://localhost:8080/resource-hints/labs/01-waterfall-anatomy/
```

---

## The model

A request happens when the browser **discovers** a URL. There are only a few ways that happens:

| Discovery route | When |
|---|---|
| The HTML preload scanner | While the parser is still blocked — the fastest route |
| The parser reaching a tag | After everything before it is parsed |
| CSS parsed → `url()` inside a matching rule | After the CSS downloads **and** parses |
| A font matched to text | After CSS parses *and* layout decides the font is used |
| JS running `fetch`/`import()` | After the script downloads and executes |
| A hint (`preload`, `preconnect`, `prefetch`) | As soon as the head is parsed |

A **chain** is what happens when discovery depends on a previous download:

```
HTML ──► CSS ──────► background image        3 round trips before it starts
HTML ──► app.js ───► fetch('/api/user')      3 round trips before any data
HTML ──► CSS ──────► @font-face ──► font     4, and text is invisible until it lands
```

Chains are why "we only make 12 requests" can still be slow. Depth beats count.

### The hints

| Hint | Says | Costs |
|---|---|---|
| `<link rel="preconnect">` | open a connection to this origin now (DNS + TCP + TLS) | a socket + handshake; wasted if unused |
| `<link rel="dns-prefetch">` | just resolve the DNS | almost nothing |
| `<link rel="preload">` | download this **now**, at high priority, for *this* page | bandwidth contention; a warning if unused |
| `<link rel="prefetch">` | download this at idle priority, for the **next** page | bandwidth; may be evicted before it's used |
| `<link rel="modulepreload">` | preload an ES module *and its dependencies*, parsed | as preload |
| `fetchpriority="high\|low"` | reprioritise a request you're already making | nothing — it's free, and it's underused |
| `loading="lazy"` | don't fetch until near the viewport | can delay LCP badly if misapplied |
| Speculation Rules | prefetch or fully **prerender** the next page | a whole page render's worth of CPU/memory |

The two rules that prevent most mistakes:

1. **`preload` is not a cache warmer.** It's "this page needs this, immediately". Preload
   something the page doesn't use within a few seconds and Chrome logs a warning — and you've
   stolen bandwidth from something that mattered.
2. **Every hint is a bet.** Right bets remove a round trip; wrong bets contend for the same
   bandwidth as the thing on the critical path. There is no such thing as a free hint, only a
   cheap one.

---

## Curriculum

| # | Lab | Question it answers | ⭐ |
|---|---|---|---|
| 01 | [Waterfall anatomy](labs/01-waterfall-anatomy/) | How do I read a waterfall and find the chain? | ⭐⭐⭐⭐⭐ |
| 02 | [preconnect & DNS](labs/02-preconnect/) | What does a connection actually cost? | ⭐⭐⭐⭐ |
| 03 | [preload](labs/03-preload/) | Fonts, LCP images, critical data — and the traps | ⭐⭐⭐⭐⭐ |
| 04 | [Priority & prefetch](labs/04-priority-and-prefetch/) | fetchpriority, lazy loading, next-page speculation | ⭐⭐⭐⭐ |
| 05 | [Fix the waterfall](labs/05-fix-the-waterfall/) | End to end, with LCP as the scoreboard | ⭐⭐⭐⭐⭐ |

## Measuring honestly

- Every lab page renders its own waterfall from `PerformanceResourceTiming`. Read `report.js` —
  the phase breakdown (queue → dns → connect → tls → ttfb → download) is the same thing the
  Network panel draws.
- **Throttle.** On localhost, DNS is 0ms, connect is ~0ms and TLS doesn't exist. Use DevTools →
  Network → *Fast 4G* / *Slow 4G* for everything in this course, or the hints will look useless.
  Where a lab is measuring something localhost cannot show, it says so explicitly.
- **Hard-reload between runs** (`Cmd/Ctrl-Shift-R`), or you'll be comparing a warm cache with a
  cold one.
- Primary metric is **LCP** unless a lab says otherwise. Requests saved is a proxy; LCP is what
  users experience.
