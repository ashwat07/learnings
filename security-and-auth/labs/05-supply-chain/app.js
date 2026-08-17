// Lab 05 — Supply chain.
//
// Two halves: what a third-party <script> can do to your runtime, and what a dependency tree does
// to your build. The first is measured live; the second is measured against the real lockfiles in
// this repo (run `node audit.mjs ../../../bundle-strategy/package-lock.json`).

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
let pinned = null;

async function hashOf(v) {
  const r = await fetch(`/api/thirdparty.js?v=${v}`);
  await r.text();
  return r.headers.get('x-sri-sha384');
}

function load(v, integrity) {
  $('#frame').src = `vendor.html?v=${v}${integrity ? `&integrity=${encodeURIComponent(integrity)}` : ''}&t=${Date.now()}`;
}

addEventListener('message', (e) => {
  if (e.data?.blocked) {
    log.ok('SRI blocked the script — the bytes did not match the pinned hash');
    renderTable('#results', [{ what: 'script execution', result: 'BLOCKED by integrity', _resultClass: 'ok' }],
      { columns: ['what', 'result'] });
    out.textContent =
      'The browser fetched the script, hashed the bytes, compared them to the hash you pinned, and\n' +
      'refused to execute. That is Subresource Integrity, and it is two lines:\n\n' +
      '  <script src="https://cdn.example.com/analytics.js"\n' +
      '          integrity="sha384-…" crossorigin="anonymous"></script>\n\n' +
      'What SRI is: a promise about CONTENT, made at a URL. It converts "I trust this CDN forever"\n' +
      'into "I trust exactly these bytes".\n\n' +
      'What SRI is NOT:\n' +
      '  · It does not review the code. You pinned a hash of something you should still have read.\n' +
      '  · It does not work for anything that must change — a script the vendor updates for you is\n' +
      '    fundamentally incompatible with pinning, and that tension is the real decision.\n' +
      '  · It does not cover what the script loads AFTER it runs. A pinned loader that fetches a\n' +
      '    second, unpinned script has bought you nothing. Check for that.\n' +
      '  · crossorigin="anonymous" is required for cross-origin scripts — without CORS the browser\n' +
      '    cannot read the bytes to hash them, and the load fails.';
    return;
  }
  if (!e.data?.vendor) return;

  const { vendor, didExfiltrate, loot } = e.data;
  log[didExfiltrate ? 'bad' : 'ok'](`vendor script ${vendor} executed${didExfiltrate ? ' — and exfiltrated' : ''}`);
  renderTable('#results', [
    { what: 'version that ran', result: vendor },
    { what: 'document.cookie', result: loot?.cookies ?? 'not read', _resultClass: loot?.cookies ? 'no' : 'ok' },
    { what: 'localStorage keys', result: loot?.storage?.join(', ') ?? 'not read', _resultClass: loot?.storage ? 'no' : 'ok' },
    { what: 'form fields', result: loot?.forms?.join(', ') ?? 'not read', _resultClass: loot?.forms ? 'no' : 'ok' },
    { what: 'sent to an external host', result: didExfiltrate ? 'YES — via an <img> URL' : 'no', _resultClass: didExfiltrate ? 'no' : 'ok' },
  ], { columns: ['what', 'result'] });

  if (didExfiltrate) {
    out.textContent =
      'Same URL. Same <script> tag. One patch release later, it reads the session cookie, the token\n' +
      'in localStorage, and the card number the user is typing, and sends them to another host via\n' +
      'an image URL.\n\n' +
      'Nothing here is an exploit. A <script> tag runs with the FULL AUTHORITY OF YOUR ORIGIN — same\n' +
      'DOM, same cookies, same storage, same fetch credentials. There is no sandbox and no\n' +
      'permission model. "We only added their analytics snippet" and "we gave a third party\n' +
      'arbitrary code execution on every page, forever" are the same sentence.\n\n' +
      'This is exactly how the British Airways (2018) and Ticketmaster breaches worked: a modified\n' +
      'third-party script on the payment page. It is called Magecart, and it is still the most\n' +
      'common way card data is stolen from the web.\n\n' +
      'Two controls, in order:\n' +
      '  1. Do not put third-party scripts on pages that handle credentials or payment. An iframe\n' +
      '     from the payment provider is a different origin, and that boundary is the control.\n' +
      '  2. Pin what you must include (SRI), and restrict where anything can send data\n' +
      '     (CSP connect-src and img-src — the img-src channel is the one used above).';
  } else {
    out.textContent =
      'v1 ran and behaved. You reviewed this version; it does what the README said.\n\n' +
      'Now press the second button. The URL will not change.';
  }
});

on('v1', async () => {
  pinned = await hashOf('1');
  $('hash').textContent = pinned;
  log.head('— loading vendor v1, the version you reviewed —');
  load('1');
});

on('v2', () => {
  log.head('— the vendor pushed an update. Same URL. Nobody reviewed it. —');
  load('2');
});

on('sri', () => {
  if (!pinned) return log.bad('load v1 first, so there is a hash to pin');
  log.head('— same "update", but the tag now pins the hash of v1 —');
  load('2', pinned);
});

