/**
 * Console formatting, with no database attached.
 *
 * lib/db.mjs exports the same four helpers, but importing it opens a Postgres pool. The runtime
 * and language drills need neither Postgres nor Redis nor Docker — they are about Node itself —
 * so they import this instead and run anywhere `node` runs.
 */

export const rule = (s) => console.log(`\n\x1b[1m${s}\x1b[0m\n${'─'.repeat(Math.min(s.length, 78))}`);
export const good = (s) => console.log(`  \x1b[32m✓\x1b[0m ${s}`);
export const bad = (s) => console.log(`  \x1b[31m✗\x1b[0m ${s}`);
export const note = (s) => console.log(`  \x1b[2m${s}\x1b[0m`);
export const dim = (s) => `\x1b[2m${s}\x1b[0m`;
export const bold = (s) => `\x1b[1m${s}\x1b[0m`;

export function table(rows, columns) {
  if (!rows.length) return;
  const cols = columns ?? Object.keys(rows[0]);
  const width = Object.fromEntries(cols.map((c) => [c, Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length))]));
  const line = (cells) => '  ' + cols.map((c) => String(cells[c] ?? '').padEnd(width[c])).join('  ');
  console.log('\x1b[2m' + line(Object.fromEntries(cols.map((c) => [c, c]))) + '\x1b[0m');
  console.log('\x1b[2m' + '  ' + cols.map((c) => '─'.repeat(width[c])).join('  ') + '\x1b[0m');
  for (const r of rows) console.log(line(r));
}

/**
 * Event loop lag, measured the way production monitoring measures it: schedule a timer for `every`
 * ms, and see how late it actually fires. The gap is time the loop spent unable to get back to you.
 *
 *   const lag = loopLag(); ... const { max, p99 } = lag.stop();
 */
export function loopLag(every = 5) {
  const samples = [];
  let last = process.hrtime.bigint();
  const timer = setInterval(() => {
    const now = process.hrtime.bigint();
    samples.push(Number(now - last) / 1e6 - every);
    last = now;
  }, every);
  timer.unref();
  return {
    stop() {
      clearInterval(timer);
      const s = samples.map((n) => Math.max(0, n)).sort((a, b) => a - b);
      if (!s.length) return { max: 0, p99: 0, samples: 0 };
      return { max: s.at(-1), p99: s[Math.min(s.length - 1, Math.ceil(s.length * 0.99) - 1)], samples: s.length };
    },
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
