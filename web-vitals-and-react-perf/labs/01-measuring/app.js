// Lab 01 — Measuring the vitals.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';
import { vitals, onVitals, vitalsHud, rate } from '/shared/vitals.js';

const log = new Log('#log');
const out = $('out');
vitalsHud();

onVitals((v) => {
  renderTable('#results', [
    { metric: 'TTFB', value: v.TTFB == null ? '—' : `${Math.round(v.TTFB)}ms`, verdict: rate('TTFB', v.TTFB), counts: 'server response start, from the navigation entry' },
    { metric: 'FCP', value: v.FCP == null ? '—' : `${Math.round(v.FCP)}ms`, verdict: rate('FCP', v.FCP), counts: 'first pixel of DOM content' },
    { metric: 'LCP', value: v.LCP == null ? '—' : `${Math.round(v.LCP)}ms`, verdict: rate('LCP', v.LCP), counts: `largest element so far: ${v.lcpElement ?? '—'}` },
    { metric: 'CLS', value: v.CLS.toFixed(3), verdict: rate('CLS', v.CLS), counts: 'largest 5s window of unexpected shift' },
    { metric: 'INP', value: v.INP == null ? '—' : `${Math.round(v.INP)}ms`, verdict: rate('INP', v.INP), counts: `${v.interactions.length} interaction(s) recorded` },
  ].map((r) => ({ ...r, _verdictClass: r.verdict === 'good' ? 'ok' : r.verdict === 'poor' ? 'no' : 'meh' })),
  { columns: ['metric', 'value', 'verdict', 'counts'] });
});

on('interact', () => {
  log.head('clicked — LCP is now frozen at ' + Math.round(vitals.LCP ?? 0) + 'ms');
  out.textContent =
    'LCP stopped updating. That is specified behaviour, not a bug in the measurement.\n\n' +
    'Once the user has interacted, anything that appears afterwards is a RESPONSE to them rather\n' +
    'than page load. The consequence is one you will meet in real data: a user who clicks early\n' +
    'produces a LOWER LCP than one who waits, on the same page. Field LCP is a distribution over\n' +
    'user behaviour, not a property of your HTML.\n\n' +
    'Practical readings:\n' +
    '  · Lab tools (Lighthouse) never interact, so they see the true final LCP. Field data may be\n' +
    '    better than lab data for exactly this reason, and that is not cheating.\n' +
    '  · A page that is unusable until late can still post a decent LCP if users click through the\n' +
    '    skeleton. Which is why INP matters alongside it.';
});

on('shift', () => {
  const banner = document.createElement('div');
  banner.className = 'panel';
  banner.style.cssText = 'background:#3b2a10;padding:20px;margin:0 0 12px';
  banner.textContent = 'We use cookies! (injected at the top of the document, pushing everything down)';
  document.body.prepend(banner);
  setTimeout(() => {
    renderTable('#detail', vitals.clsSources.map((s) => ({
      shifted: s.node, by: s.value.toFixed(4), from: s.from, to: s.to,
    })), { columns: ['shifted', 'by', 'from', 'to'] });
    log.bad(`CLS is now ${vitals.CLS.toFixed(4)}`);
    out.textContent =
      'The layout-shift entries name the NODES THAT MOVED, with their before and after rectangles.\n' +
      'That table is the whole debugging technique — you are looking for what appeared ABOVE the\n' +
      'thing that moved, not at the thing that moved.\n\n' +
      'Note also what did not count: shifts within 500ms of a user input are flagged hadRecentInput\n' +
      'and excluded, because a layout change you asked for is not "unexpected". Opening an accordion\n' +
      'is free; a banner arriving on its own is not.';
  }, 100);
});

