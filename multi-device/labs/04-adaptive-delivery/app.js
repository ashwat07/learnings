// Lab 04 — Adaptive delivery.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

on('signals', () => {
  const c = navigator.connection ?? {};
  renderTable('#results', [
    { signal: 'navigator.hardwareConcurrency', value: navigator.hardwareConcurrency ?? '—', caveat: 'logical cores; says nothing about their speed' },
    { signal: 'navigator.deviceMemory', value: navigator.deviceMemory ?? '—', caveat: 'GB, rounded DOWN to a power of 2 and capped at 8' },
    { signal: 'connection.effectiveType', value: c.effectiveType ?? '—', caveat: 'an estimate from recent throughput and RTT, not the radio type' },
    { signal: 'connection.downlink', value: c.downlink ?? '—', caveat: 'Mbps estimate, heavily smoothed' },
    { signal: 'connection.rtt', value: c.rtt ?? '—', caveat: 'ms, rounded' },
    { signal: 'connection.saveData', value: String(c.saveData ?? '—'), caveat: 'the user explicitly asked for less — respect it' },
    { signal: 'devicePixelRatio', value: devicePixelRatio, caveat: 'fill cost scales with its square' },
    { signal: 'prefers-reduced-data', value: matchMedia('(prefers-reduced-data: reduce)').matches, caveat: 'the CSS equivalent of saveData' },
  ], { columns: ['signal', 'value', 'caveat'] });
  out.textContent =
    'None of these is precise, all of them are limited (Chromium-only for several), and together\n' +
    'they are still far better than guessing from the user agent.\n\n' +
    'The one to act on unconditionally is SAVE-DATA. A user who has turned it on has explicitly told\n' +
    'you to send less — it is a request, not telemetry. Honour it: smaller images, no autoplay, no\n' +
    'prefetching, lower-fidelity fonts. It also arrives as a request header (Save-Data: on), so your\n' +
    'server or CDN can act on it before any JavaScript runs.\n\n' +
    'And note what deviceMemory actually reports: rounded DOWN to a power of two and capped at 8.\n' +
    'A 6GB phone reports 4. Treat it as three buckets (≤2 = weak, 4 = mid, ≥8 = fine), not a number.';
});

on('measure', async () => {
  // A measured signal beats a reported one. Two cheap probes: CPU work and frame rate.
  const t0 = performance.now();
  let x = 0;
  for (let i = 0; i < 3e6; i++) x += Math.sqrt(i);
  const cpuMs = performance.now() - t0;

  const frames = await new Promise((res) => {
    let n = 0; const start = performance.now();
    const tick = () => { n++; if (performance.now() - start < 500) requestAnimationFrame(tick); else res(n * 2); };
    requestAnimationFrame(tick);
  });

  const nav = performance.getEntriesByType('navigation')[0];
  renderTable('#results', [
    { probe: 'a 3M-iteration loop', value: `${cpuMs.toFixed(0)}ms`, reads: cpuMs < 20 ? 'fast' : cpuMs < 60 ? 'mid' : 'slow' },
    { probe: 'measured frame rate', value: `${frames} fps`, reads: frames > 90 ? 'high refresh' : frames > 50 ? 'normal' : 'struggling' },
    { probe: 'this page\'s TTFB', value: `${Math.round(nav?.responseStart ?? 0)}ms`, reads: 'your real network, not an estimate' },
    { probe: 'transfer vs decoded size', value: `${Math.round((nav?.transferSize ?? 0) / 1024)}KB / ${Math.round((nav?.decodedBodySize ?? 0) / 1024)}KB`, reads: 'compression working' },
  ], { columns: ['probe', 'value', 'reads'] });
  out.textContent =
    'A MEASURED SIGNAL BEATS A REPORTED ONE, and it works in every browser.\n\n' +
    'Two cheap probes:\n' +
    '  · a short CPU loop at startup — tens of milliseconds on a laptop, hundreds on a cheap phone\n' +
    '  · your own frame rate over half a second — which also tells you the refresh rate\n\n' +
    'And the best signal of all is your OWN PAST MEASUREMENTS: record the device class and the real\n' +
    'metrics in RUM, and you can make the decision from what actually happened to users like this\n' +
    'one rather than from a proxy.\n\n' +
    'Two warnings:\n' +
    '  · do not run an expensive probe on the critical path — you have made the slow device slower.\n' +
    '    Measure during idle, and store the result (localStorage) so subsequent visits skip it.\n' +
    '  · thermal throttling and background load mean a device is not one speed. Prefer ADAPTING\n' +
    '    CONTINUOUSLY (drop fidelity when frames drop) over classifying once at startup.';
});

