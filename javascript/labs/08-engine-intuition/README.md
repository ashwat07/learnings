# Lab 08 — Engine intuition ⭐⭐⭐⭐⭐⭐

**Goal:** recognise the four optimisation cliffs by their symptom.

**Primary metric:** the ratio between rows — not the absolute times.

> <http://localhost:8080/javascript/labs/08-engine-intuition/>
> Every measurement warms up first, so you're timing optimised code rather than the interpreter.

---

## How V8 runs your code

```
Ignition    an interpreter — runs bytecode and COLLECTS TYPE FEEDBACK
Sparkplug   a fast baseline compiler for warm code
Maglev      a mid-tier optimiser
TurboFan    the full optimiser, which SPECULATES using the feedback
```

TurboFan compiles "this is always a small integer" into code that *assumes* it, guarded by a cheap
check. When the assumption breaks the code **deoptimises**: back to the interpreter, optimised version
discarded. A function that deopts in a loop can end up slower than one that was never optimised.

Everything below follows from that.

## 1. Hidden classes

`{x, y}` and `{y, x}` are **two different shapes** with identical contents. A property read compiles
to "load offset 8 of this shape" — one instruction, if every object at the site has the same shape.

**The rule, which costs nothing to follow:** initialise every field in the constructor, in the same
order, every time — including the ones you don't have a value for yet (`this.error = null`).

## 2. Inline caches

| Site sees | State | Cost |
|---|---|---|
| 1 shape | **monomorphic** | a check and a load |
| 2–4 shapes | polymorphic | a short list of checks |
| 5+ | **megamorphic** | falls back to a global hash lookup |

**The cliff isn't gradual.** Crossing into megamorphic costs a lot; adding forty more shapes after
that costs nothing extra — you already fell off.

Where it appears in real code:

- **a generic utility** called with every object type in your app — `get(obj, key)`, a serialiser, a
  deep-equal, a logger. Megamorphic by construction.
- **heterogeneous lists**: `{type:'text'} | {type:'image'}` rendered by one loop. Give them a **union
  shape** (every field on every variant, unused ones `null`) and the site becomes monomorphic.

## 3. Array element kinds

```
PACKED_SMI  →  PACKED_DOUBLE  →  PACKED_ELEMENTS
     ↓               ↓                  ↓
HOLEY_SMI   →  HOLEY_DOUBLE   →  HOLEY_ELEMENTS
```

**You can only move down.** One string in an array of a million integers moves the whole array to
`PACKED_ELEMENTS` permanently — removing it does not move it back. One `delete` makes it `HOLEY`
forever, and every read then has to check for a hole and walk the prototype chain if it finds one.

- never `delete arr[i]` — `splice`, `filter`, or a sentinel
- never `new Array(n)` then fill by index — that array starts **holey**. Use `Array.from({length: n}, fn)`
- don't mix types in a numeric array
- for genuinely numeric data use a **typed array** — no tagging, no transitions, and transferable to a
  worker

## 4. Dictionary mode

When a fixed layout becomes untenable, V8 converts the object to a hash table. Every access becomes a
lookup, inline caches stop helping, and it doesn't come back.

Causes: **`delete obj.key`** (the most common), many dynamically-added properties, using an object as
a growing key-value store.

**The design rule this produces is good independently of performance: objects for records with known
fields, `Map` for dynamic key-value data.** A `Map` is designed for insertion and deletion, has no
`__proto__` collisions, keeps insertion order for all key types, and gives you `.size`.

## Advice that is out of date

`try/catch` has **not** blocked optimisation since ~2017. Neither is "arrow functions are slower" or
"`forEach` is slower than `for`" reliably true any more. The only durable rules are the ones about
**shape and type stability**, because those follow from how speculative optimisation works rather than
from a particular version.

## The meta-rule

**Almost none of this matters for application code.** A component, a click handler, a validator — the
engine will run any reasonable version fast enough that the difference is unmeasurable next to one
layout or network request.

It matters in four places, and you'll know when you're in one: a render loop, a parser/serialiser over
large data, a comparator called millions of times inside a sort, and library code other people put in
*their* hot paths.

**The value of knowing it anyway is diagnostic.** When something is inexplicably 10× slower, the
algorithm is right, and the profiler shows time spread evenly with no hotspot — that specific shape of
"uniformly slow with no hotspot" is the signature of a megamorphic site or a deopt loop. Recognising
it saves days.

And check the **algorithm** first, always. An O(n²) loop with perfect hidden classes loses to an O(n)
one with terrible ones.

## Think about

- Your app is uniformly slow with no hotspot in the profile. What do you suspect?
- Why is `delete` worse than assigning `undefined`?
- When should you optimise for hidden classes?

<details>
<summary>Answers</summary>

**Uniformly slow, no hotspot.** A megamorphic call site or a deopt loop. Both spread cost across
everything downstream rather than concentrating it, so the flame chart looks flat and no single
function stands out. Check for a generic function called with many object shapes, and for a hot
function whose arguments changed type. Chrome's `--trace-deopt` and `--trace-ic` flags will tell you
directly if you can reproduce it locally.

**`delete` vs `undefined`.** `delete` removes the property, which changes the object's *shape* — and
if the object has been through enough transitions, V8 gives up and converts it to dictionary mode,
permanently. Assigning `undefined` keeps the shape and the offset; the property still exists (`'k' in
obj` is `true`), which is the trade. If you genuinely need keys to come and go, that's what `Map` is
for.

**When to optimise for shapes.** After profiling shows a hot path, and only there. The two things
worth doing unconditionally because they cost nothing: initialise all fields in the constructor, and
never `delete`. Everything else — union shapes, typed arrays, monomorphic call sites — is a targeted
fix for a measured problem, and doing it prophylactically makes code worse for no gain.
</details>

---

## 🏗️ Build challenge

1. Find your app's hottest function (Performance panel, bottom-up view). Check whether its arguments
   have a stable shape.
2. Take a heterogeneous list and give the variants a union shape. Measure the render loop before and
   after.
3. Grep for `delete` on objects that live in hot paths. Convert to `Map` or `undefined`.
4. Grep for `new Array(n)` and audit each for holes.
5. Convert one numeric hot path to `Float64Array` and measure — then check whether it can now be
   transferred to a worker for free.
6. Run Chrome with `--js-flags="--allow-natives-syntax"` and use `%HaveSameMap(a, b)` to confirm two
   objects share a hidden class.

**Done when:** you have one measured, justified optimisation and a list of the ones you decided
*not* to make.

---

## Interview questions

1. What's a hidden class and how do you accidentally create two?
2. Monomorphic vs polymorphic vs megamorphic — where's the cliff?
3. Why is `delete` on an array so bad?
4. What is deoptimisation and what triggers it?
5. When is engine-level optimisation worth doing at all?
