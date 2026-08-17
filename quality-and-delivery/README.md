# Quality & delivery ⭐⭐⭐⭐⭐

Everything in this repo so far is about making one thing correct or fast. This course is about
keeping it that way while ten people change it every day — which is a different problem, and mostly
an engineering-systems one rather than a browser one.

```sh
./serve.sh    # then http://localhost:8080/quality-and-delivery/labs/03-observability/
```

---

## The four questions

| Question | Answered by |
|---|---|
| **Does it work?** | tests — and the right *kind* at the right level |
| **Do we know when it doesn't?** | observability: errors, RUM, tracing, alerts |
| **How fast can we change it?** | build and tooling — the inner loop and CI |
| **How safely can we ship it?** | flags, canaries, rollback |

A team that is strong on one and weak on another is not fast; it is either brittle or slow. The four
compound.

## Curriculum

| # | Lab | Question it answers | ⭐ |
|---|---|---|---|
| 01 | [Testing strategy](labs/01-testing-strategy/) | What do I test, and at which level? | ⭐⭐⭐⭐⭐ |
| 02 | [Testing in practice](labs/02-testing-in-practice/) | How do I write tests that don't rot? | ⭐⭐⭐⭐⭐ |
| 03 | [Observability](labs/03-observability/) | A user hit a bug. Do I know? | ⭐⭐⭐⭐⭐⭐ |
| 04 | [Build & tooling](labs/04-build-and-tooling/) | Why does my feedback loop take four minutes? | ⭐⭐⭐⭐ |
| 05 | [Release safety](labs/05-release-safety/) | How do I ship on a Friday? | ⭐⭐⭐⭐⭐⭐ |
| 06 | [The quality system](labs/06-the-quality-system/) | How does this survive the team growing? | ⭐⭐⭐⭐⭐ |

Related: [web-vitals-and-react-perf lab 06](../web-vitals-and-react-perf/labs/06-profiling-and-budgets/)
(performance budgets in CI), [accessibility lab 06](../accessibility/labs/06-testing-and-architecture/)
(a11y in the pipeline), [resilience lab 05](../resilience/labs/05-chaos/) (testing the failure paths),
and [offline-and-pwa lab 05](../offline-and-pwa/labs/05-updates/) (version skew during a deploy).

## The one idea

> **Optimise for the time between "someone broke it" and "someone knows".**

Not for test count, not for coverage percentage, not for the number of gates. Every practice in this
course is worth exactly what it shortens that interval by — which is why observability and fast
rollback usually beat one more layer of tests.
