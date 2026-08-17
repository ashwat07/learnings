# Lab 05 — UI state machines ⭐⭐⭐⭐

**Goal:** replace a set of booleans with an explicit machine, and eliminate the states nobody
designed.

**Primary metric:** the number of representable states, before and after.

> Sandbox: <http://localhost:5173/#machine>

---

## The arithmetic that makes the case

Five booleans — `isLoading`, `isError`, `isSubmitting`, `hasPaid`, `isRetrying` — is **2⁵ = 32
representable states**. Your checkout has maybe six legal ones. The other 26 are reachable by some
sequence of events, and your bug reports come from exactly there:

```
isSubmitting && isError          → a spinner on top of an error message
hasPaid && isSubmitting          → the double-charge bug
isLoading && hasPaid && isError  → nobody has ever seen this screen
```

A machine inverts it: you enumerate the legal states and the legal transitions, and **everything
else is unrepresentable**.

```js
const MACHINE = {
  cart:       { NEXT: 'address' },
  address:    { NEXT: 'payment', BACK: 'cart' },
  payment:    { SUBMIT: 'submitting', BACK: 'address' },
  submitting: { SUCCESS: 'confirmed', FAILURE: 'payment_error', TIMEOUT: 'unknown' },
  …
};
```

Read `react-sandbox/src/routes/machine.jsx` — it's 40 lines and needs no library. XState gives you
hierarchy, parallel states, actors, guards, delays and a visualiser; the *idea* costs a reducer.

## The state everyone forgets

```js
submitting: { SUCCESS: 'confirmed', FAILURE: 'payment_error', TIMEOUT: 'unknown' }
```

`unknown` — the request timed out, so **you do not know whether the payment went through**. Five
booleans cannot express "I don't know"; they can only express false. So the code takes a branch it
was never designed to take, and the user either sees a success they didn't get or is charged twice
on retry.

Modelling it forces the product question: *what does the screen say, and what do we do next?*
(Usually: "we're confirming your payment", then poll — which is the `checking` state in the
sandbox.)

This is the strongest argument for machines and it isn't about code quality: **the modelling
exercise surfaces requirements**.

## Where machines pay, and where they don't

| Worth a machine | Not worth a machine |
|---|---|
| Checkout, booking, onboarding wizards | a toggle |
| Media players (buffering/playing/seeking/ended) | a simple form |
| Upload with retry/cancel/resume | a dropdown |
| Auth flows (OTP, MFA, refresh) | data fetching — a query cache already models it |
| Anything with a "we don't know" state | anything with two states |

The tell: **you're reading the code to work out which combinations are possible.** If you can hold
it in your head, a boolean is fine.

## Doing it without a library

```jsx
const [state, send] = useReducer(reducer, { value: 'cart' });
```

An illegal event is **ignored** rather than corrupting state — that's the property you're buying,
and it's four lines. Add as you need them:

- **guards** — a transition allowed only if a condition holds
- **entry/exit actions** — side effects tied to a state, not scattered through handlers
- **context** — the data alongside the state (the machine's "extended state")

By the time you want hierarchy and parallel regions, use XState. Before then, a reducer is honest.

## Think about

- Your loading state is `isLoading`/`isError`/`data`. Is that a machine?
- How would you model a video player?
- What's the machine equivalent of "the request timed out"?

<details>
<summary>Answers</summary>

**isLoading/isError/data.** It's a machine badly expressed: the legal states are `idle | loading |
success | error`, and the booleans allow `isLoading && isError`. A discriminated union
(`{ status: 'loading' } | { status: 'success', data } | { status: 'error', error }`) is the same
thing done properly, and TypeScript then makes `data` unavailable in the error branch — the
correctness win beyond tidiness. A query cache gives you this out of the box, which is why data
fetching is on the "not worth a machine" list.

**Video player.** `idle → loading → ready → playing ⇄ paused`, plus `buffering` (reachable from
playing, returns to playing), `seeking`, `ended`, `error`. The interesting parts are the ones
booleans miss: buffering-while-seeking, and what a play command does while seeking. Model it and the
edge cases become questions rather than bugs.

**Timeout.** A distinct `unknown` state with its own transitions (usually a `CHECK` that polls for
the true outcome). The wrong answers are treating it as failure (the user retries a payment that
went through) or as success (you ship an order that wasn't paid for).
</details>

---

## 🏗️ Build challenge

1. Take a real flow in your app and enumerate its current booleans. Compute 2ⁿ. List the legal
   states. The gap is your bug surface.
2. Rewrite it as a reducer machine. Count the events that are now ignored rather than mishandled.
3. Add **guards** (can't submit without a valid address) and **entry actions** (start the timeout
   timer on entering `submitting`).
4. **Generate a diagram** from the machine definition (mermaid `stateDiagram-v2`) and put it in the
   PR. A reviewer can check a diagram against the requirements in a way they cannot check a
   component.
5. **Test the transitions exhaustively**: for every state × every event, assert the result. That's a
   small finite table, which is the other thing machines buy you — testability without mocking a UI.

**Done when:** your transition table is fully covered by tests, and the diagram is in the PR
description.

---

## Interview questions

1. Five booleans — how many states, and how many are legal?
2. What's the state people forget in a payment flow, and why does it matter?
3. When is a machine overkill?
4. How do you model this without a library?
5. What does a machine give you for testing?
