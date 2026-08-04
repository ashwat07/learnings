// Lab 18 — Layout shift (CLS).
//
// All eight shift sources are implemented. The eight fixes are yours (TODOs at the bottom).
// The CLS calculation here is the REAL one — session windows, 1s gap, 5s cap — so you can
// see why the number is what it is instead of trusting a single figure.

PerfHUD.start();

const shiftsEl = document.getElementById('shifts');
const windowsEl = document.getElementById('windows');

// ---------------------------------------------------------------------------
// CLS, computed properly.
//
// A session window groups shifts that are each within 1s of the previous one, capped at 5s
// total. CLS is the LARGEST window's sum — not the sum of everything. So one clustered burst
// dominates, and scattered small shifts are treated more kindly.
// ---------------------------------------------------------------------------
const allShifts = [];
let windows = [];

function addShift(entry) {
  const record = {
    at: entry.startTime,
    value: entry.value,
    excluded: entry.hadRecentInput,
    sources: (entry.sources || []).map(s => ({
      selector: pathTo(s.node),
      from: rectStr(s.previousRect),
      to: rectStr(s.currentRect),
      moved: s.previousRect && s.currentRect
        ? Math.max(Math.abs(s.currentRect.top - s.previousRect.top),
                   Math.abs(s.currentRect.left - s.previousRect.left))
        : 0,
    })),
  };
  allShifts.push(record);

  if (!entry.hadRecentInput) {
    const w = windows[windows.length - 1];
    const isNewWindow = !w ||
      entry.startTime - w.lastAt > 1000 ||      // more than 1s since the previous shift
      entry.startTime - w.firstAt > 5000;       // window is capped at 5s
    if (isNewWindow) {
      windows.push({ firstAt: entry.startTime, lastAt: entry.startTime, sum: entry.value, count: 1 });
    } else {
      w.lastAt = entry.startTime;
      w.sum += entry.value;
      w.count++;
    }
  }
  render();
}

function cls() {
  return windows.reduce((max, w) => Math.max(max, w.sum), 0);
}

function rectStr(r) {
  return r ? `${Math.round(r.width)}×${Math.round(r.height)} @ ${Math.round(r.left)},${Math.round(r.top)}` : '–';
}

/** A stable-ish selector for a node, so a report survives the DOM being replaced. */
function pathTo(node) {
  if (!node || node.nodeType !== 1) return '(unknown)';
  const parts = [];
  let el = node;
  while (el && el.nodeType === 1 && parts.length < 4) {
    let part = el.tagName.toLowerCase();
    if (el.id) { parts.unshift(`#${el.id}`); break; }
    if (el.className && typeof el.className === 'string') {
      part += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    }
    parts.unshift(part);
    el = el.parentElement;
  }
  return parts.join(' > ');
}

function render() {
  const value = cls();
  const cssClass = value > 0.1 ? 'cls-big' : 'cls-ok';
  const excludedTotal = allShifts.filter(s => s.excluded).reduce((a, s) => a + s.value, 0);

  windowsEl.innerHTML =
    `<b class="${cssClass}">CLS ${value.toFixed(4)}</b>` +
    `  ${value > 0.25 ? '← POOR' : value > 0.1 ? '← needs improvement' : '← good'}` +
    `   ·   ${allShifts.length} shifts recorded in ${windows.length} session window(s)` +
    (excludedTotal > 0
      ? `<br><span class="hint">${excludedTotal.toFixed(4)} of shift was EXCLUDED by hadRecentInput ` +
        `— invisible to CLS, still visible to the user</span>`
      : '') +
    (windows.length
      ? '<br>' + windows.map((w, i) =>
          `<span class="hint">window ${i + 1}: ${w.sum.toFixed(4)} over ${w.count} shifts, ` +
          `${((w.lastAt - w.firstAt) / 1000).toFixed(1)}s span` +
          `${w.sum === value ? '  ← this one IS your CLS' : ''}</span>`).join('<br>')
      : '');

  shiftsEl.innerHTML = allShifts.length
    ? allShifts.slice(-40).reverse().map(s =>
        `<div class="${s.excluded ? 'excluded' : ''}">` +
        `<b>${s.value.toFixed(4)}</b> at ${s.at.toFixed(0)}ms` +
        `${s.excluded ? '  [EXCLUDED — hadRecentInput]' : ''}<br>` +
        s.sources.map(src =>
          `    ${src.selector}<br>      ${src.from} → ${src.to}  (moved ${Math.round(src.moved)}px)`
        ).join('<br>') +
        '</div>').join('<hr style="border:0;border-top:1px solid #1c1c26;margin:6px 0">')
    : 'no shifts recorded yet';
}

try {
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) addShift(entry);
  }).observe({ type: 'layout-shift', buffered: true });
} catch (err) {
  windowsEl.textContent = 'layout-shift entries unavailable in this browser — use Chrome for this lab.';
  console.warn('[lab18]', err);
}

