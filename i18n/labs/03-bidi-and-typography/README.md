# Lab 03 — Bidi & typography ⭐⭐⭐⭐⭐

**Goal:** support RTL by changing vocabulary, not by writing a second stylesheet.

> <http://localhost:8080/i18n/labs/03-bidi-and-typography/>

---

## Logical properties

Switch the stage to RTL. The **logical** card mirrors; the **physical** one doesn't.

| Physical | Logical |
|---|---|
| `margin-left / right` | `margin-inline-start / end` |
| `padding-left / right` | `padding-inline-start / end` |
| `border-left / right` | `border-inline-start / end` |
| `left / right` | `inset-inline-start / end` |
| `text-align: left / right` | `text-align: start / end` |
| `width / height` | `inline-size / block-size` |
| `float: left` | `float: inline-start` |

Grep for `margin-left`, `padding-right`, `text-align: left`, `float: left`. **That list is your RTL
backlog**, and converting it is mechanical.

Set `dir` on `<html>` from the locale, not per component — the browser needs it for the bidi
algorithm, form controls and scrollbar placement.

### What logical properties don't solve

- **Transforms.** `translateX(10px)` goes the same physical way regardless. Flip in a `[dir=rtl]`
  rule or hold the sign in a custom property.
- **Directional icons.** "Next" arrows and "back" chevrons mirror. Play buttons don't (media follows
  the timeline), nor do checkmarks or clocks. **Mirror it if its meaning depends on reading
  direction** — mirroring everything is as wrong as mirroring nothing.
- **Shadows and gradients** with a physical offset.
- **Keyboard arrows.** In RTL, `ArrowLeft` usually means "next".
- **`scrollLeft`**, which is reversed or negative in RTL depending on browser.

## Text expansion

The same label, six languages, one fixed-width box — it clips:

| Locale | "Save changes" | vs English |
|---|---|---|
| de | Änderungen speichern | +67% |
| fi | Tallenna muutokset | +50% |
| ru | Сохранить изменения | +58% |
| ja | 変更を保存 | −58% |

**Budget +35% for European languages, more for short strings.** Asian languages usually run
*shorter*, creating the opposite bug: a layout that only looks right when text fills the space.

- never a fixed width on translated text — `min-width`, and let it grow
- never a fixed height either — text wraps to two lines and clips vertically
- design at the longest plausible string, not the English one
- `text-overflow: ellipsis` hides the problem, including from you
- **never bake text into images** — it can't be translated at all

Same fixed-size assumptions that break the [400% zoom test](../../../accessibility/labs/05-visual-and-motion/).
Fix one and you fix the other.

## Fonts and scripts

| Concern | Detail |
|---|---|
| script coverage | your brand font probably has no Arabic, Devanagari, Thai or CJK |
| CJK size | a full CJK font is megabytes — subset, or use a system stack |
| line-height | CJK and Devanagari need more; a tight Latin value clips diacritics |
| **`unicode-range`** | one family name, several files; the browser fetches only what's used |
| `lang` attribute | drives font selection, hyphenation, quote marks, spell check, and the screen reader's voice |

```css
@font-face { font-family: App; src: url(latin.woff2);  unicode-range: U+0000-00FF; }
@font-face { font-family: App; src: url(arabic.woff2); unicode-range: U+0600-06FF; }
```

**Don't subset too aggressively.** `U+0000-00FF` drops Polish ł, Turkish ğ, Romanian ș and every
Vietnamese diacritic, so those users get a fallback font mid-word. Subset by the languages you
actually support.

## Mixed-direction text

A Latin username inside an Arabic sentence is where the Unicode bidi algorithm gets ambiguous — the
classic symptom is punctuation jumping to the wrong end.

- **`<bdi>`** — bidi isolate. Wrap any user-supplied string whose direction you don't control:
  usernames, filenames, search terms.
- **`dir="auto"`** — the browser infers direction from the first strong character. Perfect for an
  input where the user may type either script.

Arabic and Persian may render digits as ٠١٢٣ depending on locale; those still read left-to-right
inside an RTL line, which is correct and looks wrong until you know it's correct.

## Think about

- Should you mirror a "play" button in RTL?
- Your design has a fixed-width sidebar with translated labels. What breaks?
- Why does `lang` matter beyond fonts?

<details>
<summary>Answers</summary>

**Play button.** No. Media controls follow the *timeline*, not the reading direction, and the play
triangle points "forward in time" — which is right-pointing everywhere, as it is on physical
devices. The same logic exempts checkmarks, clocks and most brand marks. What *does* mirror:
next/previous, back, indent/outdent, undo/redo, list bullets, progress bars, and anything whose
meaning is "onward in the reading direction".

**Fixed-width sidebar.** German labels clip or wrap to three lines and the sidebar's vertical rhythm
breaks; Japanese leaves it looking empty and unbalanced. Use a min-width plus a max-width and let it
size to content, test with the longest supported language, and never rely on ellipsis to hide it —
a truncated navigation label is a navigation the user can't read.

**`lang` beyond fonts.** It drives hyphenation rules, locale-aware CSS `quotes`, spell check, whether
`text-transform: uppercase` does the Turkish thing correctly, and — most importantly — the *voice* a
screen reader uses. A French paragraph read aloud in an English voice is genuinely unintelligible.
Set it on `<html>` and on any element in a different language.
</details>

---

## 🏗️ Build challenge

1. Convert your CSS to logical properties. A codemod handles most of it.
2. Add `dir` to `<html>` from the locale and test your app in Arabic or Hebrew.
3. Fix what logical properties can't: transforms, directional icons, arrow keys.
4. Wrap every user-supplied string in `<bdi>` and set `dir="auto"` on free-text inputs.
5. Set up `unicode-range` splits for every script you support, and verify only the needed files load.
6. Run your screenshot tests in RTL **and** in pseudo-locale.

**Done when:** switching `dir` produces a correct layout with no RTL-specific stylesheet.

---

## Interview questions

1. What do logical properties solve, and what do they not?
2. Which icons mirror in RTL and which don't?
3. How much do you budget for text expansion?
4. What does `<bdi>` do?
5. What does `unicode-range` buy you?
