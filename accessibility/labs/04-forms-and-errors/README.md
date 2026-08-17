# Lab 04 — Forms & errors ⭐⭐⭐⭐⭐

**Goal:** make it possible to find out what went wrong and fix it.

**Primary metric:** submit the empty form with a screen reader on — is anything announced, and is
the error read with its field?

> <http://localhost:8080/accessibility/labs/04-forms-and-errors/>

---

## Three questions a form has to answer

**What is this field? What went wrong? Where do I go to fix it?**

## The broken version fails three different groups

1. **Nothing was announced.** The user pressed Pay and, as far as a screen reader is concerned,
   nothing happened. Focus is still on the button.
2. **The error text isn't associated with its field.** Tabbing to "Full name" announces "Full name,
   edit text" — the error below it is an unrelated node.
3. **The error is signalled by colour.** WCAG 1.4.1: colour must never be the only means of
   conveying information. ~1 in 12 men has a colour vision deficiency, and nobody using a screen
   reader sees a border.

## The accessible version — four mechanisms

| Mechanism | Does |
|---|---|
| `aria-invalid="true"` | the field announces itself as invalid |
| **`aria-describedby`** | the error is **read with the field** when you tab to it — the most important one |
| an **error summary** at the top, focused on submit, with links to each field | announced (focus moved), navigable (they're links) |
| an icon or text prefix | so the error isn't colour-only |

The summary pattern comes from the GOV.UK Design System and is the best-tested error pattern in
existence: it works for screen readers, for sighted keyboard users, for people with cognitive
disabilities (all problems in one place), and on small screens.

Tab into a field afterwards and listen: *"Full name, edit text, invalid data, As it appears on your
card, Full name is required."*

## `autocomplete` is a requirement, not a convenience

WCAG 2.1 added 1.3.5 (Identify Input Purpose) so assistive tech can present familiar fields in a
user's own way. For someone with a motor disability, autofill can be the difference between a
30-second checkout and a ten-minute one.

| Attribute | Gives |
|---|---|
| `autocomplete="name" / "email" / "tel"` | browser fill + programmatic purpose |
| `autocomplete="cc-number"` | card autofill — a large, measurable conversion gain |
| `autocomplete="one-time-code"` | the SMS code offered above the keyboard |
| `type="email" / "tel" / "url"` | the right mobile keyboard |
| `inputmode="numeric"` | a numeric keypad **without** `type=number`'s baggage |
| `enterkeyhint` | a labelled Enter key on mobile |

**Avoid `type="number"`** for anything that's a numeral rather than a quantity (card, phone,
postcode, OTP): it strips leading zeros, allows `e` and `+`, scroll-wheels, and rejects valid input.
`type="text"` + `inputmode="numeric"`.

## The checklist

- [ ] every input has a `<label for>` — **placeholder is not a label**
- [ ] required marked with `required` **and** in the label text
- [ ] errors: `aria-invalid` + `aria-describedby` + text + icon
- [ ] an error summary, focused, with links
- [ ] validate on **blur** and on submit, not every keystroke
- [ ] **don't disable the submit button**
- [ ] group related fields in `<fieldset><legend>`
- [ ] `autocomplete` on everything the browser knows
- [ ] targets ≥ 24×24 CSS px
- [ ] errors survive reload / back

### The two that get argued about

**Don't disable submit while invalid.** It feels tidy and is hostile: no explanation of what's
missing, and a disabled button is skipped by the tab order in most browsers. Let them submit, then
say precisely what's wrong. (Disable *after* submit to prevent double submission, and announce that
you're working.)

**Validate on blur, not per keystroke.** "Invalid email" after the first character is wrong, and
with a screen reader it's deafening. Validate on blur; re-validate on input *only after it has
already failed*, so the error clears as soon as they fix it.

Native constraint validation (`required`, `type=email`, `pattern`) is free and works without JS, but
its bubbles aren't announced consistently and vanish quickly — use `novalidate` with your own
messages, keeping the attributes for semantics and autofill.

## Think about

- Your design has no visible labels, only placeholders. What do you do?
- How do you announce "3 errors" without being obnoxious?
- Where should focus go after a failed submit?

<details>
<summary>Answers</summary>

**Placeholder-only design.** Push back with the specifics: the label vanishes exactly when it's
needed (while typing), it usually fails contrast, autofill overwrites it, and users can't check what
they typed against what was asked. If the design is fixed, use a floating label that moves rather
than disappears — that keeps the visible label *and* the compact look, which is usually what the
design was after.

**Announcing "3 errors".** Move focus to the error summary. That announces the whole summary once,
politely, in a way the user can then navigate — rather than firing three separate assertive alerts
that interrupt each other. Focus movement is a better announcement mechanism than a live region
whenever there's somewhere sensible to move to.

**Focus after failed submit.** The error summary, if there is one (it gives the overview and the
links). Otherwise the first invalid field. Never leave it on the submit button, and never move it to
the first field unconditionally — that discards the user's place when only the last field was wrong.
</details>

---

## 🏗️ Build challenge

1. Take your most important form and add the four mechanisms.
2. Build the error summary as a reusable component, in the design system, so nobody re-derives it.
3. Add `autocomplete` to every field the browser knows. Measure completion time before and after.
4. Test with a screen reader: submit empty, submit with one error, fix it, resubmit.
5. Test with a keyboard only, at 400% zoom, and on a phone with autofill enabled.
6. Add a test asserting `getByRole('textbox', {name: 'Email'})` — it fails if the label breaks.

**Done when:** the whole form can be completed with a screen reader without ever seeing the screen.

---

## Interview questions

1. Why isn't a placeholder a label?
2. What does `aria-describedby` do for an error message?
3. Why shouldn't you disable the submit button?
4. When do you validate, and why not on every keystroke?
5. Why is `autocomplete` an accessibility requirement?
