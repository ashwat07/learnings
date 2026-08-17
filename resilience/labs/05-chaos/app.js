// Lab 05 — Chaos: a fetch() fault injector you can paste into any app.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

const realFetch = window.fetch.bind(window);
let fault = null;

/**
 * Twenty lines, no dependency, works in any app. Install it behind a query flag in a staging
 * build and you have a chaos harness — the value is not the code, it is the habit.
 */
function installFault({ failRate = 0, minDelay = 0, maxDelay = 0, label }) {
  fault = { failRate, minDelay, maxDelay, label };
  window.fetch = async (input, init) => {
    const delay = minDelay + Math.random() * (maxDelay - minDelay);
    if (delay) await new Promise((r) => setTimeout(r, delay));
    if (Math.random() < failRate) {
      log.bad(`injected failure: ${String(input).slice(0, 60)}`);
      throw new TypeError('Failed to fetch (injected)');
    }
    return realFetch(input, init);
  };
  log.head(`fault installed: ${label}`);
}

on('off', () => { window.fetch = realFetch; fault = null; log.ok('fault injector removed'); });
on('fail', () => installFault({ failRate: 0.1, label: '10% failure' }));
on('slow', () => installFault({ minDelay: 2000, maxDelay: 2000, label: '+2s on every request' }));
on('jitter', () => installFault({ failRate: 0.05, minDelay: 0, maxDelay: 3000, label: '0–3s latency, 5% failure' }));
on('offline', () => installFault({ failRate: 1, label: 'everything fails' }));

on('exercise', async () => {
  log.head('— firing 12 requests —');
  const urls = ['/api/data/product/3', '/api/data/reviews/3', '/api/data/recommends/3', '/api/data/products'];
  const results = [];
  for (let i = 0; i < 12; i++) {
    const url = urls[i % urls.length];
    const t0 = performance.now();
    try {
      const r = await fetch(url);
      results.push({ url, outcome: `HTTP ${r.status}`, ms: Math.round(performance.now() - t0), _outcomeClass: 'ok' });
    } catch (e) {
      results.push({ url, outcome: e.message, ms: Math.round(performance.now() - t0), _outcomeClass: 'no' });
    }
  }
  renderTable('#results', results, { columns: ['url', 'outcome', 'ms'] });
  const failed = results.filter((r) => r._outcomeClass === 'no').length;
  out.textContent =
    `${failed}/12 failed under "${fault?.label ?? 'no fault'}".\n\n` +
    'Now the question this lab actually asks: WHAT DID YOUR UI DO?\n\n' +
    'Go and use the other labs in this repo with the fault installed — lab 03 (degradation), the\n' +
    'realtime-ui labs, the React sandbox. Watch for the specific failures that only appear under\n' +
    'chaos:\n' +
    '  · a spinner that never stops, because the error path forgot to clear loading state\n' +
    '  · a retry loop with no budget, hammering a dead endpoint forever\n' +
    '  · an optimistic update that was never rolled back\n' +
    '  · a Promise.all that discarded three good results because of one failure\n' +
    '  · an error message that says "undefined"\n' +
    '  · two requests racing, and the SLOWER one winning because nothing tracked ordering\n\n' +
    'Every one of those is invisible when the network is fast and reliable, which is exactly the\n' +
    'condition your development machine maintains.';
});

on('checklist', () => {
  renderTable('#results', [
    { fault: 'a slow dependency (+2s)', ask: 'is there a timeout? does the rest of the page still render?' },
    { fault: 'an intermittent 5% failure', ask: 'do retries have a budget? does the user ever see a permanent error?' },
    { fault: 'a total dependency outage', ask: 'does the page degrade per widget, or die whole?' },
    { fault: 'offline mid-action', ask: 'is the write queued, or silently lost? does the UI lie about success?' },
    { fault: 'a 401 mid-session', ask: 'one refresh and one retry — or an infinite loop?' },
    { fault: 'a lazy chunk 404 (stale deploy)', ask: 'does it reload once, or show a blank route forever?' },
    { fault: 'clock skew / a slow device', ask: 'do timeouts and animations still behave?' },
    { fault: 'a third-party script fails to load', ask: 'does your page render without it?' },
  ], { columns: ['fault', 'ask'] });
  out.textContent =
    'How to make this a practice rather than an afternoon:\n\n' +
    '1. PUT THE INJECTOR IN YOUR STAGING BUILD, behind a query parameter. Anyone can turn it on;\n' +
    '   nobody has to set up a proxy. The barrier to trying is the whole game.\n' +
    '2. AUTOMATE THE OBVIOUS ONES. Playwright can route() and abort or delay specific requests, so\n' +
    '   "the reviews API is down" becomes a test with an assertion: the product still renders.\n' +
    '   Those tests catch the regression where someone wraps everything in one Promise.all again.\n' +
    '3. DO IT ON PURPOSE, ON A SCHEDULE, WHILE WATCHING. A game day where you turn off a dependency\n' +
    '   in staging for 20 minutes finds more real problems than a month of design review.\n' +
    '4. THE FIRST TIME, YOU WILL FIND SOMETHING EMBARRASSING. That is the point, and it is much\n' +
    '   cheaper to find it now.\n\n' +
    'The deeper principle, and the reason this lab is last in the course: A FALLBACK YOU HAVE NEVER\n' +
    'SEEN RUN IS NOT A FALLBACK. It is an untested code path, written under optimistic assumptions,\n' +
    'that will execute for the first time during an incident.';
});

on('clear', () => { log.clear(); $('#results').textContent = ''; });