// ---------------------------------------------------------------------------
// A locally-generated image, so source 3 works offline and the "late arrival" is real
// rather than simulated with a data URI that decodes instantly.
// ---------------------------------------------------------------------------
function makeImageURL(w = 1200, h = 700) {
  return new Promise(resolve => {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#4b2a7a'); grad.addColorStop(1, '#1e5a6b');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff22';
    for (let i = 0; i < 300; i++) {
      ctx.fillRect((i * 137) % w, (i * 311) % h, 40, 40);
    }
    canvas.toBlob(blob => resolve(URL.createObjectURL(blob)), 'image/png');
  });
}

// ---------------------------------------------------------------------------
// the eight sources
// ---------------------------------------------------------------------------
const SOURCES = {
  // 1 — a promo bar inserted above all existing content, 1s in.
  injectBanner() {
    setTimeout(() => {
      const slot = document.getElementById('banner-slot');
      if (slot.firstChild) return;
      const banner = document.createElement('div');
      banner.id = 'banner';
      banner.textContent = '🎉 New: everything below just moved down by this element\'s height.';
      slot.appendChild(banner);
    }, 1000);
  },

  // 2 — a placeholder that lies about its size.
  asyncContent() {
    const slot = document.getElementById('async-slot');
    slot.innerHTML = '<div class="placeholder">loading… (60px placeholder, 240px content)</div>';
    setTimeout(() => {
      slot.innerHTML = '<div class="real"><strong>Loaded content</strong><br>' +
        'This block is 240px tall. The skeleton was 60px. A skeleton with the wrong size is ' +
        'worse than no skeleton, because you shipped the machinery and kept the shift.' +
        '<br><br>'.repeat(4) + '</div>';
    }, 900);
  },

  // 3 — an image with no dimensions, arriving late.
  async lateImage() {
    const slot = document.getElementById('late-image');
    slot.innerHTML = '';
    const img = document.createElement('img');
    img.alt = 'late-loading image with no reserved space';
    slot.appendChild(img);                       // occupies 0 height right now
    const url = await makeImageURL();
    setTimeout(() => { img.src = url; }, 700);   // …then jumps to its intrinsic ratio
  },

  // 4 — the web font swap. Nothing "appears"; every line of text is remeasured.
  fontSwap() {
    const prose = document.getElementById('prose');
    prose.classList.remove('webfont');
    // Force the fallback to be laid out first, then swap, so the shift is observable
    // even after the font is already cached.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.fonts.load('400 17px Newsreader').then(() => prose.classList.add('webfont'));
    }));
  },

  // 5 — an embed with no reserved height, which then resizes itself to fit.
  embedIframe() {
    const slot = document.getElementById('embed');
    slot.innerHTML = '';
    setTimeout(() => {
      const frame = document.createElement('iframe');
      frame.title = 'embed with no reserved space';
      frame.srcdoc = '<body style="margin:0;background:#14141d;color:#9a9ab0;' +
        'font:13px system-ui;padding:12px">Embedded content. In a moment I will tell the ' +
        'parent to resize me, and everything below will move again.</body>';
      slot.appendChild(frame);                   // default iframe height: 150px
      setTimeout(() => { frame.style.height = '340px'; }, 600);   // the "resize to fit" message
    }, 500);
  },

  // 6 — prepending to a list the user is reading.
  prependItems() {
    const feed = document.getElementById('feed');
    if (!feed.children.length) {
      for (let i = 0; i < 8; i++) {
        const li = document.createElement('li');
        li.textContent = `existing item ${i} — note where this one sits before you prepend`;
        feed.appendChild(li);
      }
      return;
    }
    for (let i = 0; i < 3; i++) {
      const li = document.createElement('li');
      li.textContent = `⬆ NEW item ${Date.now() % 10000} — pushed everything you were reading down`;
      feed.prepend(li);
    }
  },

  // 7 — animates `height` on click. Scores ~0.00 thanks to hadRecentInput. Still bad.
  accordion() {
    document.querySelector('#accordion .panel').classList.toggle('open');
  },

  // 8 — the document grows past the viewport, the scrollbar appears, content narrows.
  scrollbar() {
    const grow = document.getElementById('grow');
    grow.style.height = grow.style.height === '3000px' ? '0px' : '3000px';
  },
};

// ---------------------------------------------------------------------------
// YOUR FIXES — same eight features, zero shift.
//
// Each one must keep the feature working and looking substantially the same. Removing the
// banner is not fixing the banner. The brief for each is in the TODO block at the bottom
// and in README.md.
// ---------------------------------------------------------------------------
const FIXES = {
  injectBanner() {
    throw new Error('TODO: fixInjectBanner() — reserve space, or render it as a fixed overlay');
  },
  asyncContent() {
    throw new Error('TODO: fixAsyncContent() — a skeleton whose size actually matches');
  },
  lateImage() {
    throw new Error('TODO: fixLateImage() — width/height + aspect-ratio, then the unknown-dimensions case');
  },
  fontSwap() {
    throw new Error('TODO: fixFontSwap() — preload + metric-matched fallback. Get to exactly zero');
  },
  embedIframe() {
    throw new Error('TODO: fixEmbedIframe() — aspect-ratio reservation, no second shift on resize');
  },
  prependItems() {
    throw new Error('TODO: fixPrependItems() — new items available without moving what is being read');
  },
  accordion() {
    throw new Error('TODO: fixAccordion() — no shift at all, even though it already scored 0.00');
  },
  scrollbar() {
    throw new Error('TODO: fixScrollbar() — scrollbar-gutter, and say what it costs visually');
  },
};

