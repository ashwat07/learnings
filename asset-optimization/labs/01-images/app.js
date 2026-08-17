// Lab 01 — Images: formats & sizes.

import { $, on, Log, renderTable, fmt } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
const BASE = '/asset-optimization/images';

async function head(url) {
  const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
  if (!res.ok) return null;
  return { bytes: Number(res.headers.get('content-length') || 0), type: res.headers.get('content-type') };
}

on('formats', async () => {
  log.head('— the same 1200×675 image, every format this machine can produce —');
  const formats = [
    ['bmp', 'uncompressed — the raw pixel count'],
    ['png', 'lossless; excellent for flat colour and line art'],
    ['jpg', 'lossy; the baseline for photographs since 1992'],
    ['webp', 'lossy or lossless; ~25–35% smaller than JPEG'],
    ['avif', 'lossy; ~50% smaller than JPEG, slower to encode'],
  ];
  const rows = [];
  let baseline = null;

  for (const [ext, note] of formats) {
    const info = await head(`${BASE}/hero-1200.${ext}`);
    if (!info) {
      rows.push({ format: ext, bytes: '—', 'vs uncompressed': '—', 'vs JPEG': '—',
        note: 'not generated — no encoder on this machine' });
      continue;
    }
    if (ext === 'bmp') baseline = info.bytes;
    rows.push({
      format: ext,
      bytes: fmt.bytes(info.bytes),
      'vs uncompressed': baseline ? `${((info.bytes / baseline) * 100).toFixed(1)}%` : '—',
      'vs JPEG': '',
      note,
      _bytesClass: info.bytes < 100000 ? 'ok' : info.bytes > 500000 ? 'no' : 'meh',
    });
    log.line(`${ext.padEnd(5)} ${fmt.bytes(info.bytes).padStart(10)}`, 'macro');
  }

  const jpg = rows.find((r) => r.format === 'jpg');
  const jpgBytes = jpg && jpg.bytes !== '—' ? parseFloat(jpg.bytes) * (jpg.bytes.includes('MB') ? 1048576 : 1024) : null;
  if (jpgBytes) {
    for (const r of rows) {
      if (r.bytes === '—') continue;
      const b = parseFloat(r.bytes) * (r.bytes.includes('MB') ? 1048576 : 1024);
      r['vs JPEG'] = `${((b / jpgBytes) * 100).toFixed(0)}%`;
    }
  }
  renderTable('#results', rows, { columns: ['format', 'bytes', 'vs uncompressed', 'vs JPEG', 'note'] });

  out.textContent =
    'The uncompressed row is there to make the scale legible: 1200 × 675 × 3 bytes is 2.3MB of\n' +
    'actual pixels, and every compressed format is a different bargain against that number.\n\n' +
    'What the ordering does NOT tell you: which format to use. That depends on the content.\n' +
    '  • photographs        → AVIF > WebP > JPEG\n' +
    '  • flat colour, text, screenshots, line art → PNG or WebP lossless; JPEG is terrible here\n' +
    '  • anything that can be drawn → SVG, which is usually smaller than all of them and scales\n' +
    '  • transparency       → WebP/AVIF/PNG (JPEG has none)\n' +
    '  • animation          → AVIF/WebP, never GIF (a GIF is often 10× a video of the same thing)\n\n' +
    'Ship modern formats with a fallback, and let the browser choose:\n\n' +
    '    <picture>\n' +
    '      <source type="image/avif" srcset="hero.avif">\n' +
    '      <source type="image/webp" srcset="hero.webp">\n' +
    '      <img src="hero.jpg" width="1200" height="675" alt="…">\n' +
    '    </picture>\n\n' +
    'Order matters: the browser takes the FIRST type it supports, so best format first.';
});

on('sizes', async () => {
  log.head('— the same format, four widths —');
  const rows = [];
  for (const w of [400, 800, 1200, 2000]) {
    const info = await head(`${BASE}/hero-${w}.png`);
    if (!info) continue;
    rows.push({
      width: `${w}px`,
      pixels: (w * Math.round(w * 0.5625)).toLocaleString(),
      bytes: fmt.bytes(info.bytes),
      'vs 400px': `${(info.bytes / (rows[0] ? parseFloat(rows[0].bytes) * 1024 : info.bytes)).toFixed(1)}×`,
    });
    log.line(`${String(w).padStart(4)}px ${fmt.bytes(info.bytes).padStart(10)}`, 'macro');
  }
  renderTable('#results', rows, { columns: ['width', 'pixels', 'bytes', 'vs 400px'] });

  out.textContent =
    'Bytes scale with PIXEL COUNT, which is quadratic in width: doubling the width quadruples the\n' +
    'pixels. That is why size is the bigger lever than format — going from 2000px to 800px saves\n' +
    'more than any format change, and it is usually free because nobody was seeing those pixels.\n\n' +
    'The sizes you need are set by your LAYOUT and by device pixel ratios, not by what the CMS\n' +
    'happened to receive. A slot that is 400 CSS px wide needs an 800px image for a 2× screen and\n' +
    'nothing bigger — a 2000px file there is 6× the bytes for zero visible difference.';
});

