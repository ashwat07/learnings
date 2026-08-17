// Lab 05 — Release safety. A 100-user simulator; the new release is broken for 30% of them.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
const cohort = $('#cohort');
const USERS = 100;
const BROKEN_RATE = 0.3;

let timers = [];
let onNew = new Set();
let affected = new Set();
let errors = 0;

const cells = Array.from({ length: USERS }, () => {
  const d = document.createElement('div');
  cohort.append(d);
  return d;
});

function paint(state) {
  cells.forEach((c, i) => {
    c.className = affected.has(i) ? 'err' : onNew.has(i) ? 'new' : '';
  });
  $('pct').textContent = `${onNew.size}%`;
  $('errs').textContent = errors;
  $('aff').textContent = affected.size;
  if (state) $('state').textContent = state;
}

function reset() {
  timers.forEach(clearTimeout);
  timers = [];
  onNew = new Set(); affected = new Set(); errors = 0;
  paint('idle');
}
on('reset', () => { reset(); log.muted('reset'); });
reset();

function promote(count, label) {
  for (let i = 0; i < USERS && onNew.size < count; i++) {
    if (onNew.has(i)) continue;
    onNew.add(i);
    if (Math.random() < BROKEN_RATE) { affected.add(i); errors += 1 + Math.floor(Math.random() * 4); }
  }
  paint(label);
  log[affected.size ? 'bad' : 'ok'](`${label}: ${onNew.size}% on the new version, ${affected.size} affected`);
}

on('r-big', () => {
  reset();
  log.head('— big bang deploy —');
  promote(USERS, 'shipped to everyone');
  out.textContent =
    `${affected.size} users hit the bug, in the first moments, before anyone looked at a dashboard.\n\n` +
    'That is the actual cost of a big-bang deploy: not that the bug existed, but that the BLAST\n' +
    'RADIUS was everyone, immediately. Your detection speed no longer matters — the damage is done\n' +
    'before your alert threshold is crossed.\n\n' +
    'Now reset and try the canary.';
});

on('r-canary', () => {
  reset();
  log.head('— canary rollout —');
  const stages = [[1, '1%'], [10, '10%'], [50, '50%'], [USERS, '100%']];
  let stage = 0;
  const next = () => {
    if (stage >= stages.length) return;
    const [count, label] = stages[stage++];
    promote(count, `canary ${label}`);
    // The automated gate: if the error rate on the new version exceeds a threshold, stop.
    const rate = affected.size / Math.max(onNew.size, 1);
    if (rate > 0.15 && onNew.size >= 10) {
      log.bad(`error rate ${(rate * 100).toFixed(0)}% exceeds the gate — HALTING and rolling back`);
      onNew = new Set(); affected = new Set();
      paint('halted & rolled back');
      out.textContent =
        'The rollout halted at 10% and rolled back automatically.\n\n' +
        'Ten users saw the bug instead of thirty. That is the entire value of a canary, and note\n' +
        'what made it work: not the staging, but the AUTOMATED GATE. A canary that a human has to\n' +
        'watch is a canary that gets promoted on a Friday afternoon because the dashboard looked\n' +
        'fine.\n\n' +
        'What to gate on, in order of usefulness:\n' +
        '  1. error rate on the new version vs the old (a RATIO, not an absolute — traffic varies)\n' +
        '  2. a business metric: checkout completions, sign-ups, add-to-cart\n' +
        '  3. p75 latency and Core Web Vitals\n' +
        '  4. crash-free session rate\n\n' +
        'The second is the one teams add last and value most: a release can be error-free and still\n' +
        'reduce conversions by 8%, and only the funnel will tell you.';
      return;
    }
    timers.push(setTimeout(next, 1400));
  };
  next();
});

