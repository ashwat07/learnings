// Lab 11 — Image disaster.
// The page is the "broken" state. Your fixes go in index.html and here; the instrumentation
// below gives you LCP, CLS, transfer size, and decode counts without leaving the page.

PerfHUD.start();

const IMAGE_COUNT = 20;
const gallery = document.getElementById('gallery');
const out = document.getElementById('out');

const metrics = { lcp: null, lcpElement: '', cls: 0, shifts: 0, fcp: null };

// ---------------------------------------------------------------------------
// BROKEN — every image eager, full-size, no dimensions, no srcset, sync decode.
//
// TODO, one at a time, measuring after each (see README):
//   1. width/height attributes            → CLS
//   2. loading="lazy" + decoding="async"  → requests on first paint, decode time
//   3. srcset + sizes with generated variants → transferred bytes
//   4. <picture> with AVIF/WebP sources   → transferred bytes
//   5. LQIP placeholder                   → perceived speed (and check it did not steal LCP)
//   6. content-visibility on the figures  → decode/memory for off-screen images
// ---------------------------------------------------------------------------
function renderGallery() {
  const frag = document.createDocumentFragment();
  for (let i = 1; i <= IMAGE_COUNT; i++) {
    const name = `photo-${String(i).padStart(2, '0')}.bmp`;
    const fig = document.createElement('figure');
    const img = document.createElement('img');
    img.src = `images/${name}`;
    img.alt = `generated image ${i}`;
    // No width/height. No loading. No decoding. No srcset. All four are the exercise.
    const cap = document.createElement('figcaption');
    cap.textContent = name;
    fig.append(img, cap);
    frag.appendChild(fig);

    img.addEventListener('load', () => {
      cap.textContent = `${name} — ${img.naturalWidth}×${img.naturalHeight} intrinsic, ` +
        `${Math.round(img.getBoundingClientRect().width)}px displayed`;
    });
    img.addEventListener('error', () => { document.getElementById('setup').hidden = false; });
  }
  gallery.appendChild(frag);
}

// ---------------------------------------------------------------------------
// Instrumentation
// ---------------------------------------------------------------------------
try {
  new PerformanceObserver(list => {
    for (const e of list.getEntries()) if (e.name === 'first-contentful-paint') metrics.fcp = e.startTime;
    render();
  }).observe({ type: 'paint', buffered: true });

  new PerformanceObserver(list => {
    const last = list.getEntries().at(-1);
    metrics.lcp = last.startTime;
    metrics.lcpElement = last.element
      ? `<${last.element.tagName.toLowerCase()}${last.element.src ? ' ' + last.element.src.split('/').pop() : ''}>`
      : '?';
    render();
  }).observe({ type: 'largest-contentful-paint', buffered: true });

  new PerformanceObserver(list => {
    for (const e of list.getEntries()) {
      if (e.hadRecentInput) continue;      // shifts caused by user input don't count toward CLS
      metrics.cls += e.value;
      metrics.shifts++;
      for (const s of e.sources || []) {
        console.log(`[lab11] shift ${e.value.toFixed(4)} caused by`, s.node);
      }
    }
    render();
  }).observe({ type: 'layout-shift', buffered: true });
} catch (err) {
  console.warn('[lab11] some PerformanceObserver types unavailable', err);
}

function imageStats() {
  const entries = performance.getEntriesByType('resource')
    .filter(r => r.initiatorType === 'img' || /\.(bmp|jpe?g|png|webp|avif)$/i.test(r.name));
  const transferred = entries.reduce((a, r) => a + (r.transferSize || 0), 0);
  const decoded = entries.reduce((a, r) => a + (r.decodedBodySize || 0), 0);
  const imgs = [...document.images].filter(i => i.complete && i.naturalWidth);
  const bitmapBytes = imgs.reduce((a, i) => a + i.naturalWidth * i.naturalHeight * 4, 0);
  const wastedPixels = imgs.reduce((a, i) => {
    const shown = i.getBoundingClientRect().width * devicePixelRatio;
    const ratio = shown ? i.naturalWidth / shown : 1;
    return a + (ratio > 1 ? ratio : 0);
  }, 0) / (imgs.length || 1);
  return { count: entries.length, transferred, decoded, loaded: imgs.length, bitmapBytes, wastedPixels };
}

function render() {
  const s = imageStats();
  out.textContent = [
    `FCP: ${metrics.fcp ? metrics.fcp.toFixed(0) + 'ms' : '–'}    ` +
      `LCP: ${metrics.lcp ? metrics.lcp.toFixed(0) + 'ms' : '–'}  ${metrics.lcpElement}`,
    `CLS: ${metrics.cls.toFixed(4)} over ${metrics.shifts} shifts   ` +
      `${metrics.cls > 0.1 ? '← FAILING (target < 0.1)' : ''}`,
    '',
    `image requests: ${s.count}    transferred: ${(s.transferred / 1048576).toFixed(1)} MB` +
      `    on the wire (uncompressed): ${(s.decoded / 1048576).toFixed(1)} MB`,
    `images decoded: ${s.loaded}   estimated bitmap memory: ${(s.bitmapBytes / 1048576).toFixed(0)} MB`,
    `  ← compare that to the transferred bytes. THIS is why "properly size images" is a memory fix.`,
    `average linear oversize factor: ${s.wastedPixels.toFixed(1)}×  ` +
      `(you are downloading ~${(s.wastedPixels ** 2).toFixed(0)}× the pixels you display)`,
  ].join('\n');
}

setInterval(render, 1000);
renderGallery();
render();
