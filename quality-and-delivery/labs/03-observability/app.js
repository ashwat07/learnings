// Lab 03 — Observability: the client half.
//
// Four listeners catch almost everything. The interesting part is what you attach to each report.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
const captured = [];

// Context that belongs on EVERY report. Without release and route, a report is trivia.
const context = () => ({
  release: '2026.08.18-abc1234',        // injected at build time; the single most important field
  route: location.pathname,
  sessionId: (sessionStorage.sessionId ??= crypto.randomUUID().slice(0, 8)),
  userAgent: navigator.userAgent.slice(0, 60),
  viewport: `${innerWidth}×${innerHeight}`,
  connection: navigator.connection?.effectiveType ?? 'unknown',
  at: new Date().toISOString().slice(11, 23),
});

const record = (kind, detail, extra = {}) => {
  captured.push({ kind, detail: String(detail).slice(0, 90), ...context(), ...extra });
  log.bad(`${kind}: ${String(detail).slice(0, 60)}`);
  show();
};

// 1. Synchronous errors anywhere on the page.
addEventListener('error', (e) => {
  // The SAME event fires for failed resource loads, distinguished by the target.
  if (e.target !== window && e.target?.tagName) {
    return record('resource error', `${e.target.tagName} failed: ${(e.target.src || e.target.href || '').slice(0, 50)}`);
  }
  record('error', e.message, { source: `${e.filename?.split('/').pop()}:${e.lineno}:${e.colno}` });
}, true);                              // CAPTURE phase — resource errors do not bubble

// 2. Promise rejections nobody handled. On most SPAs this is the majority of real errors.
addEventListener('unhandledrejection', (e) => record('unhandled rejection', e.reason?.message ?? e.reason));

// 3. CSP violations (security-and-auth lab 02).
addEventListener('securitypolicyviolation', (e) => record('csp', `${e.effectiveDirective} blocked ${e.blockedURI}`));

// 4. Failed API calls — wrap fetch once, centrally.
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const t0 = performance.now();
  try {
    const r = await realFetch(input, init);
    if (!r.ok) record('http error', `${r.status} ${String(input).slice(0, 40)}`, { ms: Math.round(performance.now() - t0) });
    return r;
  } catch (err) {
    record('network error', `${err.message} ${String(input).slice(0, 40)}`, { ms: Math.round(performance.now() - t0) });
    throw err;
  }
};

function show() {
  renderTable('#results', captured.slice(-10).map((c) => ({
    at: c.at, kind: c.kind, detail: c.detail, route: c.route, release: c.release, session: c.sessionId,
  })), { columns: ['at', 'kind', 'detail', 'route', 'release', 'session'] });
}

on('e-sync', () => { setTimeout(() => { throw new Error('a synchronous error from a timer'); }, 0); });
on('e-async', () => { Promise.reject(new Error('nobody caught this promise')); });
on('e-resource', () => { const img = new Image(); img.src = '/does-not-exist.png'; document.body.append(img); });
on('e-fetch', () => { fetch('/api/asset?name=obs&status=503').catch(() => {}); });
on('e-csp', () => { location.search = '?csp=' + encodeURIComponent("script-src 'self'"); });

on('show', () => {
  show();
  out.textContent =
    'FOUR LISTENERS CATCH ALMOST EVERYTHING, and three of them are one line each:\n\n' +
    "  addEventListener('error', handler, true)      // note the CAPTURE flag\n" +
    "  addEventListener('unhandledrejection', handler)\n" +
    "  addEventListener('securitypolicyviolation', handler)\n" +
    '  a fetch wrapper, once, centrally\n\n' +
    'Two details that are easy to get wrong:\n' +
    '  · THE CAPTURE FLAG. Resource load failures (a broken image, a 404 script, a failed CSS file)\n' +
    '    fire an error event that DOES NOT BUBBLE. Without capture: true you never see them — and\n' +
    '    "the CDN dropped a chunk" is a real and common outage.\n' +
    '  · UNHANDLED REJECTIONS ARE THE MAJORITY. In an async codebase most errors are rejected\n' +
    '    promises, not thrown exceptions. A monitoring setup that only listens for "error" misses\n' +
    '    most of what actually happens.\n\n' +
    'And note what a React error boundary does NOT cover (resilience lab 01): event handlers, async\n' +
    'work, and anything outside React. These listeners are the floor underneath it, not a\n' +
    'replacement.';
});

