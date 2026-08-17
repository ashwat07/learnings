# Lab 02 — State strategy ⭐⭐⭐⭐⭐

**Goal:** classify any piece of state in ten seconds and put it in the right place — which makes the
library choice nearly irrelevant.

**Primary metric:** re-renders per interaction (the sandbox's render tally).

> `cd react-sandbox && npm run dev` → <http://localhost:5173/#state>

---

## The classification

| Kind | Test | Home |
|---|---|---|
| **Local UI** | does anything outside this component need it? no | `useState` |
| **URL** | should it survive a reload, or be shareable? | the URL |
| **Server cache** | does a server own the truth? | a query cache |
| **Global UI** | do distant components need it, and does the server not own it? | a store with selectors |
| **Form** | is it a draft the user is editing? | form state, local to the form |
| **Machine** | does it have modes with legal transitions? | an explicit machine (lab 05) |

Most state-management pain is a misclassification, not a bad library. The two that cause almost all
of it:

1. **Server data in a global store.** You then hand-write loading flags, cache invalidation,
   deduplication, retries and staleness — badly, because that's a hard problem — and you get bugs
   where two screens disagree. A query cache does all of it.
2. **Local UI state in a global store.** `isModalOpen` in Redux means every modal open re-renders
   subscribers, and the state outlives the component that owns it.

## Measure it in the sandbox

Open `#state` and watch the render tally.

| Action | What re-renders | Why |
|---|---|---|
| Type in the **local** input | | |
| Toggle theme in the **Context** panel | | |
| Toggle theme in the **store** panel | | |
| Change the URL select | | |
| Click refetch on **server state** | | |

The one to notice: **toggling the theme in Context re-renders the component that only reads
`query`.** A Context value is one invalidation unit — change any part and every consumer re-renders.
The store panel does the same thing with a selector and re-renders only what read the changed slice.

That's the whole Context-vs-store distinction, and it's why "just use Context" stops working at
scale. Context is a **dependency injection** mechanism that happens to also propagate updates; a
store is an update-propagation mechanism with selectors.

### Making Context survivable

If you keep Context (and you often should — it has no dependencies and it's the right tool for
things that rarely change):

- **Split by change frequency.** `ThemeContext` and `UserContext` separately, not one `AppContext`.
- **Split value and setters.** Setters never change identity; put them in their own context so
  components that only dispatch never re-render.
- **`useMemo` the value** — necessary, and not sufficient, as the sandbox shows.

## Server state deserves its own tool

Read `useQuery` in `react-sandbox/src/routes/state-strategy.jsx` — 40 lines that give you
deduplication, staleness, and revalidation. That's the core of TanStack Query, and the point of
reading it is to see that the features are not incidental:

| Feature | Why you cannot skip it |
|---|---|
| **Dedup by key** | four components asking for the user is one request, not four |
| **Staleness** | "cached" without "stale" means you never refresh |
| **Revalidation on focus/reconnect** | the tab was open for an hour; the data is a lie |
| **Retry with backoff** | networks fail; a spinner forever is not an error state |
| **Invalidate by key after a mutation** | the thing every hand-rolled cache forgets |

If you find yourself writing `useEffect(() => { fetch(...).then(setData) }, [])`, you are three
weeks from reimplementing this list, worse.

## Think about

- Where does "the currently selected row id" live?
- Where does "the list of products currently displayed" live?
- Your app has 40 keys in a global store. What would you expect to find?

<details>
<summary>Answers</summary>

**Selected row id.** Local, if only the list uses it. URL, if a deep link to a selection is
meaningful (usually yes for a master/detail layout — it makes the back button work and the link
shareable). Almost never global.

**The displayed products.** Server cache, keyed by the query that produced them
(`['products', { team, page }]`). Not a global array you mutate — that's the misclassification that
leads to "why is the list stale after I edit an item?".

**40 keys in a store.** A mix of: server data that should be in a query cache, UI flags that should
be local, and derived values that should be computed. The healthy number for genuinely global UI
state in most apps is under ten — theme, auth session, feature flags, a couple of layout toggles.
</details>

---

## 🏗️ Build challenge: audit and re-home

1. Inventory every piece of state in a real app: name, kind (the six above), current home, correct
   home.
2. Add a **render-count overlay** (the sandbox's `useRenderCount` is 12 lines) and record
   re-renders per common interaction *before* changing anything.
3. Re-home the two worst misclassifications. Re-measure.
4. Replace one hand-rolled `useEffect` fetch with a query cache, and count what disappeared: loading
   flags, error flags, duplicate requests, manual invalidation.
5. Add a lint rule or review checklist question: *"which of the six kinds is this, and why is it
   here?"*

**Done when:** you can show a before/after render count for one interaction and name the
misclassification that caused the difference.

---

## Interview questions

1. Name the six kinds of state and where each belongs.
2. Why does Context re-render consumers that didn't read what changed, and what are the three fixes?
3. What does a query cache give you that a global store doesn't?
4. Where should a table's current filter live? Its current page?
5. A colleague puts server data in Redux. What specifically will go wrong?
