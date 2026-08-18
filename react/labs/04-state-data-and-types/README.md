# Lab 04 — State, data & types ⭐⭐⭐⭐⭐

**Goal:** put each piece of state in the right place, and type the whole surface properly.

```sh
cd react-sandbox && npm run dev     # → #state
```
> Prerequisite: [typescript](../../../typescript/) labs 02–04.

---

## Six kinds of state

| Kind | Lives in | Example |
|---|---|---|
| **server state** | a query cache | anything from an API |
| **URL state** | the URL | filters, tabs, pagination, the selected id |
| local UI state | `useState` | is this dropdown open |
| shared UI state | a store with **selectors** | theme, sidebar, current user |
| form state | a form library or a reducer | drafts, validation, dirty flags |
| ephemeral | a ref | a timer id, the previous value |

**Most "state management" problems are misclassification.** Server state in Redux needs caching,
invalidation, deduplication and refetching hand-built; URL state in a store isn't shareable or
restorable.

**Start local. Lift only when something else needs it. Reach for a store only when lifting reaches
the root.**

Built end to end in
[architecture-and-state lab 02](../../../architecture-and-state/labs/02-state-strategy/), including a
40-line query cache.

## Context vs a store

A Context provider re-renders **every consumer** when its value changes, however small the change.
The sandbox shows this: toggling the theme re-renders a component that only reads `query`.

**One context = one invalidation unit.** Options: split contexts by change frequency, or use a store
with selectors (`useSyncExternalStore` + a selector re-renders only what read the changed slice).

Context is right for things that **rarely change** — theme, locale, the auth user, a DI container. It
is the wrong tool for a value that changes on every keystroke.

## Typing React properly

```tsx
// props: prefer a type alias with explicit children
type Props = { title: string; children?: React.ReactNode };

// a generic component
function List<T>({ items, render }: { items: T[]; render: (item: T) => React.ReactNode }) { … }

// events: let the element type infer them
<input onChange={(e) => …} />                 // e is React.ChangeEvent<HTMLInputElement>
const onSubmit = (e: React.FormEvent<HTMLFormElement>) => …

// refs
const ref = useRef<HTMLInputElement>(null);   // null for DOM refs
const timer = useRef<number | undefined>(undefined);   // undefined for mutable boxes

// discriminated props — mutually exclusive options, enforced
type ButtonProps =
  | { variant: 'link'; href: string }
  | { variant: 'button'; onClick: () => void };
```

The rules that matter most:

- **`ReactNode` for children, `ReactElement` for "exactly one element", `JSX.Element` almost never.**
  `ReactNode` includes strings, numbers, arrays, `null` and fragments — which is what children
  actually are.
- **Discriminated props** make illegal combinations unrepresentable, exactly as in
  [typescript lab 06](../../../typescript/labs/06-branded-types-and-boundaries/). `<Button
  variant="link" onClick={…}>` becomes a compile error.
- **`useState` needs a hint when it starts empty**: `useState<User | null>(null)`, or it infers
  `null`.
- **Don't type what infers.** Annotating a component's return type or every event handler adds noise
  and can be *wrong*.
- **`as const` / `satisfies`** for route tables, theme tokens and option lists, so keys survive
  ([typescript lab 07](../../../typescript/labs/07-declarations-and-config/)).

## The data boundary

`res.json()` returns `any`, and from there the compiler stops helping. Parse at the boundary with
**Zod**/**Valibot**/**ArkType** and the parser *is* the type — one definition for the runtime check
and the static type.

For server state, use a query library (TanStack Query, RTK Query, or your framework's loader). What
you're buying is not fetching — it's caching, deduplication, staleness, revalidation, retry and
request cancellation, all of which you will otherwise write badly.

## Think about

- A filter needs to survive a page reload and be shareable. Where does it live?
- When is `useContext` the wrong tool?
- Why is `React.FC` discouraged now?

<details>
<summary>Answers</summary>

**Shareable, reload-surviving filter.** The **URL**. `?team=core&sort=name` is free persistence, free
sharing, free back-button support, and it's the only option that survives a link being pasted into
Slack. Read it with your router's search-param hook; don't mirror it into state (that's two sources
of truth and a sync bug).

**When Context is wrong.** For high-frequency values, because every consumer re-renders on every
change — a mouse position, a form field, a scroll offset, an animation value. Also for anything where
you'd want to subscribe to *part* of the value: Context has no selector, so a store is the right
shape. Context is for stable, rarely-changing, tree-wide values.

**`React.FC`.** It historically implied a `children` prop whether or not the component accepted one
(fixed in React 18's types), it makes generic components awkward to express, and it adds nothing over
annotating the props parameter — which also reads better and keeps the return type inferred. Just
write `function Card(props: CardProps)`.
</details>

---

## Interview questions

1. Name the six kinds of state and where each belongs.
2. Why does a Context update re-render consumers that don't read the changed field?
3. `ReactNode` vs `ReactElement` — when do you use each?
4. How do you make two props mutually exclusive?
5. Why does `res.json()` returning `any` matter, and what do you do about it?
