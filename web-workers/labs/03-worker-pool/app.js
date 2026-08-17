// Lab 03 — Worker pools & cancellation (page side).

import { $, on, Log, renderTable, fmt } from '/shared/lab-ui.js';
import { WorkerPool } from './pool.js';

const log = new Log('#log');
const out = $('out');
const rows = [];

$('#cores').textContent = navigator.hardwareConcurrency ?? 'unknown';

const WORKER_URL = new URL('./worker.js', import.meta.url);

// ---------------------------------------------------------------------------
// Slot visualisation
// ---------------------------------------------------------------------------

let pool = null;

function renderSlots(size, busyIndexes = new Set()) {
  const box = $('#slots');
  box.textContent = '';
  for (let i = 0; i < size; i++) {
    const d = document.createElement('div');
    d.textContent = busyIndexes.has(i) ? `#${i}\nbusy` : `#${i}\nidle`;
    d.className = busyIndexes.has(i) ? 'busy' : '';
    box.append(d);
  }
}

function buildPool() {
  pool?.terminate();
  const size = Number($('size').value);
  const busy = new Set();
  pool = new WorkerPool(WORKER_URL, {
    size,
    onEvent: (e) => {
      if (e.type === 'start') busy.add(e.index);
      else busy.delete(e.index);
      renderSlots(size, busy);
    },
  });
  renderSlots(size);
  log.ok(`pool of ${size} workers spawned`);
}

on('build', buildPool);

// ---------------------------------------------------------------------------

function record(strategy, wall, extra = {}) {
  rows.push({
    strategy,
    'wall ms': Math.round(wall),
    jobs: Number($('jobs').value),
    'ms each': Number($('ms').value),
    ...extra,
  });
  renderTable('#results', rows, {
    columns: ['strategy', 'jobs', 'ms each', 'wall ms', 'workers spawned', 'note'],
  });
  log.line(`${strategy}: ${fmt.ms(wall)}`, 'macro');
}

const job = () => ({ ms: Number($('ms').value) });

// A. one worker, everything queued behind everything else
on('sequential', async () => {
  const n = Number($('jobs').value);
  log.head(`— A. one worker, ${n} jobs —`);
  const w = new Worker(WORKER_URL, { type: 'module' });
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    await new Promise((resolve) => {
      const onMsg = (e) => { if (e.data.id === `s${i}`) { w.removeEventListener('message', onMsg); resolve(); } };
      w.addEventListener('message', onMsg);
      w.postMessage({ id: `s${i}`, type: 'run', work: job() });
    });
  }
  const wall = performance.now() - t0;
  w.terminate();
  record('A. single worker', wall, { 'workers spawned': 1, note: 'jobs run one at a time' });
  out.textContent =
    'A single worker is a serial queue. It protects the main thread and gives you zero\n' +
    'parallelism — which is fine when the goal is only "stop blocking the UI", and useless when\n' +
    'you have 24 independent jobs and 8 cores.';
});

// B. a worker per job
on('perJob', async () => {
  const n = Number($('jobs').value);
  log.head(`— B. ${n} workers, one per job —`);
  const t0 = performance.now();
  await Promise.all(Array.from({ length: n }, (_, i) => new Promise((resolve) => {
    const w = new Worker(WORKER_URL, { type: 'module' });
    w.addEventListener('message', () => { w.terminate(); resolve(); });
    w.postMessage({ id: `p${i}`, type: 'run', work: job() });
  })));
  const wall = performance.now() - t0;
  record('B. worker per job', wall, { 'workers spawned': n, note: 'thrashes; memory spikes' });
  out.textContent =
    'Every worker is a real OS thread with its own JS heap — typically a few MB before your code\n' +
    'has done anything. 24 of them is 24 threads competing for 8 cores plus tens of MB of heap,\n' +
    'and each one paid a spawn cost of 10–50ms.\n\n' +
    'Watch the wall time: it is often WORSE than the pool despite "more parallelism", because the\n' +
    'work is CPU-bound and the OS is now context-switching between threads that cannot all run.\n\n' +
    'Take a heap snapshot during this run to see the memory. Then never do it again.';
});

