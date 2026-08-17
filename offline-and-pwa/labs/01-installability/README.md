# Lab 01 — Installability ⭐⭐⭐

**Goal:** know exactly what makes an app installable, what changes when it is, and whether you want
that.

> <http://localhost:8080/offline-and-pwa/labs/01-installability/>

---

## The criteria

| Requirement | Note |
|---|---|
| HTTPS (or localhost) | |
| a linked manifest with `name`/`short_name`, `start_url` | |
| `display: standalone \| fullscreen \| minimal-ui` | `browser` doesn't qualify |
| 192px and 512px icons, one **maskable** | without maskable, Android shrinks your icon into a white square |
| a registered service worker **with a fetch handler** | an empty SW won't do — the browser wants evidence you intend to handle navigations |

**The only reliable signal is the `beforeinstallprompt` event.** Criteria differ per browser and
change; don't compute installability yourself. Safari/iOS never fires it — installation is a manual
"Add to Home Screen", and you can't prompt.

`scope` controls which URLs stay *inside* the installed window. A link outside it opens in the
browser — which is how people ship an app that leaves itself whenever you tap a link.

## Prompting

```js
addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; });
// later, when the user engages with YOUR affordance:
deferred.prompt();
const { outcome } = await deferred.userChoice;
deferred = null;               // the event is single-use
```

1. **Don't prompt on load.** Someone four seconds into your site has no idea whether they want it in
   their dock.
2. **The event is single-use.** Null it after use and hide your affordance when you have none — also
   on `appinstalled` and when `matchMedia('(display-mode: standalone)')` matches.

## What changes when installed

- **No browser chrome** — no back button, no URL bar, no reload. If your app has no in-app back
  navigation, an installed user can get **stuck**. This is the most common PWA bug.
- **No visible URL** — they can't tell where they are or share it. Add `navigator.share`.
- **Safe areas** — `viewport-fit=cover` plus `env(safe-area-inset-*)`, or your header sits under the
  notch.
- **A cold start from `start_url`** every launch, possibly with no network. Cache it.

## Manifest fields worth more than they look

**`start_url` with a query param** (`?source=installed`) is how you measure whether installation does
anything for you. Without it you'll argue about the PWA's value with no data.

**`share_target`** makes your app a destination in the OS share sheet. For anything that collects
content — notes, bookmarks, tasks — it's the highest-value field, and almost nobody uses it.

**`background_color`** is the splash screen shown before your CSS loads. If it doesn't match your app
background, every cold start begins with a flash of the wrong colour.

## Should you be a PWA at all?

**Most sites shouldn't**, and many that add a manifest and a service worker get nothing but a new
class of caching bugs.

| Clearly pays | Clearly doesn't |
|---|---|
| high-frequency tools (email, notes, tasks, dashboards, chat) | content sites people arrive at from search |
| poor-connectivity contexts (field work, transit, travel) | anything used once or twice |
| OS integration *is* the feature (share target, file handling) | anything where you can't commit to the update discipline in [lab 05](../05-updates/) |

**The middle path is usually right:** ship the service worker for *resilience* — offline fallback,
faster repeat visits, a working outbox — and let installability be an option you don't push. The
offline behaviour is worth having whether or not anyone installs anything.

## Think about

- Your PWA users can't get back from a detail page. What happened?
- Why does the manifest need a maskable icon?
- What does `scope` actually control?

<details>
<summary>Answers</summary>

**Stuck on a detail page.** You relied on the browser back button, which doesn't exist in
`standalone`. Every installed app needs in-app navigation for every route it can reach — an explicit
back affordance, or a tab bar. Test by running in standalone mode and trying to leave each screen.

**Maskable icons.** Android applies a system-wide mask (circle, squircle, rounded square) to every
icon. A non-maskable icon is shrunk and letterboxed in a white square so the mask can't crop
content — which looks broken next to native icons. A maskable icon fills the full canvas with a 20%
safe zone at the edges, and gets cropped correctly.

**`scope`.** Which URLs are considered "part of the app". In-scope navigations stay inside the
installed window; out-of-scope ones open in a browser tab. It defaults to the directory of
`start_url`, which catches people out — a manifest at `/app/manifest.json` scopes to `/app/`, so a
link to `/settings` leaves the app.
</details>

---

## 🏗️ Build challenge

1. Write a manifest with all the fields in this lab. Verify with DevTools → Application → Manifest.
2. Add `?source=installed` to `start_url` and a dashboard segment for it. Measure for a month before
   deciding the PWA is worth more work.
3. Build your own install affordance, shown only when `beforeinstallprompt` has fired and the app
   isn't already installed.
4. Run in standalone and try to reach every route and get back. Fix the dead ends.
5. Add safe-area padding and test on a notched phone.
6. If you collect content, implement `share_target`.

**Done when:** you can navigate your whole app in standalone mode without ever needing a back button
you don't have.

---

## Interview questions

1. What are the install criteria, and how do you detect installability?
2. Why must the service worker have a fetch handler?
3. What breaks when there's no browser chrome?
4. What does a maskable icon solve?
5. When is a PWA *not* worth building?
