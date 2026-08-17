// Lab 01 — XSS & sanitization.
//
// The payload is rendered through five sinks in sandboxed iframes. A payload that executes posts
// a message to this page, which is how we detect it without an alert() you have to dismiss.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

const PAYLOADS = {
  'p-img': `<img src=x onerror="parent.postMessage('XSS EXECUTED','*')">`,
  'p-svg': `<svg onload="parent.postMessage('XSS EXECUTED','*')">`,
  'p-attr': `" onmouseover="parent.postMessage('XSS EXECUTED','*')" x="`,
  'p-js': `<a href="javascript:parent.postMessage('XSS EXECUTED','*')">click me</a>`,
  'p-rich': `<b>bold</b> and <i>italic</i> — legitimate rich text a CMS might produce`,
};

for (const [id, value] of Object.entries(PAYLOADS)) {
  on(id, () => { $('payload').value = value; });
}

const MODES = [
  ['raw', 'innerHTML with the input interpolated — the classic sink'],
  ['attr', 'interpolated into an HTML attribute'],
  ['escaped', 'HTML-escaped (&lt; &gt; &amp; &quot; &#39;)'],
  ['sanitized', 'allow-list sanitiser: known-good tags, all attributes dropped'],
  ['textnode', 'assigned to textContent — never parsed as HTML'],
];

const executed = new Set();
addEventListener('message', (e) => {
  if (e.data !== 'XSS EXECUTED') return;
  // Identify which frame it came from.
  for (const frame of document.querySelectorAll('iframe')) {
    if (frame.contentWindow === e.source) {
      executed.add(frame.dataset.mode);
      frame.style.borderColor = 'var(--bad)';
      log.bad(`EXECUTED in mode "${frame.dataset.mode}"`);
      render();
    }
  }
});

function render() {
  renderTable('#results', MODES.map(([mode, note]) => ({
    sink: mode,
    executed: executed.has(mode) ? 'YES — vulnerable' : 'no',
    what: note,
    _executedClass: executed.has(mode) ? 'no' : 'ok',
  })), { columns: ['sink', 'executed', 'what'] });
}