// C. the pool
on('pool', async () => {
  if (!pool) buildPool();
  const n = Number($('jobs').value);
  log.head(`— C. pool of ${pool.size}, ${n} jobs —`);
  const t0 = performance.now();
  await Promise.all(Array.from({ length: n }, () => pool.run(job())));
  const wall = performance.now() - t0;
  record('C. pool', wall, { 'workers spawned': pool.stats.spawned, note: `${pool.size} threads reused` });
  out.textContent =
    `Wall time ≈ ceil(${n} / ${pool.size}) × ${$('ms').value}ms, which is the floor for CPU-bound\n` +
    'work on that many threads. Memory is flat, spawn cost is paid once.\n\n' +
    'Sizing: navigator.hardwareConcurrency is the usual default, and it is a HINT — browsers cap\n' +
    'it for privacy (Safari reports at most 8 or so), it counts hyperthreads, and it tells you\n' +
    'nothing about what else is running. For CPU-bound work, hardwareConcurrency is right; for\n' +
    'I/O-bound work in workers, more threads than cores is fine.';
});

// ---------------------------------------------------------------------------
// The TODOs
// ---------------------------------------------------------------------------

on('cancel', async () => {
  if (!pool) buildPool();
  log.head('— cancellation —');
  const controller = new AbortController();
  const n = Number($('jobs').value);
  try {
    const jobs = Array.from({ length: n }, () => pool.run({ ms: 5000 }, { signal: controller.signal }));
    setTimeout(() => {
      log.bad('aborting after 400ms');
      controller.abort();
    }, 400);
    const settled = await Promise.allSettled(jobs);
    const cancelled = settled.filter((s) => s.status === 'rejected').length;
    log.line(`${cancelled}/${n} jobs cancelled`, cancelled === n ? 'good' : 'bad');
  } catch (err) {
    log.bad(err.message);
  }
  out.textContent =
    'Cancellation has two halves, and the second one surprises people:\n\n' +
    '1. QUEUED jobs: trivial — drop them from the queue and reject. No worker involved.\n\n' +
    '2. RUNNING jobs: a worker executing a synchronous loop CANNOT receive your cancel message.\n' +
    '   Its message queue is only drained when it returns to its event loop. So a cancel sent to\n' +
    '   a busy worker is delivered *after* the work finishes — i.e. never, in the sense you meant.\n\n' +
    '   Options: (a) design the worker to slice its work and check for cancellation between\n' +
    '   slices, which is what worker.js does here; (b) terminate() the worker, which is instant\n' +
    '   and costs you the thread, its warm JIT and any state it held; (c) a SharedArrayBuffer\n' +
    '   flag the worker polls, which works even inside a tight loop but needs cross-origin\n' +
    '   isolation.\n\n' +
    '   A production pool does (a) with a (b) timeout: ask nicely, then kill.';
});

on('priority', async () => {
  if (!pool) buildPool();
  log.head('— priorities —');
  try {
    const order = [];
    const jobs = [
      ...Array.from({ length: 8 }, (_, i) => pool.run({ ms: 200 }, { priority: 'low' }).then(() => order.push(`low${i}`))),
      ...Array.from({ length: 2 }, (_, i) => pool.run({ ms: 200 }, { priority: 'high' }).then(() => order.push(`high${i}`))),
    ];
    await Promise.all(jobs);
    log.line(`completion order: ${order.join(' ')}`, 'macro');
    log.line(order[0].startsWith('high') ? 'high priority ran first ✓' : 'priorities are not implemented', 'macro');
  } catch (err) {
    log.bad(err.message);
  }
});

on('backpressure', async () => {
  if (!pool) buildPool();
  log.head('— backpressure —');
  log.muted('queueing 1000 jobs at once; with maxQueue implemented this should not grow ' +
    'unboundedly');
  try {
    const before = performance.memory?.usedJSHeapSize;
    await Promise.all(Array.from({ length: 1000 }, () => pool.run({ ms: 1 })));
    const after = performance.memory?.usedJSHeapSize;
    log.line(`queue drained. heap delta: ${before ? fmt.bytes(after - before) : 'unavailable'}`, 'macro');
  } catch (err) {
    log.bad(err.message);
  }
  out.textContent =
    'An unbounded queue is a memory leak with extra steps: every queued job holds its payload,\n' +
    'its promise, and everything those close over. A pool fed by a scroll handler or a websocket\n' +
    'can queue faster than it drains, forever.\n\n' +
    'Two designs, both defensible:\n' +
    '  reject when full  — the caller learns immediately and can shed load\n' +
    '  await room        — the caller is naturally throttled (this is real backpressure)\n' +
    'Pick one deliberately and document it. The failure mode you must avoid is "queue silently\n' +
    'grows until the tab is killed".';
});

on('recycle', async () => {
  if (!pool) buildPool();
  log.head('— worker recycling —');
  log.muted('sending a job that makes the worker throw');
  try {
    await pool.run({ ms: 100, crash: true });
  } catch (err) {
    log.bad(`job rejected: ${err.message}`);
  }
  log.muted('now check: does the pool still work? Run the pool test again.');
});

buildPool();