on('r-flag', () => {
  reset();
  log.head('— deployed dark, enabled by flag —');
  paint('deployed, flag off');
  timers.push(setTimeout(() => { promote(10, 'flag on for 10%'); }, 800));
  timers.push(setTimeout(() => {
    log.bad('errors detected — turning the flag OFF (no deploy needed)');
    onNew = new Set(); affected = new Set();
    paint('flag off');
    out.textContent =
      'The code was deployed to everyone with the flag OFF, then enabled for 10%, then disabled\n' +
      'again — with no deploy, no build, and no rollback of anything else that shipped alongside it.\n\n' +
      'THIS IS THE KEY SEPARATION: DEPLOY ≠ RELEASE.\n\n' +
      '  DEPLOY   the code is on the server. Boring, frequent, reversible only by another deploy.\n' +
      '  RELEASE  users can see it. A configuration change, reversible in seconds.\n\n' +
      'Once those are separate, you can deploy twenty times a day, merge to main continuously\n' +
      '(no long-lived branches, no big-bang merges), and turn a feature off in seconds without\n' +
      'reverting the eleven other changes that shipped in the same build.\n\n' +
      'The trade is real, though: every flag is a BRANCH IN PRODUCTION, and n flags mean 2^n\n' +
      'possible states you are not testing. Press "flags, and their debt".';
  }, 2400));
});

on('kill', () => {
  log.ok('kill switch: feature disabled for everyone, immediately');
  onNew = new Set(); affected = new Set();
  paint('killed');
  out.textContent =
    'A KILL SWITCH IS THE ONE MECHANISM TO BUILD BEFORE YOU NEED IT.\n\n' +
    'It is a flag that is checked at runtime, defaults to SAFE when the flag service is unreachable,\n' +
    'and can be flipped by someone on call without a deploy, a build, or a code review.\n\n' +
    'The properties that matter and are easy to get wrong:\n' +
    '  · FAIL SAFE, NOT FAIL OPEN. If the flag service is down, the feature must default to its\n' +
    '    known-good state — usually off. A flag system that fails open turns its own outage into\n' +
    '    your outage.\n' +
    '  · IT MUST WORK WITHOUT A DEPLOY. If turning it off requires CI, it is not a kill switch.\n' +
    '  · CACHE THE FLAG VALUE, but with a short TTL and a push channel, so "off" propagates in\n' +
    '    seconds rather than at the next page load.\n' +
    '  · TEST IT ON A SCHEDULE. An untested kill switch is a comforting story.\n\n' +
    'The same shape applies to your service worker (service-workers lab 05) and to a client that is\n' +
    'too old to talk to your API (offline-and-pwa lab 05) — in both cases you need a way to reach\n' +
    'clients you can no longer deploy to.';
});

on('mechanisms', () => {
  renderTable('#results', [
    { mechanism: 'feature flags', gives: 'deploy ≠ release; instant off', costs: 'branches in production; cleanup debt' },
    { mechanism: 'canary / progressive rollout', gives: 'a bounded blast radius', costs: 'infrastructure; two versions live at once' },
    { mechanism: 'automated gates', gives: 'detection without a human watching', costs: 'you must define good metrics' },
    { mechanism: 'fast rollback', gives: 'the shortest path back to known-good', costs: 'forward-compatible migrations' },
    { mechanism: 'blue/green', gives: 'an instant switch, and an instant switch back', costs: 'double the infrastructure' },
    { mechanism: 'shadow / dark traffic', gives: 'real load on the new path with no user impact', costs: 'complexity; side effects must be suppressed' },
    { mechanism: 'a kill switch', gives: 'a way to stop the bleeding without a deploy', costs: 'almost none — build it' },
  ], { columns: ['mechanism', 'gives', 'costs'] });
  out.textContent =
    'THE METRIC THAT MATTERS IS NOT DEPLOY FREQUENCY, IT IS MTTR — how long from "it broke" to "it\n' +
    'stopped breaking". The DORA research is consistent about this: elite teams deploy more often AND\n' +
    'have lower change-failure rates, because the same properties produce both. Small changes are\n' +
    'easier to review, easier to attribute, and easier to reverse.\n\n' +
    'Which gives a useful test for any process proposal: DOES IT SHORTEN THE TIME TO DETECT OR THE\n' +
    'TIME TO RECOVER? A four-hour manual regression pass before every release does neither — it\n' +
    'lengthens the interval between deploys, which makes each deploy bigger and each failure harder\n' +
    'to attribute. That is the "safety" that makes things less safe.';
});

