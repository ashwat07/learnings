// Lab 01 — Installability.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
let deferredPrompt = null;

// The browser fires this when it has decided the app is installable — which is the only
// reliable signal. There is no "isInstallable()" API.
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();                     // suppress the default mini-infobar so we can choose when
  deferredPrompt = e;
  log.ok('beforeinstallprompt fired — the browser considers this installable');
});
addEventListener('appinstalled', () => log.ok('appinstalled — the app was added'));

navigator.serviceWorker?.register('./sw.js', { scope: './' })
  .then((r) => log.ok(`service worker registered (scope ${r.scope})`))
  .catch((e) => log.bad(`registration failed: ${e.message}`));

on('check', async () => {
  const manifest = await fetch('manifest.webmanifest').then((r) => r.json()).catch(() => null);
  const reg = await navigator.serviceWorker?.getRegistration();
  const rows = [
    { requirement: 'served over HTTPS (or localhost)', met: location.protocol === 'https:' || location.hostname === 'localhost' },
    { requirement: 'a linked web app manifest', met: Boolean(manifest) },
    { requirement: 'name / short_name', met: Boolean(manifest?.name || manifest?.short_name) },
    { requirement: 'start_url', met: Boolean(manifest?.start_url) },
    { requirement: 'display: standalone | fullscreen | minimal-ui', met: ['standalone', 'fullscreen', 'minimal-ui'].includes(manifest?.display) },
    { requirement: 'a 192px and a 512px icon', met: Boolean(manifest?.icons?.some((i) => i.sizes?.includes('192')) && manifest?.icons?.some((i) => i.sizes?.includes('512'))) },
    { requirement: 'a maskable icon (Android home screen)', met: Boolean(manifest?.icons?.some((i) => i.purpose?.includes('maskable'))) },
    { requirement: 'a registered service worker', met: Boolean(reg) },
    { requirement: 'the SW has a fetch handler', met: Boolean(reg?.active) },
    { requirement: 'beforeinstallprompt has fired', met: Boolean(deferredPrompt) },
  ];
  renderTable('#results', rows.map((r) => ({
    requirement: r.requirement, met: r.met ? 'yes' : 'NO', _metClass: r.met ? 'ok' : 'no',
  })), { columns: ['requirement', 'met'] });
  out.textContent =
    'The install criteria differ per browser and change over time, so the ONLY reliable signal is\n' +
    'the beforeinstallprompt event. Do not try to compute installability yourself.\n\n' +
    'Notes on the ones people miss:\n' +
    '  · A FETCH HANDLER IS REQUIRED, not merely a registered worker. The browser wants evidence\n' +
    '    that the app intends to handle its own navigations. An empty service worker will not do.\n' +
    '  · MASKABLE ICONS matter on Android: without purpose="maskable" your icon is shrunk into a\n' +
    '    white rounded square, which looks like a bug. Design it with a 20% safe zone at the edges.\n' +
    '  · SCOPE controls which URLs open INSIDE the installed window. A link outside the scope opens\n' +
    '    in the browser instead — which is how people accidentally ship an app that leaves itself\n' +
    '    every time the user taps a link.\n' +
    '  · Safari/iOS does not fire beforeinstallprompt at all: installation is a manual\n' +
    '    "Add to Home Screen". You cannot prompt, and you should not pretend to.';
});

on('install', async () => {
  if (!deferredPrompt) return log.bad('no install prompt available (already installed, or not eligible)');
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  log[outcome === 'accepted' ? 'ok' : 'muted'](`user ${outcome} the install`);
  deferredPrompt = null;
  out.textContent =
    'Two rules for the prompt, both learned the hard way by everyone who has shipped one:\n\n' +
    '1. DO NOT PROMPT ON LOAD. A user who has been on your site for four seconds has no idea\n' +
    '   whether they want it in their dock. Save the event, show your own subtle "Install" affordance,\n' +
    '   and call prompt() when they engage with it. Conversion is much higher and the annoyance is\n' +
    '   much lower.\n' +
    '2. THE EVENT IS SINGLE USE. Once you call prompt(), that deferred event is spent; you must wait\n' +
    '   for the browser to fire another one. Store it, null it after use, and hide your affordance\n' +
    '   when you have none.\n\n' +
    'Also remember to hide the affordance on `appinstalled`, and when\n' +
    'matchMedia("(display-mode: standalone)").matches — otherwise installed users see an install\n' +
    'button forever.';
});

