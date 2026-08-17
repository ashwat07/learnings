# Lab 01 — Component architecture at scale ⭐⭐⭐⭐⭐

**Goal:** put boundaries where they reduce coupling, and structure folders so that a feature can be
deleted in one command.

**Primary metric:** how many files you touch to add a field to a feature — and how many to delete
the feature.

---

## The two tests

Everything in this lab reduces to two questions you can apply to any codebase:

1. **The deletion test.** Can you delete a feature by deleting one folder? If removing "wishlist"
   means hunting through `components/`, `hooks/`, `utils/`, `types/` and a switch statement in
   `App.tsx`, your structure is organised by *what things are* rather than *what they are for*.
2. **The change test.** To add one field to the checkout form, how many files do you open? Three is
   fine. Eleven means the feature is smeared across layers.

## Folder structure: by type vs by feature

```
by type (scales badly)                by feature (scales)
components/                           features/
  ProductCard.tsx                       catalogue/
  CartRow.tsx                             components/ProductCard.tsx
  CheckoutForm.tsx                        api.ts
hooks/                                    hooks/useProducts.ts
  useProducts.ts                          types.ts
  useCart.ts                              index.ts        ← the public API
utils/                                  cart/
  price.ts                                components/CartRow.tsx
types/                                    store.ts
  index.ts                                index.ts
                                      shared/
                                        ui/               ← genuinely generic primitives
                                        lib/
```

The by-type version looks tidy on day one and fails on two counts: nothing tells you which files
belong together, and every folder becomes a dumping ground of 200 unrelated files.

The rule that makes by-feature work: **a feature may import from `shared/`, and from another
feature only through its `index.ts`.** That one constraint is what stops it degenerating.

## Boundaries: what a component should own

| A component should own | It should not own |
|---|---|
| its own layout and styling | how its data is fetched (pass it in, or use a feature hook) |
| its own ephemeral UI state | global state it does not display |
| the props contract it publishes | knowledge of its parent's structure |

Two shapes that consistently reduce coupling:

**1. Composition over configuration.** A component with 14 boolean props is a component that has
absorbed four different use cases:

```jsx
// configuration: every new case adds a prop, and they interact
<Card title={t} subtitle={s} showAvatar avatarUrl={u} showActions onEdit={e} compact bordered … />

// composition: the caller assembles what it needs
<Card>
  <Card.Header><Avatar src={u} /><Card.Title>{t}</Card.Title></Card.Header>
  <Card.Body>{children}</Card.Body>
  <Card.Actions><Button onClick={e}>Edit</Button></Card.Actions>
</Card>
```

The test: when a new design lands, does it need a new prop (configuration) or a new arrangement
(composition)?

**2. Container/presenter, but only where it pays.** The valuable version is not a rule about files;
it's that a component which does no data fetching is trivially testable and reusable. Apply it to
the components you actually want to test in isolation, not to all of them.

## The exercise

In the sandbox (or a codebase you own), take one feature and:

- [ ] Draw its current import graph. Which modules import from *inside* another feature?
- [ ] Move it to a feature folder with a single `index.ts` public API.
- [ ] Delete every import that reaches past that API. Count how many there were.
- [ ] Apply the deletion test: can you now `rm -rf` the feature and have the app compile with only
      the route registration missing?
- [ ] Apply the change test: add one field, count the files touched.

Write both numbers down before and after. Architecture arguments end when someone has numbers.

## Enforcing it

Structure decays unless a machine cares:

```json
// eslint import/no-restricted-paths, or dependency-cruiser
{
  "zones": [
    { "target": "features/cart", "from": "features/catalogue", "except": ["index.ts"] }
  ]
}
```

Plus a check for **import cycles** — a cycle is usually two features that should be one, or a
missing shared module. `madge --circular src/` finds them in seconds.

## Think about

- When is a shared component worth extracting, and when is it premature?
- Two features need the same "Product" type. Where does it live?
- A feature folder has grown to 60 files. What now?

<details>
<summary>Answers</summary>

**When to extract.** The rule of three: two usages might be a coincidence, three is a pattern. The
cost of extracting too early is a component with an API shaped by one caller, which the second and
third callers then bend with props — which is how you get 14 booleans. Duplicate first, extract when
the shape has stabilised.

**A shared type.** If both features genuinely own the concept, it belongs in `shared/` — but check
first whether they mean the same thing. "Product" in the catalogue (with images and marketing copy)
and "Product" in the cart (with a quantity and a price snapshot) are usually *different types* that
happen to share a name, and merging them creates a type with 30 optional fields. Duplication of
types across boundaries is often correct.

**60 files.** Look for a sub-feature that has its own boundary (checkout inside cart), or utilities
that have become genuinely generic and belong in `shared/`. If neither applies, 60 files in one
feature is fine — the number is not the problem, the *coupling* is. Check the import graph before
reorganising.
</details>

---

## 🏗️ Build challenge: make the boundaries real

1. Add **dependency-cruiser** (or ESLint `import/no-restricted-paths`) with rules: features may not
   import each other's internals; `shared/` may not import from `features/`; no cycles.
2. Generate an **architecture diagram** from the actual import graph (dependency-cruiser emits
   DOT/mermaid) and commit it. A diagram generated from code cannot lie the way a hand-drawn one
   does.
3. Add a **CI check** that fails on a new cross-boundary import, with a message naming both files.
4. Write a **codemod** that moves one by-type folder into a feature folder and rewrites the imports.
   Doing it once by hand teaches you where the coupling is; automating it is what makes the
   migration finishable.
5. Measure and publish the two numbers: files touched to add a field, files deleted to remove a
   feature, before and after.

**Done when:** a deliberate cross-boundary import fails CI, and your generated diagram matches what
you thought the architecture was (it usually won't, the first time).

---

## Interview questions

1. By-type or by-feature folders? What breaks first in each?
2. What's the one import rule that makes a feature-folder structure hold?
3. When would you extract a shared component, and when is that premature?
4. Two features have a `Product` type. Merge or duplicate?
5. How do you stop architecture decaying between reviews?