function renderFrames({ csp } = {}) {
  executed.clear();
  const input = encodeURIComponent($('payload').value);
  const box = $('#frames');
  box.textContent = '';
  for (const [mode, note] of MODES) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<div class="hint">${mode} — ${note}</div>`;
    const frame = document.createElement('iframe');
    frame.dataset.mode = mode;
    // allow-scripts so a successful XSS can actually run — otherwise the demo proves nothing.
    // Same-origin is NOT granted, so the payload cannot touch this page's DOM or storage.
    frame.sandbox = 'allow-scripts';
    frame.src = `/api/reflect?mode=${mode}&input=${input}` +
      (csp ? `&csp=${encodeURIComponent(csp)}` : '');
    wrap.append(frame);
    box.append(wrap);
  }
  render();
}

on('run', () => {
  log.head('— rendering the payload through five sinks —');
  renderFrames();
  setTimeout(() => {
    out.textContent =
      'Read the table. The pattern is always the same: a sink executed the payload because the\n' +
      'data reached a place where the browser expects CODE.\n\n' +
      '  raw       → innerHTML parses the string as HTML. <img onerror> runs.\n' +
      '  attr      → the payload closed the attribute and opened a new one. Quoting is not enough\n' +
      '              on its own; the ESCAPING has to be context-aware.\n' +
      '  escaped   → &lt; is text, so nothing is parsed as a tag. Safe for HTML text content.\n' +
      '  sanitized → tags allow-listed, ALL attributes dropped — which is what removes onerror,\n' +
      '              href="javascript:" and style. Rich text survives.\n' +
      '  textnode  → textContent never parses HTML at all. The safest sink, and the default in\n' +
      '              every framework.\n\n' +
      'The javascript: URL payload is the one people miss: it does not need a tag or an attribute\n' +
      'handler, only an href your app sets from data. Validate URL SCHEMES separately.';
  }, 400);
});

on('withCsp', () => {
  const csp = "default-src 'self'; script-src 'none'; object-src 'none'; base-uri 'none'";
  log.head(`— same payloads, with CSP: ${csp} —`);
  renderFrames({ csp });
  setTimeout(() => {
    out.textContent =
      `With script-src 'none', even the raw sink cannot execute: the injected inline handler is\n` +
      'blocked by the policy. Open the console to see the violation reports.\n\n' +
      'That is CSP as the SECOND line of defence. It does not fix the injection — the attacker\n' +
      'still controls your markup, and can still deface the page, exfiltrate via an image URL\n' +
      '(unless img-src is restricted) or phish with an injected form (unless form-action is).\n\n' +
      'The order that matters: escape correctly FIRST, because CSP is a mitigation, not a fix.\n' +
      'Lab 02 is how to ship a real one.';
  }, 400);
});

on('sinks', () => {
  renderTable('#results', [
    { sink: 'innerHTML / outerHTML', safe: 'NO', note: 'parses HTML. The canonical sink.' },
    { sink: 'React dangerouslySetInnerHTML', safe: 'NO', note: 'the name is the warning; sanitise first' },
    { sink: 'document.write', safe: 'NO', note: 'parses HTML, and blocks the parser' },
    { sink: 'insertAdjacentHTML', safe: 'NO', note: 'same as innerHTML' },
    { sink: 'element.setAttribute("href", …)', safe: 'DEPENDS', note: 'javascript: and data: URLs execute' },
    { sink: 'element.setAttribute("on*", …)', safe: 'NO', note: 'an event handler from data' },
    { sink: 'eval / new Function / setTimeout("string")', safe: 'NO', note: 'obviously, and still shipped' },
    { sink: 'element.style / CSS injection', safe: 'DEPENDS', note: 'url() can leak data; expression() historically executed' },
    { sink: 'textContent / innerText', safe: 'yes', note: 'never parsed as HTML' },
    { sink: 'React {value} in JSX', safe: 'yes', note: 'escaped by default' },
    { sink: 'setAttribute for a non-URL, non-event attribute', safe: 'yes', note: 'value is treated as text' },
    { sink: 'JSON.parse', safe: 'yes', note: 'but what you DO with the result may not be' },
  ].map((r) => ({ ...r, _safeClass: r.safe === 'yes' ? 'ok' : r.safe === 'DEPENDS' ? 'meh' : 'no' })),
  { columns: ['sink', 'safe', 'note'] });

  out.textContent =
    'Three rules that cover almost all of it:\n\n' +
    '1. ESCAPE BY CONTEXT. HTML text, HTML attribute, URL, CSS and JavaScript contexts each need\n' +
    '   different escaping. A single escapeHtml() applied to a URL does not stop javascript:.\n' +
    '   Frameworks do this for you — which is the strongest argument for not building HTML by\n' +
    '   string concatenation.\n\n' +
    '2. SANITISE ONLY RICH TEXT, WITH AN ALLOW-LIST, USING A REAL LIBRARY (DOMPurify). A deny-list\n' +
    '   ("strip <script>") loses: <img onerror>, <svg onload>, <iframe srcdoc>, mutation XSS where\n' +
    '   the parser rewrites your sanitised output into something executable. The sanitiser in this\n' +
    '   lab is 8 lines to show the SHAPE; do not ship it.\n\n' +
    '3. VALIDATE URL SCHEMES. Anywhere your app puts data into href/src/action/formaction, allow\n' +
    '   only http:, https:, mailto: and relative URLs. This is the check that stops the payload\n' +
    '   nobody expects.\n\n' +
    'And the modern belt-and-braces: TRUSTED TYPES. With\n' +
    "  Content-Security-Policy: require-trusted-types-for 'script'\n" +
    'assigning a plain string to innerHTML throws. It converts "we hope nobody wrote a sink" into\n' +
    'a runtime guarantee, and it is the only mechanism that makes DOM XSS structurally hard.';
});

on('clear', () => { log.clear(); $('#frames').textContent = ''; $('#results').textContent = ''; });