on('fields', () => {
  renderTable('#results', [
    { field: 'release / build id', why: 'THE most important field. Half of all investigations end here.' },
    { field: 'route (the PATTERN, not the URL)', why: '/orders/:id, so you can group. Raw URLs never aggregate.' },
    { field: 'user/session id', why: 'to see the whole session, and to count AFFECTED USERS not events' },
    { field: 'error type + message + stack', why: 'obviously — but the stack is useless without source maps' },
    { field: 'breadcrumbs', why: 'the last N actions, navigations, requests. The single most useful debugging field.' },
    { field: 'browser, OS, viewport, DPR', why: 'a bug on one engine looks like a bug everywhere until you check' },
    { field: 'connection type, device memory', why: 'errors cluster on slow devices and networks' },
    { field: 'a "handled" flag', why: 'so you can separate crashes from things you recovered from' },
    { field: 'a fingerprint / grouping key', why: 'or one bug becomes 40,000 unique issues' },
  ], { columns: ['field', 'why'] });
  out.textContent =
    'BREADCRUMBS ARE THE FIELD THAT TURNS A REPORT INTO A FIX. A stack trace tells you where it\n' +
    'exploded; breadcrumbs tell you what the user did to get there:\n\n' +
    '  navigate /orders → click "Refund" → POST /api/refund 500 → error\n\n' +
    'Record navigations, clicks on named elements, network calls with status, console warnings, and\n' +
    'state transitions. Cap the list (20–50), scrub anything sensitive, and attach it to every\n' +
    'report.\n\n' +
    'COUNT AFFECTED USERS, NOT EVENTS. One user in a retry loop can generate 50,000 events and look\n' +
    'like an emergency; a bug hitting 3% of checkouts generates fewer events and IS one. Every\n' +
    'dashboard should default to users, not occurrences.\n\n' +
    'And GROUPING is what makes the tool usable at all: if every report is unique (because the\n' +
    'message contains an id, or the stack contains a hash), you have a firehose instead of a list.\n' +
    'Normalise messages and provide an explicit fingerprint where the default grouping is wrong.';
});

on('signals', () => {
  renderTable('#results', [
    { signal: 'errors', tells: 'something is broken', tool: 'Sentry / Rollbar / your own endpoint', gap: 'says nothing about slow-but-working' },
    { signal: 'RUM (Core Web Vitals)', tells: 'it is slow, and for whom', tool: 'web-vitals + your endpoint, or CrUX', gap: 'aggregate; needs attribution to be actionable' },
    { signal: 'traces', tells: 'WHERE the time went across services', tool: 'OpenTelemetry, propagated from the browser', gap: 'the client half is usually missing' },
    { signal: 'product analytics', tells: 'whether people can complete the task', tool: 'your funnel', gap: 'lagging, and rarely joined to the other three' },
  ], { columns: ['signal', 'tells', 'tool', 'gap'] });
  out.textContent =
    'THE MISSING LINK IN MOST SETUPS IS THE FOURTH ROW JOINED TO THE FIRST THREE. Errors go to one\n' +
    'tool, performance to another, funnels to a third, and nobody can answer "did the checkout\n' +
    'conversion drop because of that error, or because the page got slower?"\n\n' +
    'The cheapest fix is a SHARED CORRELATION ID. Generate a session id in the browser, attach it to\n' +
    'every error, every RUM beacon, every analytics event, and every outgoing request header. Now\n' +
    'the three tools can be joined, even if they are three different vendors.\n\n' +
    'Distributed tracing extends the same idea across services: propagate a traceparent header from\n' +
    'the browser and your backend spans hang off the same trace as the click that caused them. The\n' +
    'client half is what almost nobody does, and it is the half that explains "the API is fast but\n' +
    'the page is slow".\n\n' +
    'And SAMPLE DELIBERATELY: 100% of errors (they are rare and each one matters), a percentage of\n' +
    'RUM beacons (they are constant), and 100% of anything on a critical flow. Sampling decisions\n' +
    'made by cost alone tend to drop exactly the data you later need.';
});

on('sourcemaps', () => {
  out.textContent =
    'A MINIFIED STACK TRACE IS NOISE:\n\n' +
    '  TypeError: r is not a function\n' +
    '    at t (main.4f2a.js:1:48213)\n\n' +
    'Source maps fix it, and the deployment detail matters:\n\n' +
    '  1. GENERATE THEM IN PRODUCTION BUILDS (devtool: "source-map" — a real, separate file).\n' +
    '  2. UPLOAD THEM TO YOUR ERROR TRACKER AT BUILD TIME, tagged with the release id.\n' +
    '  3. DO NOT SERVE THEM PUBLICLY. Either omit the //# sourceMappingURL comment, or serve the\n' +
    '     .map files only to authenticated requests. A public source map is your entire source code.\n' +
    '  4. TAG THE RELEASE EVERYWHERE: the same id in the bundle, the source map upload, the error\n' +
    '     report, and your deploy annotation.\n\n' +
    'That last point is what makes "which deploy caused this?" a five-second question instead of an\n' +
    'afternoon. Annotate your dashboards with deploys, and the correlation is usually visible\n' +
    'without any analysis at all.\n\n' +
    'One more that is invisible until it bites: DEPLOYS THEMSELVES CAUSE ERRORS. A spike of\n' +
    'ChunkLoadError right after a release is not a new bug, it is version skew (offline-and-pwa lab\n' +
    '05). Tag those separately or they will drown your real signal every time you ship.';
});

on('clear', () => { captured.length = 0; log.clear(); $('#results').textContent = ''; });