on('audit', () => {
  renderTable('#results', [
    { measure: 'direct dependencies you chose', typical: '10–40' },
    { measure: 'packages actually installed', typical: '300–1,500' },
    { measure: 'distinct maintainers with publish rights over your build', typical: 'hundreds' },
    { measure: 'packages that run code at install time', typical: '5–50' },
    { measure: 'packages a single person maintains unpaid', typical: 'most of them' },
  ], { columns: ['measure', 'typical'] });
  out.textContent =
    'Measure yours, do not estimate. In this repo:\n\n' +
    '  node audit.mjs ../../../bundle-strategy/package-lock.json\n' +
    '  node audit.mjs ../../../nextjs-caching/package-lock.json\n' +
    '  node audit.mjs ../../../react-sandbox/package-lock.json\n\n' +
    'It prints the transitive count, the depth, which packages run install scripts, which lack an\n' +
    'integrity hash, and which are installed at more than one version.\n\n' +
    'The number that matters is not the count — it is the ratio. When you add ONE dependency and\n' +
    'the tree grows by 200, you did not make one trust decision; you made 200, and you cannot name\n' +
    'the people involved in 199 of them.\n\n' +
    'Precedents worth knowing, because each one is a different failure mode:\n' +
    '  event-stream (2018)  a maintainer handed the repo to a volunteer, who added a payload\n' +
    '                       targeting one bitcoin wallet. TRUST TRANSFER.\n' +
    '  ua-parser-js (2021)  maintainer account compromised, malicious versions published.\n' +
    '                       ACCOUNT TAKEOVER.\n' +
    '  colors / faker (2022) the maintainer deliberately broke their own packages.\n' +
    '                       THE MAINTAINER IS NOT ALWAYS ON YOUR SIDE.\n' +
    '  left-pad (2016)      unpublished; thousands of builds failed. AVAILABILITY.\n' +
    '  xz-utils (2024)      a multi-year social-engineering campaign to become a co-maintainer.\n' +
    '                       PATIENT, TARGETED, AND IT NEARLY WORKED.\n\n' +
    'Note that only one of these is a "vulnerability" in the CVE sense. `npm audit` would have\n' +
    'caught approximately none of them at the time.';
});

on('scripts', () => {
  renderTable('#results', [
    { stage: 'npm install', runs: 'preinstall / install / postinstall scripts', as: 'your user, on your laptop and in CI', gets: 'env vars, SSH keys, npm token, cloud credentials' },
    { stage: 'build', runs: 'every plugin, loader and transform', as: 'CI, usually with deploy credentials', gets: 'the artifact it can modify before you sign it' },
    { stage: 'test', runs: 'the same tree', as: 'CI', gets: 'the same' },
    { stage: 'runtime (browser)', runs: 'whatever ended up in the bundle', as: 'your origin', gets: 'cookies, storage, the DOM, the user' },
  ], { columns: ['stage', 'runs', 'as', 'gets'] });
  out.textContent =
    'The install-time surface is the one people forget, and it is worse than the runtime one:\n' +
    'a postinstall script runs on a machine holding your credentials, before any code review of the\n' +
    'artifact, and its output is invisible in the diff.\n\n' +
    'Controls that actually reduce it:\n' +
    '  · npm ci --ignore-scripts in CI, with an explicit allow-list for the few packages that\n' +
    '    genuinely need to build a native binary. Most do not.\n' +
    '  · npm ci, never npm install, in CI. `install` may resolve new versions; `ci` installs the\n' +
    '    lockfile exactly and fails if package.json disagrees.\n' +
    '  · A cooldown before adopting new versions (many attacks are found within days of publish).\n' +
    '  · Least-privilege CI: the job that installs dependencies should not hold deploy credentials.\n' +
    '  · Pin the toolchain too. A GitHub Action referenced by tag is mutable; reference it by\n' +
    '    commit SHA. That is the same SRI idea, applied to CI.';
});

on('checklist', () => {
  renderTable('#results', [
    { control: 'lockfile committed, `npm ci` in CI', stops: 'a resolved version you never reviewed' },
    { control: '`--ignore-scripts` + allow-list', stops: 'install-time code execution' },
    { control: 'SRI on every third-party script tag', stops: 'a CDN or vendor changing the bytes' },
    { control: 'CSP connect-src / img-src / script-src', stops: 'exfiltration and unpinned second-stage loads' },
    { control: 'no third-party scripts on payment/auth pages', stops: 'Magecart, entirely' },
    { control: 'version cooldown before adoption', stops: 'the window when a compromised publish is live' },
    { control: 'dependency review in PRs (new deps need a justification)', stops: 'tree growth nobody decided on' },
    { control: 'automated updates with tests (Renovate/Dependabot)', stops: 'the OTHER failure mode: never patching' },
    { control: 'SBOM + provenance/attestations', stops: 'not knowing what you shipped when it matters' },
    { control: 'a private registry proxy', stops: 'dependency confusion; also gives you a cache when a package is unpublished' },
  ], { columns: ['control', 'stops' ] });
  out.textContent =
    'The unglamorous one at the bottom of that list does the most work: A PRIVATE REGISTRY PROXY.\n' +
    'It caches every package you have ever installed (left-pad becomes a non-event), and it closes\n' +
    'DEPENDENCY CONFUSION — where an attacker publishes `@yourcompany/internal-utils` to the public\n' +
    'registry at version 99.0.0 and your resolver prefers it over your internal one.\n\n' +
    'And the balance to hold: the opposite failure is real too. Teams that pin everything and never\n' +
    'update ship known-vulnerable code for years. The goal is not fewer updates; it is UPDATES YOU\n' +
    'CAN APPLY QUICKLY AND SAFELY — good tests, small diffs, automated PRs, a fast rollback. A team\n' +
    'that can ship a patch in an hour is safer than one that has pinned everything since 2022.\n\n' +
    'Finally: the cheapest control of all is the one at review time. Every new dependency should\n' +
    'come with an answer to "what does this replace, how many packages does it add, and what would\n' +
    'it cost us to write instead?" Most `is-odd`-shaped dependencies fail that question.';
});

on('clear', () => { log.clear(); $('#frame').src = 'about:blank'; $('#results').textContent = ''; });