on('slow', () => {
  const end = performance.now() + 300;
  while (performance.now() < end) { /* the handler is the problem */ }
  setTimeout(() => {
    renderTable('#detail', vitals.interactions.map((i) => ({
      event: i.name, target: i.target, total: `${Math.round(i.duration)}ms`,
      inputDelay: `${Math.round(i.inputDelay)}ms`,
      processing: `${Math.round(i.processing)}ms`,
      presentation: `${Math.round(i.presentation)}ms`,
    })), { columns: ['event', 'target', 'total', 'inputDelay', 'processing', 'presentation'] });
    log.bad(`INP is now ${Math.round(vitals.INP)}ms`);
    out.textContent =
      'INP is broken into three phases, and knowing which one is large tells you what to fix:\n\n' +
      '  INPUT DELAY   the main thread was busy when the user touched the screen. Your handler had\n' +
      '                not started yet. Fix: less work at that moment — a long task, a third-party\n' +
      '                script, hydration.\n' +
      '  PROCESSING    your event handlers. Fix: do less, or yield.\n' +
      '  PRESENTATION  the time from your handler finishing to the pixels changing: style, layout,\n' +
      '                paint, composite. Fix: smaller DOM, cheaper CSS, fewer synchronous reads.\n\n' +
      'Most people optimise only PROCESSING, which on real sites is frequently the smallest of the\n' +
      'three. Measure before you assume — lab 04 makes each phase dominate in turn.';
  }, 200);
});

on('explain', () => {
  renderTable('#detail', [
    { metric: 'LCP', starts: 'navigation start', stops: 'render of the largest text block or image', gotcha: 'updates until the first interaction; background images in CSS count only via url() on the element' },
    { metric: 'CLS', starts: 'always on', stops: 'never (it is a running maximum)', gotcha: 'the largest 5s SESSION WINDOW, not the sum; shifts within 500ms of input are excluded' },
    { metric: 'INP', starts: 'user input', stops: 'the NEXT PAINT after the handlers', gotcha: 'the ~98th percentile interaction of the visit, not the worst; needs interactionId grouping' },
    { metric: 'TTFB', starts: 'navigation start', stops: 'first byte of the response', gotcha: 'includes redirects, DNS, TLS — a redirect chain shows up here, not in "server time"' },
    { metric: 'FCP', starts: 'navigation start', stops: 'first text or image painted', gotcha: 'a spinner counts. FCP good + LCP bad is the signature of a skeleton screen' },
  ], { columns: ['metric', 'starts', 'stops', 'gotcha'] });
  out.textContent =
    'Two combinations worth recognising instantly:\n\n' +
    '  FCP fast, LCP slow   → you are painting a skeleton and the content arrives much later. The\n' +
    '                         user sees "something", which is worth something, but the metric is\n' +
    '                         honest that the page is not ready.\n' +
    '  LCP fast, INP slow   → server-rendered content that is not yet interactive. This is the\n' +
    '                         hydration uncanny valley, measured. See hydration-strategies lab 01.';
});

on('field', () => {
  renderTable('#detail', [
    { source: 'CrUX / field data', is: 'real users, 28-day rolling p75', good: 'the truth; what Search uses', bad: 'slow, coarse, no attribution' },
    { source: 'RUM (your own beacon)', is: 'real users, your dimensions', good: 'attribution, per-route, per-device', bad: 'you have to build and pay for it' },
    { source: 'Lighthouse / PSI lab', is: 'one simulated load', good: 'reproducible, diagnostic', bad: 'never interacts, so INP is estimated (TBT) not measured' },
    { source: 'DevTools Performance panel', is: 'one profiled load on your machine', good: 'causality — you can see the long task', bad: 'your machine is not your users' },
  ], { columns: ['source', 'is', 'good', 'bad'] });
  out.textContent =
    'The rule: LAB TOOLS FIND CAUSES, FIELD TOOLS SET PRIORITIES.\n\n' +
    'You cannot get INP from Lighthouse, because Lighthouse never interacts — it reports TOTAL\n' +
    'BLOCKING TIME instead, which correlates with INP but is not it. And you cannot debug a field\n' +
    'p75 directly, because it is an aggregate over devices you do not have.\n\n' +
    'So the loop is: field data tells you WHICH page and WHICH metric; you reproduce it in the lab\n' +
    'with the throttling that matches the device class; you fix it; you confirm in the field 28\n' +
    'days later. The last step is the one teams skip, and it is the only one that counts.\n\n' +
    'When you build the RUM beacon (lab 06), send the ATTRIBUTION, not just the number: the LCP\n' +
    'element selector, the CLS source node, the INP target and phase breakdown. A dashboard of\n' +
    'numbers with no attribution generates meetings; a dashboard with attribution generates fixes.';
});