on('mode', () => {
  const modes = ['fullscreen', 'standalone', 'minimal-ui', 'window-controls-overlay', 'browser'];
  const active = modes.find((m) => matchMedia(`(display-mode: ${m})`).matches) ?? 'unknown';
  renderTable('#results', [
    { fact: 'display-mode', value: active },
    { fact: 'navigator.standalone (iOS)', value: String(navigator.standalone ?? 'n/a') },
    { fact: 'launched from a shortcut?', value: new URLSearchParams(location.search).get('source') ?? 'no' },
    { fact: 'safe-area-inset-bottom', value: getComputedStyle(document.documentElement).getPropertyValue('--sab') || 'set env(safe-area-inset-*) in CSS' },
  ], { columns: ['fact', 'value'] });
  out.textContent =
    `You are running in "${active}" mode.\n\n` +
    'What changes when you are installed, and what you must therefore build:\n\n' +
    '  · NO BROWSER CHROME. No back button, no URL bar, no reload. If your app has no in-app back\n' +
    '    navigation, an installed user can get stuck on a screen with no way out. This is the\n' +
    '    single most common PWA bug.\n' +
    '  · NO VISIBLE URL, so the user cannot tell where they are or share the page. Add a share\n' +
    '    affordance (navigator.share) and keep your in-app navigation obvious.\n' +
    '  · SAFE AREAS. On a notched phone you need viewport-fit=cover plus padding from\n' +
    '    env(safe-area-inset-*), or your header sits under the notch and your footer under the\n' +
    '    home indicator.\n' +
    '  · A COLD START each launch, from start_url. That URL should be a useful landing point and\n' +
    '    should be cached, because it may be opened with no network at all.\n' +
    '  · Links outside `scope` open in the browser. Check yours.\n\n' +
    'Use the display-mode media query to adapt: show your own back button in standalone, hide the\n' +
    '"install" affordance, and consider a slightly different layout — an installed app can afford\n' +
    'a bottom tab bar in a way a website usually cannot.';
});

on('fields', () => {
  renderTable('#results', [
    { field: 'name / short_name', does: 'the title, and the label under the icon (short_name is ~12 chars)' },
    { field: 'start_url', does: 'where a launch lands. Add a query param to measure installed usage' },
    { field: 'scope', does: 'which URLs stay INSIDE the app window' },
    { field: 'display', does: 'standalone | fullscreen | minimal-ui | browser' },
    { field: 'display_override', does: 'an ordered list; how you opt into window-controls-overlay' },
    { field: 'theme_color', does: 'the title bar / status bar colour' },
    { field: 'background_color', does: 'the splash screen while the app boots — match your app background' },
    { field: 'icons (maskable)', does: 'Android adaptive icons; without it you get a white square' },
    { field: 'shortcuts', does: 'long-press / right-click jump list entries' },
    { field: 'share_target', does: 'makes your app appear in the OS share sheet' },
    { field: 'file_handlers', does: 'lets your app open file types (desktop)' },
    { field: 'protocol_handlers', does: 'register web+yourapp:// links' },
  ], { columns: ['field', 'does'] });
  out.textContent =
    'The two that are worth more than they look:\n\n' +
    'START_URL WITH A QUERY PARAMETER (?source=installed) is how you measure whether installation\n' +
    'is doing anything for you. Without it you cannot separate installed sessions from browser\n' +
    'ones, and you will argue about the value of the PWA with no data.\n\n' +
    'SHARE_TARGET turns your app into a destination in the OS share sheet — the user shares a link\n' +
    'or an image from any app and yours appears in the list. For anything that collects content\n' +
    '(notes, bookmarks, tasks) it is the single highest-value manifest field, and almost nobody\n' +
    'uses it.\n\n' +
    'And background_color deserves care: it is the SPLASH SCREEN, shown before your CSS loads. If\n' +
    'it does not match your app background, every cold start begins with a flash of the wrong\n' +
    'colour.';
});

on('should', () => {
  renderTable('#results', [
    { question: 'Do users return often enough to want an icon?', ifNo: 'installation adds nothing' },
    { question: 'Is there a task worth doing offline?', ifNo: 'a service worker is cost with no benefit' },
    { question: 'Do you need push notifications?', ifNo: 'a major reason to install disappears' },
    { question: 'Is your audience mostly iOS?', ifNo: '—', ifYes: 'no install prompt, limited push, aggressive storage eviction' },
    { question: 'Can you operate two versions at once?', ifNo: 'you are not ready — see lab 05' },
    { question: 'Would a native app be required anyway?', ifYes: 'consider whether the PWA is duplicated effort' },
  ], { columns: ['question', 'ifNo', 'ifYes'] });
  out.textContent =
    'The honest version: MOST SITES SHOULD NOT BE INSTALLABLE APPS, and many that add a manifest\n' +
    'and a service worker get nothing for it except a new class of caching bugs.\n\n' +
    'The cases where it clearly pays:\n' +
    '  · high-frequency tools people return to daily (email, notes, tasks, dashboards, chat)\n' +
    '  · anything used in poor connectivity (field work, transit, warehouses, travel)\n' +
    '  · anything where the OS integration is the feature (share target, file handling, shortcuts)\n\n' +
    'The cases where it does not:\n' +
    '  · content sites people arrive at from search and leave\n' +
    '  · anything used once or twice\n' +
    '  · anything where you cannot commit to the update discipline in lab 05 — an installed app\n' +
    '    with a stale service worker is a version of your product you cannot recall\n\n' +
    'The middle path is usually right: SHIP THE SERVICE WORKER FOR RESILIENCE (offline fallback,\n' +
    'faster repeat visits, a working outbox) and let installability be an option you do not push.\n' +
    'The offline behaviour is worth having whether or not anyone installs anything.';
});
