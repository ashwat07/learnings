// Lab 04 — Priority & prefetch.

import { $, on, Log, renderTable, fmt } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

/**
 * Fire twelve identical requests at once, four at each priority, and see which ones the
 * browser lets through first. The server delay is identical for all of them, so any
 * difference in completion order is scheduling, not the network.
 */
on('fetchPri', async () => {
  log.clear();
  log.head('— 12 identical fetches: 4 high, 4 auto, 4 low —');

  const started = performance.now();
  const results = [];
  const jobs = [];

  for (const priority of ['high', 'auto', 'low']) {
    for (let i = 0; i < 4; i++) {
      const name = `pri-${priority}-${i}-${Math.random().toString(36).slice(2, 6)}`;
      const url = `/api/asset?name=${name}&type=json&delay=200&size=400000&cc=no-store`;
      jobs.push(
        fetch(url, { priority })
          .then((r) => r.text())
          .then(() => {
            const at = performance.now() - started;
            results.push({ priority, request: i, 'finished at ms': Math.round(at) });
            log.line(`${priority.padEnd(5)} #${i} finished at ${fmt.ms(at)}`,
              priority === 'high' ? 'good' : priority === 'low' ? 'macro' : 'muted');
          }),
      );
    }
  }

  await Promise.all(jobs);
  results.sort((a, b) => a['finished at ms'] - b['finished at ms']);
  renderTable('#results', results.map((r, i) => ({ order: i + 1, ...r })), {
    columns: ['order', 'priority', 'request', 'finished at ms'],
  });

  const avg = (p) => {
    const rows = results.filter((r) => r.priority === p);
    return Math.round(rows.reduce((a, b) => a + b['finished at ms'], 0) / rows.length);
  };

  out.textContent =
    `average completion: high ${avg('high')}ms · auto ${avg('auto')}ms · low ${avg('low')}ms\n\n` +
    'Twelve identical requests, one connection-limited origin. The browser served the high\n' +
    'priority ones first. Note what did NOT happen: nothing got faster. The total time is the\n' +
    'same; you chose the order.\n\n' +
    'That is the correct mental model for every priority hint. On a constrained connection,\n' +
    'prioritisation is a zero-sum reordering — which is precisely why it works so well for LCP\n' +
    '(one resource matters more than the rest) and does nothing when you mark everything high.\n\n' +
    'Try again with throttling off and the differences shrink to noise: on a fast connection the\n' +
    'browser is not making trade-offs, so there is nothing for the hint to change.';
});

on('clear', () => { log.clear(); $('results').textContent = ''; out.textContent = ''; });