on('flags', () => {
  renderTable('#results', [
    { type: 'release flag', life: 'days to weeks', rule: 'DELETE IT once the feature is fully on' },
    { type: 'experiment flag', life: 'the length of the test', rule: 'delete when the experiment concludes' },
    { type: 'ops / kill switch', life: 'permanent', rule: 'keep, document, and test on a schedule' },
    { type: 'permission / entitlement', life: 'permanent', rule: 'not a feature flag — that is authorisation, put it elsewhere' },
  ], { columns: ['type', 'life', 'rule'] });
  out.textContent =
    'FLAG DEBT IS REAL AND COMPOUNDS. Every flag is a branch in production, and n flags are 2^n\n' +
    'possible states, of which you test approximately two. A codebase with 200 stale flags has\n' +
    'behaviour nobody can predict and nobody dares delete.\n\n' +
    'The discipline that works:\n' +
    '  · EVERY RELEASE FLAG GETS AN OWNER AND AN EXPIRY DATE AT CREATION.\n' +
    '  · CI warns on flags past expiry, and fails after a grace period. Automate it or it will not\n' +
    '    happen.\n' +
    '  · Removing a flag is part of the FEATURE ticket, not a follow-up ticket that never gets\n' +
    '    prioritised.\n' +
    '  · Test the flag-off path too. The old path is still production code until you delete it, and\n' +
    '    a rollback that hits an untested old path is not a rollback.\n\n' +
    'And keep the FOURTH ROW out of your flag system: entitlements and permissions look like flags\n' +
    'and are not. They are authorisation decisions, they need auditing, and they must be enforced\n' +
    'server-side (security-and-auth lab 04).';
});

on('rollback', () => {
  renderTable('#results', [
    { situation: 'a clear regression, cause unknown', do: 'ROLL BACK. Diagnose afterwards, calmly.' },
    { situation: 'a small, understood bug with a one-line fix', do: 'roll forward — but only if CI is fast' },
    { situation: 'a database migration has run', do: 'roll forward; you usually cannot un-migrate' },
    { situation: 'errors started 20 minutes after the deploy', do: 'check whether it correlates at all before reverting' },
    { situation: 'a third party changed something', do: 'a kill switch on that integration' },
  ], { columns: ['situation', 'do'] });
  out.textContent =
    'THE DEFAULT SHOULD BE ROLL BACK FIRST, DIAGNOSE SECOND. Debugging under pressure with users\n' +
    'affected produces bad decisions; debugging a reverted system produces good ones. "We know what\n' +
    'it is, we can just push a fix" is how a ten-minute incident becomes ninety.\n\n' +
    'What makes rollback possible, and all of it has to be decided BEFORE you need it:\n' +
    '  · FORWARD-COMPATIBLE MIGRATIONS. Never a migration that the previous version cannot run\n' +
    '    against. Add columns, do not rename them; write to both for a release; remove later. This\n' +
    '    is the same two-release discipline as the API rule in offline-and-pwa lab 05.\n' +
    '  · KEEP THE PREVIOUS BUILD DEPLOYABLE AND ITS ASSETS ONLINE. A rollback that 404s on chunks\n' +
    '    is not a rollback.\n' +
    '  · ROLLBACK IS ONE COMMAND, AND SOMEONE ON CALL HAS RUN IT BEFORE. Practise it.\n' +
    '  · KNOW WHAT IS NOT REVERSIBLE: sent emails, charged cards, published webhooks, migrated data.\n' +
    '    Those need flags in front of them, not rollback behind them.\n\n' +
    'And measure it: TIME TO ROLLBACK is a number you should know. If nobody knows it, it is longer\n' +
    'than you think.';
});