on('strategies', () => {
  renderTable('#results', [
    { adapt: 'image resolution / format', how: 'srcset + a lower DPR cap under saveData', saves: 'the largest single win, usually' },
    { adapt: 'video autoplay', how: 'off under saveData or slow effectiveType', saves: 'megabytes, and battery' },
    { adapt: 'prefetching and speculation rules', how: 'off under saveData; conservative on 3g', saves: 'bandwidth the user did not ask to spend' },
    { adapt: 'animation fidelity', how: 'fewer particles, lower pixel ratio, simpler shaders', saves: 'frames on weak GPUs' },
    { adapt: 'list virtualization window', how: 'render fewer rows ahead on weak devices', saves: 'main-thread time' },
    { adapt: 'font loading', how: 'system stack under saveData; font-display: optional', saves: 'a render-blocking request' },
    { adapt: 'third-party scripts', how: 'defer or drop the non-essential ones on weak devices', saves: 'the biggest CPU cost on most sites' },
    { adapt: 'JS payload', how: 'a lighter route or fewer features — NOT a separate m-dot site', saves: 'parse and execute time' },
  ], { columns: ['adapt', 'how', 'saves'] });
  out.textContent =
    'Adapt FIDELITY, not FUNCTIONALITY. A user on a cheap phone on 3G wants the same features you\n' +
    'offer everyone else; they do not want your 4MB hero video. The distinction matters: reducing\n' +
    'image quality is service, removing the checkout button is discrimination.\n\n' +
    'The highest-leverage adaptations in practice, in order:\n' +
    '  1. THIRD-PARTY SCRIPTS. On most real sites they are the largest CPU cost and the least\n' +
    '     essential. Loading them conditionally is usually the single biggest win available.\n' +
    '  2. IMAGES. Cap the DPR, prefer AVIF/WebP, and use srcset properly (asset-optimization lab 02).\n' +
    '  3. PREFETCHING. Speculative loading is a gift on fibre and a tax on a metered connection.\n\n' +
    'Do the adaptation as far up the stack as you can. A CDN that varies on Save-Data serves a\n' +
    'smaller image with no JavaScript involved; a client-side decision has already paid for the\n' +
    'request. But remember Vary: Save-Data fragments your cache — measure the hit rate.';
});

on('ethics', () => {
  out.textContent =
    'THE LINE, and it is worth being explicit about it because it is easy to cross with good\n' +
    'intentions:\n\n' +
    'ADAPT FIDELITY, NEVER CAPABILITY.\n\n' +
    '  Fine:      a smaller image, no autoplay video, a system font, fewer particles, no prefetch,\n' +
    '             a simpler animation, a shorter list rendered ahead.\n' +
    '  Not fine:  fewer features, a cut-down "lite" site with less functionality, hidden content, a\n' +
    '             different price, or a worse experience that the user cannot opt out of.\n\n' +
    'The separate-mobile-site era ended for exactly this reason: the "lite" version was always\n' +
    'behind, always missing things, and the people on it were the ones who could least afford a\n' +
    'worse product.\n\n' +
    'Three more practical cautions:\n' +
    '  · NEVER TRAP THE USER IN A DECISION YOU MADE FOR THEM. If you downgrade something, offer a\n' +
    '    way back ("Load high quality").\n' +
    '  · THESE SIGNALS ARE ALSO FINGERPRINTING SURFACE. hardwareConcurrency + deviceMemory + DPR +\n' +
    '    fonts is a meaningful part of a device fingerprint, which is why browsers coarsen them and\n' +
    '    why Safari and Firefox do not implement several. Use them, do not log them.\n' +
    '  · TEST THE ADAPTED PATH. A degraded mode nobody runs is a degraded mode that is broken — the\n' +
    '    same point as the chaos lab in the resilience course.\n\n' +
    'And the honest baseline: THE BEST ADAPTATION IS BEING SMALL AND FAST FOR EVERYONE. A 100KB app\n' +
    'needs very little adaptive machinery. Reach for this course only after asset-optimization and\n' +
    'bundle-strategy.';
});