// ---------------------------------------------------------------------------
// wiring
// ---------------------------------------------------------------------------
let mode = 'broken';

/** Run a source in whichever mode is active, surfacing TODOs in the readout. */
function trigger(key) {
  const impl = mode === 'fixed' ? FIXES[key] : SOURCES[key];
  try {
    impl();
  } catch (err) {
    windowsEl.innerHTML = `<b class="cls-big">${mode} mode</b> — ${err.message}`;
    console.warn(err);
  }
}

document.addEventListener('click', e => {
  const key = e.target.closest('button[data-source]')?.dataset.source;
  if (!key) return;
  trigger(key);
});

document.getElementById('accordion-toggle').addEventListener('click', () => trigger('accordion'));

function setMode(next) {
  mode = next;
  document.getElementById('mode-broken').setAttribute('aria-pressed', String(mode === 'broken'));
  document.getElementById('mode-fixed').setAttribute('aria-pressed', String(mode === 'fixed'));
  resetPage();
  windowsEl.innerHTML = `<b>${mode} mode</b> — page and measurements reset. ` +
    `CLS only accumulates, so always reset before comparing.`;
}
document.getElementById('mode-broken').addEventListener('click', () => setMode('broken'));
document.getElementById('mode-fixed').addEventListener('click', () => setMode('fixed'));

document.getElementById('all').addEventListener('click', () => {
  // Staggered by more than 1s apart on purpose, so you can watch SEPARATE session windows
  // form. Then re-run them close together and watch one window swallow them all — that
  // difference is the session-window rule made visible.
  const keys = ['injectBanner', 'asyncContent', 'lateImage', 'fontSwap', 'embedIframe',
                'prependItems', 'scrollbar'];
  keys.forEach((key, i) => setTimeout(() => trigger(key), i * 1400));
});

function resetPage() {
  allShifts.length = 0;
  windows = [];
  document.getElementById('banner-slot').innerHTML = '';
  document.getElementById('async-slot').innerHTML =
    '<div class="placeholder">loading… (this placeholder is 60px; the real content is 240px)</div>';
  document.getElementById('late-image').innerHTML = '';
  document.getElementById('embed').innerHTML = '';
  document.getElementById('feed').innerHTML = '';
  document.getElementById('prose').classList.remove('webfont');
  document.querySelector('#accordion .panel').classList.remove('open');
  document.getElementById('grow').style.height = '0px';
  PerfHUD.reset();
  render();
}

document.getElementById('reset').addEventListener('click', () => {
  resetPage();
  windowsEl.innerHTML = `<b>${mode} mode</b> — reset`;
});

SOURCES.prependItems();     // seed the feed so source 6 has something to push down
render();

// ---------------------------------------------------------------------------
// TODO — the fixes. Implement each in the FIXES object above, then toggle to "fixed" mode
// and re-measure. Reset between runs: CLS only accumulates.
//
// [ ] 1. FIXES.injectBanner  — two versions: reserved space, and a fixed overlay.
//        Which would you ship for a cookie notice? For a persistent nav banner? Why?
//        score before: ______  after: ______
//
// [ ] 2. fixAsyncContent()   — a skeleton whose size MATCHES. Then solve the honest case
//        where the height is genuinely unknown in advance. Least-bad option, and defend it.
//
// [ ] 3. fixLateImage()      — width/height + aspect-ratio. Then: a user-uploaded image whose
//        dimensions you don't know server-side. Solve that too.
//
// [ ] 4. fixFontSwap()       — preload the woff2, compare font-display: swap vs optional, and
//        add a metric-matched @font-face fallback (size-adjust / ascent-override /
//        descent-override). Compute the values from the font's real metrics; show your working.
//        Zero shift is achievable here. Get to zero.
//
// [ ] 5. fixEmbedIframe()    — aspect-ratio reservation, and handle the resize-after-load
//        without a second shift.
//
// [ ] 6. fixPrependItems()   — new items available without moving what's being read. Explain
//        how `overflow-anchor` interacts with whatever you choose.
//
// [ ] 7. fixAccordion()      — no shift at all, even though it already scored 0.00.
//        This is the "fix the experience, not the metric" one. Reuse Lab 03.
//
// [ ] 8. fixScrollbar()      — scrollbar-gutter: stable. Then say what it costs visually and
//        whether it's the right default for this layout.
//
// [ ] 9. THE TRADE-OFF AUDIT — the most valuable item here.
//        Apply your Lab 13 critical-CSS fix and your Lab 05 content-visibility fix to this
//        page and measure CLS. If either made CLS worse, resolve it, then write down the
//        two-way trade in each case:
//          font-display: swap        → better ______, worse ______
//          content-visibility: auto  → better ______, worse ______
// ---------------------------------------------------------------------------
