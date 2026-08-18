import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loopLag } from '../../../lib/console.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const workerPath = path.join(here, 'worker.mjs');

export const title = 'True parallelism with a worker pool';
export const task = `Drill 02 kept the loop responsive by yielding. It did not make anything
faster — the work still ran on one thread. This is the other half: real parallelism.

Implement createPool(size, workerPath) -> { run({ n, fail }), close() }.

  · spawn exactly "size" workers ONCE and reuse them. Spawning per job costs ~15ms and ~2MB of
    fresh V8 heap, which is more than most jobs are worth.
  · route each reply back to the promise that asked for it
  · a failed job rejects that job only; the pool keeps working
  · close() terminates every worker — a live worker keeps the process alive forever`;
export const passIf = 'results are correct, 8 jobs finish in well under serial time, the loop stays responsive, and exactly size threads do all the work';

const SIZE = Math.max(2, Math.min(4, os.cpus().length - 1));
const N = 120_000_000;                                  // ~150ms of CPU per job
const serialHash = (n) => { let h = 1; for (let i = 0; i < n; i++) h = Math.imul(h ^ i, 2654435761) >>> 0; return h; };

export async function check(s) {
  if (typeof s.createPool !== 'function') return [{ check: 'exports createPool(size, workerPath)', actual: 'missing', pass: false }];
  const out = [];

  const t0 = performance.now();
  const want = serialHash(N);
  const serialMs = performance.now() - t0;

  let pool;
  try { pool = s.createPool(SIZE, workerPath); }
  catch (e) { return [{ check: 'createPool(size, workerPath) constructed', actual: e.message.slice(0, 60), pass: false }]; }

  const lag = loopLag(4);
  const t1 = performance.now();
  const results = await Promise.all(Array.from({ length: 8 }, () => pool.run({ n: N })));
  const parallelMs = performance.now() - t1;
  const l = lag.stop();

  const values = results.map((r) => (r && typeof r === 'object' && 'result' in r ? r.result : r));
  const correct = values.every((v) => v === want);
  const threads = new Set(results.map((r) => r && r.threadId).filter(Boolean));

  out.push({ check: '8 jobs all returned the right hash', actual: correct ? `${want}` : `got ${values[0]}, want ${want}`, pass: correct });
  out.push({
    check: `8 jobs across ${SIZE} workers beat ${(serialMs * 8).toFixed(0)}ms of serial work by 2x`,
    actual: `${parallelMs.toFixed(0)}ms vs ${(serialMs * 8).toFixed(0)}ms serial (${((serialMs * 8) / parallelMs).toFixed(1)}x)`,
    pass: parallelMs < serialMs * 8 / 2,
  });
  out.push({ check: 'the main loop stayed responsive throughout', actual: `worst lag ${l.max.toFixed(1)}ms`, pass: l.max < 30 });
  out.push({
    check: `exactly ${SIZE} threads did the work (workers reused, not respawned)`,
    actual: threads.size ? `${threads.size} distinct threadIds` : 'the reply did not include threadId — pass the worker reply through',
    pass: threads.size === SIZE,
  });

  // A failing job must not take the pool down with it.
  let failed = null;
  try { await pool.run({ n: 1, fail: true }); } catch (e) { failed = e; }
  let survived = null;
  try { survived = await pool.run({ n: 1000 }); } catch (e) { survived = `pool died: ${e.message}`; }
  const survivedValue = survived && typeof survived === 'object' ? survived.result : survived;
  out.push({ check: 'a failing job rejects', actual: failed ? failed.message.slice(0, 40) : 'it resolved', pass: !!failed });
  out.push({ check: 'and the pool still works afterwards', actual: String(survivedValue), pass: survivedValue === serialHash(1000) });

  // 200 tiny jobs: this is where spawn-per-job stops being merely wasteful. A Worker costs
  // ~15ms and a couple of megabytes before it runs a line of your code; 200 of them is seconds
  // of startup to do half a second of work.
  const t2 = performance.now();
  const small = await Promise.all(Array.from({ length: 200 }, () => pool.run({ n: 200_000 })));
  const smallMs = performance.now() - t2;
  out.push({
    check: '200 tiny jobs finish in under 400ms (spawn cost does not dominate)',
    actual: `${smallMs.toFixed(0)}ms`,
    pass: smallMs < 400 && small.length === 200,
  });

  await pool.close();
  await new Promise((r) => setTimeout(r, 100));
  let afterClose = 'resolved';
  try { await pool.run({ n: 10 }); } catch { afterClose = 'rejected'; }
  out.push({ check: 'close() shuts the workers down (run() rejects afterwards)', actual: afterClose, pass: afterClose === 'rejected' });

  return out;
}
