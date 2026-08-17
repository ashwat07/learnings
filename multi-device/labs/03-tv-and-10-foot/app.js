// Lab 03 — TV & the 10-foot UI.
//
// Spatial navigation by hand. A TV remote sends ArrowUp/Down/Left/Right and Enter; there is no Tab,
// no pointer, and no scrollbar. Focus IS the interface.

import { $, $$, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

// Build three rails of tiles.
$$('.rail').forEach((rail, r) => {
  for (let c = 0; c < 12; c++) {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.tabIndex = -1;                 // focusable by script only — the remote drives focus
    tile.dataset.row = r;
    tile.dataset.col = c;
    tile.textContent = `${r}-${c}`;
    rail.append(tile);
  }
});

let row = 0, col = 0;

function focusTile() {
  for (const t of $$('.tile')) t.classList.remove('focused');
  const tile = document.querySelector(`.tile[data-row="${row}"][data-col="${col}"]`);
  if (!tile) return;
  tile.classList.add('focused');
  tile.focus({ preventScroll: true });
  // Keep the focused tile in view by moving the RAIL, not by scrolling the page. On a TV there is
  // no scrollbar and no pointer — the focused item must always be visible.
  const rail = tile.parentElement;
  const offset = Math.max(0, tile.offsetLeft - 160);
  rail.scrollTo({ left: offset, behavior: 'smooth' });
}

addEventListener('keydown', (e) => {
  const rails = $$('.rail');
  const cols = rails[row]?.children.length ?? 0;
  let handled = true;
  switch (e.key) {
    case 'ArrowRight': col = Math.min(col + 1, cols - 1); break;
    case 'ArrowLeft': col = Math.max(col - 1, 0); break;
    case 'ArrowDown': row = Math.min(row + 1, rails.length - 1); break;
    case 'ArrowUp': row = Math.max(row - 1, 0); break;
    case 'Enter': log.ok(`selected tile ${row}-${col}`); handled = true; break;
    default: handled = false;
  }
  if (!handled) return;
  e.preventDefault();                   // arrows must not scroll the page
  focusTile();
});

on('focus-first', () => { row = 0; col = 0; focusTile(); log.head('spatial navigation active — use the arrow keys'); out.textContent =
  'Four keys and OK. That is the entire input vocabulary, and it forces a specific shape of UI:\n\n' +
  '  · EVERYTHING IS A GRID OR A RAIL. If the user cannot get from A to B with four directions, the\n' +
  '    control is unreachable. A free-form layout that looks fine with a mouse can be impossible.\n' +
  '  · FOCUS IS THE ONLY CURSOR. It must always be visible, always obvious from three metres, and\n' +
  '    never lost — if focus falls to <body> the remote does nothing and the app appears frozen.\n' +
  '  · SCROLLING FOLLOWS FOCUS. There is no scrollbar to drag; the container moves so the focused\n' +
  '    item stays in view.\n' +
  '  · THE BACK BUTTON IS SACRED. It must always do something predictable, and it is the only way\n' +
  '    out of anything.\n\n' +
  'Two platform notes: CSS has a spatial-navigation proposal and some TV browsers implement\n' +
  'navigation with arrow keys natively, but coverage is inconsistent enough that every serious TV\n' +
  'app ships its own focus engine. And the remote may send arrow keys OR platform-specific key\n' +
  'codes, so map defensively.'; });

on('overscan', () => {
  const el = $('#safe');
  el.style.display = el.style.display === 'block' ? 'none' : 'block';
  out.textContent =
    'OVERSCAN: many TVs crop the edges of the picture, a legacy of CRT tolerances that never fully\n' +
    'went away. The convention is a SAFE AREA of about 5% on each side (the dashed box) — keep all\n' +
    'text and controls inside it.\n\n' +
    'In CSS that is simply generous padding on your root container, and it is why TV UIs look so\n' +
    'much emptier than web pages. It is not a style choice.\n\n' +
    'The other geometry facts:\n' +
    '  · TVs report 1920×1080 CSS pixels regardless of panel size, so a 55" and a 32" screen are the\n' +
    '    same viewport at very different angular sizes\n' +
    '  · minimum comfortable body text is roughly 24–28px at 1080p, and titles far larger\n' +
    '  · thin fonts and low-contrast greys disappear at three metres; use heavier weights and higher\n' +
    '    contrast than you would on a monitor\n' +
    '  · pure white on pure black smears on some panels; slightly off-white on very dark grey is\n' +
    '    the usual house style';
});

on('constraints', () => {
  renderTable('#results', [
    { constraint: 'input: 4 arrows + OK + back', consequence: 'grid/rail layouts; a hand-written focus engine' },
    { constraint: 'viewed from ~3m', consequence: 'text ≥ 24px, huge focus styles, high contrast' },
    { constraint: 'overscan', consequence: '5% safe-area padding on every edge' },
    { constraint: 'slow CPU (often 2016-era ARM)', consequence: 'small bundles, no heavy frameworks, virtualize everything' },
    { constraint: 'limited GPU / memory', consequence: 'few compositor layers; beware large images' },
    { constraint: 'old browser engines', consequence: 'Chromium 60-something is common; transpile and polyfill' },
    { constraint: 'no hover, no pointer', consequence: 'nothing behind hover; no tooltips' },
    { constraint: 'shared/lean-back context', consequence: 'no typing — avoid forms, use QR-code or phone pairing for login' },
  ], { columns: ['constraint', 'consequence'] });
  out.textContent =
    'THE LOGIN PROBLEM IS THE ONE PEOPLE UNDERESTIMATE. Typing an email and password with an on-screen\n' +
    'keyboard and a remote takes minutes and fails often. Every serious TV app uses DEVICE PAIRING:\n' +
    'show a short code, have the user enter it on their phone or laptop, and poll for authorisation.\n' +
    'That is the OAuth 2.0 Device Authorization Grant, and it exists for exactly this.\n\n' +
    'The engine constraint is the other underestimated one: many shipped TVs run a Chromium from\n' +
    'several years ago and will never update, because the browser is part of the firmware. Check the\n' +
    'actual engine versions of the platforms you support before choosing your baseline — and expect\n' +
    'to ship a lower transpile target and more polyfills than your web app needs.';
});

on('perf', () => {
  renderTable('#results', [
    { budget: 'JS bundle', web: '150–300KB', tv: '< 100KB, and every KB is parsed on a slow CPU' },
    { budget: 'time to interactive', web: '< 3s', tv: 'aim < 5s, and expect worse' },
    { budget: 'list rendering', web: 'virtualize over ~1,000', tv: 'virtualize over ~50 — seriously' },
    { budget: 'images', web: 'responsive srcset', tv: 'ONE size (1080p), pre-sized, and cached' },
    { budget: 'animation', web: '60fps', tv: 'often 30fps; prefer simple opacity fades' },
    { budget: 'memory', web: 'generous', tv: 'a few hundred MB total, shared with the OS' },
  ], { columns: ['budget', 'web', 'tv'] });
  out.textContent =
    'A TV app is a PERFORMANCE PROJECT WITH A UI ATTACHED. The rules from the rest of this repo apply\n' +
    'with the numbers moved down a tier:\n\n' +
    '  · VIRTUALIZE AGGRESSIVELY. A rail of 200 tiles must render about 10. Focus-driven navigation\n' +
    '    makes this easy — you always know exactly where the user is.\n' +
    '  · PRELOAD ALONG THE FOCUS PATH. You know they can only move four ways, so fetch the images\n' +
    '    for the neighbouring tiles and nothing else. This is the one place where prefetching is\n' +
    '    genuinely predictable.\n' +
    '  · TRANSFORM AND OPACITY ONLY (graphics lab 01), and expect a 30fps ceiling on many panels.\n' +
    '  · MEASURE ON THE ACTUAL DEVICE. A 6× CPU throttle in DevTools is a rough proxy at best; TV\n' +
    '    chipsets are slow in ways that do not map onto a linear multiplier, and their GPU and memory\n' +
    '    limits bite first.\n' +
    '  · KEEP A CONSTANT MEMORY PROFILE. Long lean-back sessions mean a slow leak that is invisible\n' +
    '    in a ten-minute web session will crash a TV app after two hours (spa-memory-leaks course).';
});

on('rules', () => {
  out.textContent =
    'THE TRANSFERABLE PART, and the reason this lab is worth doing even if you never ship to a TV:\n\n' +
    'A TV IS THE EXTREME CASE OF CONSTRAINTS YOU ALREADY HAVE.\n\n' +
    '  · keyboard-only navigation — the same as accessibility lab 02, with no Tab key to fall back on\n' +
    '  · always-visible focus — the same requirement, but now nobody can use the app without it\n' +
    '  · no hover — the same as touch, permanently\n' +
    '  · a slow CPU — the same as a low-end Android, but worse and non-negotiable\n' +
    '  · long sessions — the same memory discipline, with less headroom\n' +
    '  · large targets and high contrast — the same as accessibility lab 05, from three metres\n\n' +
    'Every one of those makes your ordinary web app better. Teams that build a TV version usually\n' +
    'find that the focus management and virtualization work they were forced to do pays back on the\n' +
    'phone and the desktop too — because they were never optional, only easy to skip.';
});
