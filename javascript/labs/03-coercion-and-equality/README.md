# Lab 03 — Coercion & equality ⭐⭐⭐⭐

**Goal:** run the spec algorithms by hand so the "wat" examples stop being surprising.

> <http://localhost:8080/javascript/labs/03-coercion-and-equality/>
> The lab **implements** `ToPrimitive`, abstract equality and `+`, and traces every step.

---

## Abstract equality is six rules

1. same type → strict comparison, done
2. `null == undefined` → **true**. The only special case, and why `x == null` is a legitimate idiom
3. number vs string → `ToNumber(string)`
4. **either is boolean → `ToNumber(boolean)`** — *not* truthiness
5. object vs primitive → `ToPrimitive(object)`, then start again
6. otherwise → false

Rule 4 is the source of the most confusing consequence in the language: `[] == false` is **true**
while `[] ? 'yes' : 'no'` is `'yes'`. Both are correct; they're different algorithms. Nothing in
`==` involves truthiness.

## `+` is two steps

1. `ToPrimitive` both operands with hint `"default"`
2. if **either** is now a string → concatenate. Otherwise `ToNumber` both and add.

So `[] + {}` is `"[object Object]"` because `ToPrimitive([])` is `""` (`Array.prototype.join` of
nothing) and `ToPrimitive({})` is `"[object Object]"`. And `[] - []` is `0` because `-` has **no
string branch** — the asymmetry is entirely in `+`.

## Three hints

| Hint | Tries | Used by |
|---|---|---|
| `"number"` | `valueOf`, then `toString` | arithmetic, unary `+`, relational operators |
| `"string"` | `toString`, then `valueOf` | template literals, `String()`, property keys |
| `"default"` | `valueOf`, then `toString` | `+` and `==` |

**`Date` is the one built-in that overrides `"default"` to behave like `"string"`** — which is why
`date + 1` concatenates while `date - 1` gives a timestamp. A special case in the spec, not a rule
you can derive.

`Symbol.toPrimitive` lets you control all three, which is genuinely useful for value objects (Money,
Duration, Temperature) — and for making a class that **throws** on accidental coercion.

## The two rows to stare at

```
null == 0    →  false    (== has exactly one special case, and this isn't it)
null >= 0    →  true     (relational operators use ToNumber, and ToNumber(null) is 0)
```

`null` is simultaneously not-equal-to and greater-than-or-equal-to zero. Not a paradox — two
different algorithms, and an excellent argument for never comparing values whose type you're unsure
of.

## What to actually do

| Rule | Note |
|---|---|
| `===` always | except `x == null` meaning "null or undefined" — the one idiom worth keeping |
| `Number.isNaN`, not the global `isNaN` | the global coerces first: `isNaN("foo")` is `true` |
| `Object.is` for `-0` and `NaN` | the only comparison that handles both |
| `Number(x)` / `String(x)`, not `+x` / `x + ""` | explicit, greppable, hint-independent |
| `Array.isArray`, not `typeof` | `typeof []` is `"object"` |
| **`??` not `||` for defaults** | `\|\|` replaces `0` and `""` too |
| integers (minor units) for money | floats can't represent `0.1` — in any language |

The `??` row catches modern code most often:

```js
const timeout = opts.timeout || 3000;   // a caller passing 0 gets 3000
const timeout = opts.timeout ?? 3000;   // 0 is respected
```

Any config value with a meaningful falsy value — a count, a delay, a flag, a label — needs `??`.

**The honest position on `==`:** knowing the algorithm is worth an hour, because you'll read code
that uses it and the interview question is common. Writing it isn't — and the one genuinely clear
case is exactly the one linters allow (`eqeqeq: ["error", "smart"]`).

## Think about

- Why is `NaN !== NaN`?
- Why does `0.1 + 0.2 !== 0.3`, and is that a JavaScript flaw?
- When is `==` genuinely clearer than `===`?

<details>
<summary>Answers</summary>

**`NaN !== NaN`.** IEEE 754 specifies it: NaN means "the result of an invalid operation", and two
invalid operations aren't necessarily the same invalid operation, so equality is defined as false.
It's the reason `Number.isNaN` exists, and the reason `[NaN].includes(NaN)` is `true` while
`[NaN].indexOf(NaN)` is `-1` — `includes` uses SameValueZero, `indexOf` uses strict equality.

**`0.1 + 0.2`.** Not a JavaScript flaw — it's IEEE 754 binary floating point, and it behaves
identically in Python, Java, C#, Go and Rust. `0.1` has no exact binary representation, exactly as
`1/3` has no exact decimal one. For money use integer minor units or a decimal library; for
comparisons use an epsilon (`Math.abs(a - b) < Number.EPSILON * scale`).

**When `==` is clearer.** `x == null` to mean "null or undefined", which is genuinely more readable
than `x === null || x === undefined` and is exactly what the `smart`/`allow-null` lint options
permit. That's the whole list.
</details>

---

## 🏗️ Build challenge

1. Enable `eqeqeq` with the null exception. Fix what it finds — each one is a decision, not a
   mechanical replacement.
2. Grep for `||` used for defaults and audit each for a meaningful falsy value.
3. Find every place your app compares a value that could be a string or a number (query params, form
   inputs, API responses) and make the coercion explicit at the boundary.
4. Add `Symbol.toPrimitive` to one value object in your domain so `+` and `${}` do the right thing.
5. Audit money handling. If any amount is a float, that's a bug waiting for a rounding error.

**Done when:** no coercion in your codebase is implicit at a type boundary.

---

## Interview questions

1. State the abstract equality algorithm.
2. Why is `[] == false` true when `[]` is truthy?
3. Why does `date + 1` concatenate but `date - 1` subtract?
4. `null == 0` vs `null >= 0` — explain both.
5. When do you use `??` instead of `||`?
