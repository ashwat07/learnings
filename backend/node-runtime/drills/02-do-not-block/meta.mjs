import { loopLag } from '../../../lib/console.mjs';

export const title = 'One slow function stalls everything';
export const task = `hash(n) mixes n integers and returns a 32-bit result. Written as a plain loop
it takes roughly 400ms — during which your server answers nothing, your health check times out,
and your p99 is 400ms for every request that had the bad luck to arrive.

Keep the answer bit-for-bit identical. Stop it holding the loop.`;
export const passIf = 'the hash is correct AND the worst event-loop lag during the call stays under 25ms';

const LAG_BUDGET_MS = 25;

// n is chosen at random inside the check so the answer cannot be a hardcoded constant.
const expected = (n) => { let h = 1; for (let i = 0; i < n; i++) h = Math.imul(h ^ i, 2654435761) >>> 0; return h; };
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

export async function check(s) {
  if (typeof s.hash !== 'function') return [{ check: 'exports async hash(n)', actual: 'missing', pass: false }];

  const n = 250_000_000 + Math.floor(Math.random() * 100_000_000);
  const want = expected(n);

  // A "request" arriving every 20ms while the work runs. On a healthy loop these are on time; a
  // blocked loop shows up as one enormous gap, which is exactly what your users experience.
  const t0 = performance.now();
  const served = [t0];
  const beat = setInterval(() => served.push(performance.now()), 20);

  const lag = loopLag(4);
  const got = await s.hash(n);
  const elapsed = performance.now() - t0;
  // Let the loop turn once so the timers that were held back can finally fire and be counted.
  // Without this the delayed samples are still pending and the lag would read a fictional zero.
  await settle(60);
  const l = lag.stop();
  clearInterval(beat);

  const gaps = served.slice(1).map((t, i) => t - served[i]);
  const worstGap = gaps.length ? Math.max(...gaps) : Infinity;

  return [
    { check: 'the hash is correct', actual: got === want ? `${got}` : `got ${got}, want ${want}`, pass: got === want },
    { check: 'it actually did the work', actual: `${elapsed.toFixed(0)}ms for ${(n / 1e6).toFixed(0)}M iterations`, pass: elapsed > 50 },
    { check: `worst loop lag < ${LAG_BUDGET_MS}ms`, actual: `${l.max.toFixed(1)}ms (p99 ${l.p99.toFixed(1)}ms)`, pass: l.max > 0 && l.max < LAG_BUDGET_MS },
    { check: 'the 20ms heartbeat never missed', actual: `${served.length - 1} beats, worst gap ${worstGap.toFixed(0)}ms`, pass: served.length > 5 && worstGap < 60 },
  ];
}
