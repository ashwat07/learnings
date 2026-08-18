import { makeSource, makeSink } from './world.mjs';

export const title = 'Backpressure is not optional';
export const task = `Parse NDJSON off a fast source and write each object to a slow sink.

The sink holds 64 objects and takes a turn of the loop per write. The source will hand you a
hundred thousand records as fast as you can take them. Something has to say "stop", and if it is
not your code then the answer is "the OOM killer".

Implement createParser() — a Transform that turns Buffer chunks into objects, correctly, across
arbitrary chunk boundaries — and run(source, parser, sink), which connects them.`;
export const passIf = 'every record arrives in order, the sink never buffers more than ~64, and a downstream failure destroys the source instead of leaking it';

const N = 100_000;

export async function check(s) {
  if (typeof s.createParser !== 'function' || typeof s.run !== 'function') {
    return [{ check: 'exports createParser() and run(source, parser, sink)', actual: 'missing', pass: false }];
  }
  const out = [];

  // --- the main run ---
  const source = makeSource(N);
  const sink = makeSink();
  const before = process.memoryUsage().heapUsed;
  let peakHeap = before;
  const sampler = setInterval(() => { peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed); }, 5);
  const t0 = performance.now();
  let ranErr = null;
  try { await s.run(source, s.createParser(), sink); } catch (e) { ranErr = e; }
  // Did run() wait for the SINK to finish, or just for the source to end? A pump that resolves on
  // the source's 'end' event reports success while a hundred thousand writes are still queued —
  // and if the process exits there, that data is simply gone.
  const finishedWhenResolved = sink.writableFinished;
  // Now let the backlog drain so the peak buffer and heap tell the truth.
  if (!sink.writableFinished) {
    await Promise.race([
      new Promise((r) => sink.once('finish', r)),
      new Promise((r) => sink.once('close', r)),
      new Promise((r) => setTimeout(r, 8000)),
    ]);
  }
  clearInterval(sampler);
  const ms = performance.now() - t0;
  const grew = (peakHeap - before) / 1024 / 1024;

  const got = sink.received;
  const inOrder = got.length === N && got[0]?.id === 0 && got[N - 1]?.id === N - 1 &&
    got[Math.floor(N / 2)]?.id === Math.floor(N / 2) && got[7]?.name === 'user-7' &&
    got[7]?.score === (7 * 7919) % 1000;

  out.push({ check: 'run() resolved', actual: ranErr ? `rejected: ${ranErr.message}`.slice(0, 50) : `${ms.toFixed(0)}ms`, pass: !ranErr });
  out.push({ check: 'it resolved only once the SINK had finished', actual: finishedWhenResolved ? 'yes' : 'no — it resolved with writes still queued', pass: finishedWhenResolved === true });
  out.push({ check: `all ${N.toLocaleString()} records arrived, parsed, in order`, actual: `${got.length.toLocaleString()} records${inOrder ? '' : ' — wrong or out of order'}`, pass: inOrder });
  out.push({ check: 'the sink never buffered more than 128 objects', actual: `peak ${sink.peakBuffered}`, pass: sink.peakBuffered <= 128 });
  out.push({ check: 'heap grew less than 40MB', actual: `${grew.toFixed(1)}MB`, pass: grew < 40 });

  // --- the failure run: the half everyone skips ---
  // A million records, and the sink dies at 500. A correct chain gives up immediately and tears
  // the source down; a .pipe() chain keeps reading from a source nobody is listening to.
  const source2 = makeSource(5_000_000);
  const sink2 = makeSink({ failAt: 500 });
  let err = null;
  const started = performance.now();
  await Promise.race([
    Promise.resolve(s.run(source2, s.createParser(), sink2)).then(() => {}, (e) => { err = e; }),
    new Promise((r) => setTimeout(r, 3000)),
  ]);
  const settled = performance.now() - started;
  const destroyed = source2.destroyed;
  source2.destroy(); sink2.destroy();
  await new Promise((r) => setImmediate(r));

  const reported = !!err && /exploded/.test(err.message);
  out.push({ check: 'a sink error makes run() reject with that error', actual: reported ? `${err.message} after ${settled.toFixed(0)}ms` : (err ? err.message.slice(0, 40) : 'never rejected — it is still reading'), pass: reported });
  out.push({
    check: 'the sink error DESTROYS the source (no leaked fd / socket)',
    actual: destroyed ? 'destroyed' : 'still open — .pipe() does not clean up after itself',
    pass: destroyed === true,
  });

  return out;
}