on('waste', async () => {
  log.head('— what the wrong size costs —');
  const slots = [
    { slot: 'thumbnail, 160px wide', needed: 320, shipped: 2000 },
    { slot: 'card image, 400px wide', needed: 800, shipped: 2000 },
    { slot: 'hero, 900px wide', needed: 1200, shipped: 2000 },
  ];
  const sizes = {};
  for (const w of [400, 800, 1200, 2000]) {
    const info = await head(`${BASE}/hero-${w}.png`);
    if (info) sizes[w] = info.bytes;
  }
  const nearest = (w) => sizes[[400, 800, 1200, 2000].reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a))];

  const rows = slots.map((s) => {
    const need = nearest(s.needed), got = sizes[s.shipped];
    return {
      slot: s.slot,
      'needs (2× DPR)': `${s.needed}px · ${fmt.bytes(need)}`,
      'often shipped': `${s.shipped}px · ${fmt.bytes(got)}`,
      wasted: fmt.bytes(got - need),
      'times too big': `${(got / need).toFixed(1)}×`,
      _wastedClass: got / need > 3 ? 'no' : 'meh',
    };
  });
  renderTable('#results', rows, { columns: ['slot', 'needs (2× DPR)', 'often shipped', 'wasted', 'times too big'] });

  out.textContent =
    'This is the single most common image mistake, and it is invisible in review because the page\n' +
    'looks right — the browser scales the image down and nobody can see the waste.\n\n' +
    'Two ways to find it on a real site:\n' +
    '  • Lighthouse: "Properly size images" reports intrinsic vs displayed size per image\n' +
    '  • in the console: for every <img>, compare naturalWidth against clientWidth × devicePixelRatio\n\n' +
    '    [...document.images].map(i => ({ src: i.currentSrc.split("/").pop(),\n' +
    '      natural: i.naturalWidth, needed: i.clientWidth * devicePixelRatio }))\n' +
    '        .filter(i => i.natural > i.needed * 1.5)\n\n' +
    'Paste that into any site you work on. It is usually a long list.';
});

on('picked', async () => {
  $('#frame').className = `frame ${$('width').value === '380' ? 'narrow' : ''}`;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const img = $('#hero');
  const entry = performance.getEntriesByType('resource').filter((e) => e.name === img.currentSrc).at(-1);

  renderTable('#results', [{
    'container width': `${img.clientWidth}px`,
    devicePixelRatio: window.devicePixelRatio,
    'needed pixels': `${Math.round(img.clientWidth * window.devicePixelRatio)}px`,
    'browser picked': img.currentSrc.split('/').pop(),
    'intrinsic width': img.naturalWidth,
    transferred: entry ? fmt.bytes(entry.transferSize || entry.encodedBodySize) : '(cached)',
  }], { columns: ['container width', 'devicePixelRatio', 'needed pixels', 'browser picked', 'intrinsic width', 'transferred'] });

  log.line(`picked ${img.currentSrc.split('/').pop()} for a ${img.clientWidth}px slot at ${window.devicePixelRatio}× DPR`, 'good');

  out.textContent =
    'currentSrc is the only reliable way to check a srcset — it tells you what the browser ACTUALLY\n' +
    'chose, after applying sizes, DPR, network conditions and its own heuristics.\n\n' +
    'The two attributes, precisely:\n' +
    '  srcset  a menu of candidates with their INTRINSIC widths ("hero-800.png 800w")\n' +
    '  sizes   how wide the image will BE, in CSS pixels, per media condition\n\n' +
    'The browser computes needed = sizes-width × DPR and picks the smallest candidate that is at\n' +
    'least that wide. Which means:\n' +
    '  • a wrong `sizes` silently defeats the whole mechanism. `sizes="100vw"` on an image that is\n' +
    '    actually 400px wide makes the browser download the 2000px file on a desktop\n' +
    '  • `sizes` must be known BEFORE layout, which is why it is a media query and not a CSS value.\n' +
    '    Newer browsers support sizes="auto" for lazy-loaded images, which fixes this properly\n' +
    '  • width and height attributes are still required — they reserve the space (lab 02)';
});

on('clear', () => { log.clear(); $('#results').textContent = ''; });
